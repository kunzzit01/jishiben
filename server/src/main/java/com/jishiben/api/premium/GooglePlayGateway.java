package com.jishiben.api.premium;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.GenericUrl;
import com.google.api.client.http.HttpRequest;
import com.google.api.client.http.HttpRequestFactory;
import com.google.api.client.http.HttpResponseException;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.http.json.JsonHttpContent;
import com.google.api.client.json.gson.GsonFactory;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.GoogleCredentials;
import com.jishiben.api.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriUtils;

/**
 * Google Play Developer API access. Only Google's answer is trusted: no client-supplied price,
 * expiry or membership flag. Purchase tokens are encrypted at rest (AES-GCM).
 * Every call has connect/read timeouts and no built-in retries; retries are scheduled by the
 * reconciler with backoff.
 */
@Component
public class GooglePlayGateway {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final NetHttpTransport transport = new NetHttpTransport();
    private final ObjectMapper json;
    private final String packageName;
    private final String productId;
    private final String key;
    private final String audience;
    private final String pushEmail;
    private HttpRequestFactory factory;

    public GooglePlayGateway(ObjectMapper json,
            @Value("${app.billing.package-name:com.kylim0103.jizhangapp}") String packageName,
            @Value("${app.billing.product-id:premium}") String productId,
            @Value("${app.billing.token-encryption-key:}") String key,
            @Value("${app.billing.push-audience:}") String audience,
            @Value("${app.billing.push-email:}") String pushEmail) {
        this.json = json; this.packageName = packageName; this.productId = productId;
        this.key = key; this.audience = audience; this.pushEmail = pushEmail;
    }

    /** Google's view of one purchase token, reduced to what the first release supports. */
    record Verified(String state, Instant expiry, String plan, boolean autoRenew, boolean acknowledged,
                    String accountId, String linkedToken, String expiredToken, String expiredAccountId,
                    boolean testPurchase) {}

    /** A purchase Google returned but this release does not support (other product, plan, bundle). */
    static class Unsupported extends RuntimeException {
        Unsupported(String message) { super(message); }
    }

    record Voided(String purchaseToken, int refundType, Instant voidedAt) {}

    Verified verify(String token) {
        JsonNode data;
        try {
            HttpRequest request = factory().buildGetRequest(new GenericUrl(root() + "/purchases/subscriptionsv2/tokens/" + path(token)));
            data = json.readTree(execute(request));
        } catch (HttpResponseException ex) {
            if (ex.getStatusCode() == 400 || ex.getStatusCode() == 404 || ex.getStatusCode() == 410) {
                throw ApiException.badRequest("Google Play does not recognise this purchase");
            }
            throw ApiException.upstream("Google Play verification unavailable; it will be retried");
        } catch (Exception ex) {
            throw ApiException.upstream("Google Play verification unavailable; it will be retried");
        }
        return parse(data);
    }

    Verified parse(JsonNode data) {
        JsonNode item = null;
        for (JsonNode line : data.path("lineItems")) {
            if (productId.equals(line.path("productId").asText())) {
                // First release: one membership line item. Fail closed for bundles.
                if (item != null) throw new Unsupported("Unsupported multi-item membership");
                item = line;
            }
        }
        if (item == null) throw new Unsupported("Unexpected subscription product");
        String plan = item.path("offerDetails").path("basePlanId").asText();
        if (!List.of("monthly", "yearly").contains(plan)) throw new Unsupported("Unsupported base plan");
        String state = data.path("subscriptionState").asText().replace("SUBSCRIPTION_STATE_", "");
        if (!SubscriptionPolicy.STATES.contains(state)) throw new Unsupported("Unsupported Google subscription state " + state);
        Instant expiry = item.hasNonNull("expiryTime") ? Instant.parse(item.path("expiryTime").asText()) : null;
        JsonNode outOfApp = data.path("outOfAppPurchaseContext");
        return new Verified(state, expiry, plan,
                item.path("autoRenewingPlan").path("autoRenewEnabled").asBoolean(false),
                "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED".equals(data.path("acknowledgementState").asText()),
                data.path("externalAccountIdentifiers").path("obfuscatedExternalAccountId").asText(""),
                data.path("linkedPurchaseToken").asText(""),
                outOfApp.path("expiredPurchaseToken").asText(""),
                outOfApp.path("expiredExternalAccountIdentifiers").path("obfuscatedExternalAccountId").asText(""),
                data.has("testPurchase"));
    }

    /** Server-side acknowledgement (subscriptions have no v2 acknowledge method). */
    void acknowledge(String token) {
        try {
            HttpRequest request = factory().buildPostRequest(new GenericUrl(root() + "/purchases/subscriptions/" + path(productId)
                    + "/tokens/" + path(token) + ":acknowledge"), new JsonHttpContent(GsonFactory.getDefaultInstance(), Map.of()));
            execute(request);
        } catch (Exception ex) {
            throw ApiException.upstream("Google purchase acknowledgement failed; it will be retried");
        }
    }

    /** Voided Purchases API (subscriptions included with type=1), used as a backstop for refund notifications. */
    List<Voided> voided(Instant since) {
        List<Voided> result = new ArrayList<>();
        String page = null;
        try {
            for (int i = 0; i < 10; i++) {
                GenericUrl url = new GenericUrl(root() + "/purchases/voidedpurchases");
                url.set("type", 1);
                url.set("startTime", since.toEpochMilli());
                url.set("maxResults", 1000);
                if (page != null) url.set("token", page);
                JsonNode data = json.readTree(execute(factory().buildGetRequest(url)));
                for (JsonNode v : data.path("voidedPurchases")) {
                    result.add(new Voided(v.path("purchaseToken").asText(), v.path("refundType").asInt(1),
                            Instant.ofEpochMilli(v.path("voidedTimeMillis").asLong(System.currentTimeMillis()))));
                }
                page = data.path("tokenPagination").path("nextPageToken").asText("");
                if (page.isBlank()) break;
            }
        } catch (Exception ex) {
            throw ApiException.upstream("Google voided purchases unavailable");
        }
        return result;
    }

    private String execute(HttpRequest request) throws java.io.IOException {
        request.setConnectTimeout(5000);
        request.setReadTimeout(10000);
        request.setNumberOfRetries(0);
        request.setLoggingEnabled(false);
        request.setCurlLoggingEnabled(false);
        var response = request.execute();
        try { return response.parseAsString(); } finally { response.disconnect(); }
    }

    private synchronized HttpRequestFactory factory() throws java.io.IOException {
        if (factory == null) {
            GoogleCredentials credentials = GoogleCredentials.getApplicationDefault()
                    .createScoped(List.of("https://www.googleapis.com/auth/androidpublisher"));
            factory = transport.createRequestFactory(new HttpCredentialsAdapter(credentials));
        }
        return factory;
    }

    private String root() { return "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + path(packageName); }
    private static String path(String value) { return UriUtils.encodePathSegment(value, StandardCharsets.UTF_8); }

    String encrypt(String token) { return crypt(token, true); }
    String decrypt(String cipher) { return crypt(cipher, false); }

    private String crypt(String value, boolean encrypt) {
        try {
            byte[] rawKey = Base64.getDecoder().decode(key);
            if (rawKey.length != 32) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] nonce = new byte[12];
            byte[] data;
            if (encrypt) {
                RANDOM.nextBytes(nonce);
                data = value.getBytes(StandardCharsets.UTF_8);
            } else {
                byte[] packed = Base64.getDecoder().decode(value);
                if (packed.length < 28) throw new IllegalArgumentException();
                System.arraycopy(packed, 0, nonce, 0, 12);
                data = java.util.Arrays.copyOfRange(packed, 12, packed.length);
            }
            cipher.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, new SecretKeySpec(rawKey, "AES"), new GCMParameterSpec(128, nonce));
            cipher.updateAAD(packageName.getBytes(StandardCharsets.UTF_8));
            byte[] result = cipher.doFinal(data);
            if (!encrypt) return new String(result, StandardCharsets.UTF_8);
            byte[] packed = new byte[12 + result.length];
            System.arraycopy(nonce, 0, packed, 0, 12);
            System.arraycopy(result, 0, packed, 12, result.length);
            return Base64.getEncoder().encodeToString(packed);
        } catch (Exception ex) {
            throw ApiException.upstream("Billing token storage is not configured correctly");
        }
    }

    /** Pub/Sub push must carry a Google-signed OIDC token for the configured audience and account. */
    void verifyPush(String authorization) {
        if (audience.isBlank() || pushEmail.isBlank() || authorization == null || !authorization.startsWith("Bearer ")) {
            throw ApiException.unauthorized("Authenticated Pub/Sub delivery required");
        }
        try {
            var token = new GoogleIdTokenVerifier.Builder(transport, GsonFactory.getDefaultInstance())
                    .setAudience(List.of(audience)).build().verify(authorization.substring(7));
            if (token == null || !Boolean.TRUE.equals(token.getPayload().getEmailVerified())
                    || !pushEmail.equals(token.getPayload().getEmail())) {
                throw ApiException.unauthorized("Unexpected Pub/Sub identity");
            }
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw ApiException.unauthorized("Invalid Pub/Sub identity");
        }
    }

    String packageName() { return packageName; }
}
