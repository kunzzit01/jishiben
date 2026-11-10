package com.jishiben.api.premium;

import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class GooglePlayGatewayTest {
    final ObjectMapper json = new ObjectMapper();
    final GooglePlayGateway gateway = new GooglePlayGateway(json, "com.example.app", "premium",
            java.util.Base64.getEncoder().encodeToString(new byte[32]), "https://example.com/push", "push@example.com");
    @Test void googleStateAndLineItemDetermineExpiryAndPlan() throws Exception {
        var v = gateway.parse(json.readTree("""
            {"subscriptionState":"SUBSCRIPTION_STATE_CANCELED","acknowledgementState":"ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
             "externalAccountIdentifiers":{"obfuscatedExternalAccountId":"opaque-id"},"linkedPurchaseToken":"old",
             "lineItems":[{"productId":"premium","expiryTime":"2026-12-01T00:00:00Z","offerDetails":{"basePlanId":"monthly"},
               "autoRenewingPlan":{"autoRenewEnabled":false}}]}
            """));
        assertThat(v.state()).isEqualTo("CANCELED"); assertThat(v.plan()).isEqualTo("monthly");
        assertThat(v.expiry()).isEqualTo(Instant.parse("2026-12-01T00:00:00Z"));
        assertThat(v.autoRenew()).isFalse(); assertThat(v.acknowledged()).isTrue(); assertThat(v.linkedToken()).isEqualTo("old");
    }
    @Test void outOfAppResubscriptionsRetainTheOriginalIdentity() throws Exception {
        var v = gateway.parse(json.readTree("""
            {"subscriptionState":"SUBSCRIPTION_STATE_ACTIVE",
             "outOfAppPurchaseContext":{"expiredExternalAccountIdentifiers":{"obfuscatedExternalAccountId":"original"},"expiredPurchaseToken":"expired"},
             "lineItems":[{"productId":"premium","expiryTime":"2026-12-01T00:00:00Z","offerDetails":{"basePlanId":"yearly"}}]}
            """));
        assertThat(v.accountId()).isEqualTo("original"); assertThat(v.expiredToken()).isEqualTo("expired");
    }
    @Test void unexpectedProductsAndUnknownStatesFailClosed() throws Exception {
        assertThatThrownBy(() -> gateway.parse(json.readTree("""
          {"subscriptionState":"SUBSCRIPTION_STATE_ACTIVE","lineItems":[{"productId":"other"}]}
          """))).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> gateway.parse(json.readTree("""
          {"subscriptionState":"UNRECOGNIZED","lineItems":[{"productId":"premium","offerDetails":{"basePlanId":"monthly"}}]}
          """))).isInstanceOf(RuntimeException.class);
    }
    @Test void storedTokensAreAuthenticatedEncryptedAndCannotBeTamperedWith() {
        String encrypted = gateway.encrypt("sensitive-purchase-token");
        assertThat(encrypted).doesNotContain("sensitive");
        assertThat(gateway.decrypt(encrypted)).isEqualTo("sensitive-purchase-token");
        byte[] bytes = java.util.Base64.getDecoder().decode(encrypted); bytes[13] ^= 1;
        assertThatThrownBy(() -> gateway.decrypt(java.util.Base64.getEncoder().encodeToString(bytes))).isInstanceOf(RuntimeException.class);
    }
}
