package com.jishiben.api.premium;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.api.client.googleapis.auth.oauth2.GoogleCredential;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.GenericUrl;
import com.google.api.client.http.HttpRequest;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.http.json.JsonHttpContent;
import com.google.api.client.json.gson.GsonFactory;
import com.jishiben.api.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriUtils;

/** No client-supplied price, expiry, or membership flag is trusted. Tokens are encrypted at rest. */
@Component
public class GooglePlayGateway {
    private final NetHttpTransport transport = new NetHttpTransport();
    private final ObjectMapper json;
    private final String packageName;
    private final String productId;
    private final String key;
    private final String audience;
    private final String pushEmail;
    private GoogleCredential credential;

    public GooglePlayGateway(ObjectMapper json,
            @Value("${app.billing.package-name}") String packageName,
            @Value("${app.billing.product-id}") String productId,
            @Value("${app.billing.token-encryption-key:}") String key,
            @Value("${app.billing.push-audience:}") String audience,
            @Value("${app.billing.push-email:}") String pushEmail) {
        this.json = json; this.packageName = packageName; this.productId = productId;
        this.key = key; this.audience = audience; this.pushEmail = pushEmail;
    }
    record Verified(String state, Instant expiry, String plan, boolean autoRenew, boolean acknowledged,
                    String accountId, String linkedToken, String expiredToken) {}

    Verified verify(String token) {
        try {
            HttpRequest request = factory().buildGetRequest(new GenericUrl(root() + "/purchases/subscriptionsv2/tokens/" + path(token)));
            return parse(json.readTree(execute(request)));
        } catch (ApiException ex) { throw ex; }
        catch (Exception ex) { throw ApiException.upstream("Google Play verification unavailable; retry or restore purchase"); }
    }

    Verified parse(JsonNode data) {
        JsonNode item = null;
        for (JsonNode line : data.path("lineItems")) {
            if (productId.equals(line.path("productId").asText())) {
                // First release supports one membership line item; fail closed for unsupported bundles.
                if (item != null) throw ApiException.validation("Unsupported multi-item membership");
                item = line;
            }
        }
        if (item == null) throw ApiException.validation("Unexpected subscription product");
        String plan = item.path("offerDetails").path("basePlanId").asText();
        if (!List.of("monthly", "yearly").contains(plan)) throw ApiException.validation("Unsupported base plan");
        String state = data.path("subscriptionState").asText().replace("SUBSCRIPTION_STATE_", "");
        if (!SubscriptionPolicy.STATES.contains(state)) throw ApiException.validation("Unsupported Google subscription state");
        Instant expiry = item.hasNonNull("expiryTime") ? Instant.parse(item.path("expiryTime").asText()) : null;
        JsonNode outOfApp = data.path("outOfAppPurchaseContext");
        String account = data.path("externalAccountIdentifiers").path("obfuscatedExternalAccountId").asText();
        if (account.isEmpty()) account = outOfApp.path("expiredExternalAccountIdentifiers").path("obfuscatedExternalAccountId").asText();
        return new Verified(state, expiry, plan, item.path("autoRenewingPlan").path("autoRenewEnabled").asBoolean(false),
                "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED".equals(data.path("acknowledgementState").asText()),
                account, data.path("linkedPurchaseToken").asText(), outOfApp.path("expiredPurchaseToken").asText());
    }

    void acknowledge(String token) {
        try {
            HttpRequest request = factory().buildPostRequest(new GenericUrl(root() + "/purchases/subscriptions/" + path(productId)
                    + "/tokens/" + path(token) + ":acknowledge"), new JsonHttpContent(GsonFactory.getDefaultInstance(), Map.of()));
            execute(request);
        } catch (Exception ex) { throw ApiException.upstream("Google purchase acknowledgment will be retried"); }
    }

    private String execute(HttpRequest request) throws java.io.IOException {
        request.setConnectTimeout(5000); request.setReadTimeout(10000); request.setNumberOfRetries(0);
        request.setLoggingEnabled(false); request.setCurlLoggingEnabled(false);
        var response = request.execute();
        try { return response.parseAsString(); } finally { response.disconnect(); }
    }
    private synchronized com.google.api.client.http.HttpRequestFactory factory() throws java.io.IOException {
        if (credential == null) credential = GoogleCredential.getApplicationDefault(transport, GsonFactory.getDefaultInstance())
                .createScoped(List.of("https://www.googleapis.com/auth/androidpublisher"));
        return transport.createRequestFactory(credential);
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
            if (encrypt) { new SecureRandom().nextBytes(nonce); data = value.getBytes(StandardCharsets.UTF_8); }
            else {
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
            System.arraycopy(nonce, 0, packed, 0, 12); System.arraycopy(result, 0, packed, 12, result.length);
            return Base64.getEncoder().encodeToString(packed);
        } catch (Exception ex) { throw ApiException.upstream("Billing token storage is not configured correctly"); }
    }

    void verifyPush(String authorization) {
        if (audience.isBlank() || pushEmail.isBlank() || authorization == null || !authorization.startsWith("Bearer "))
            throw ApiException.unauthorized("Authenticated Pub/Sub delivery required");
        try {
            var token = new GoogleIdTokenVerifier.Builder(transport, GsonFactory.getDefaultInstance())
                    .setAudience(List.of(audience)).build().verify(authorization.substring(7));
            if (token == null || !Boolean.TRUE.equals(token.getPayload().getEmailVerified())
                    || !pushEmail.equals(token.getPayload().getEmail())) throw ApiException.unauthorized("Unexpected Pub/Sub identity");
        } catch (ApiException ex) { throw ex; }
        catch (Exception ex) { throw ApiException.unauthorized("Invalid Pub/Sub identity"); }
    }
    String packageName() { return packageName; }
}
