package com.jishiben.api.premium;

import static com.jishiben.api.premium.BillingFixture.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.security.AuthPrincipal;
import java.time.Instant;
import java.util.Base64;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GoogleBillingServiceTest {
    BillingFixture db;
    PremiumService premium;
    GooglePlayGateway google;
    GoogleBillingService billing;
    final ObjectMapper json = new ObjectMapper();

    @BeforeEach void setUp() throws Exception {
        db = new BillingFixture();
        var props = new BillingProperties("production", false, true, ADMIN_EMAIL, "", 7);
        premium = db.service(props);
        google = mock(GooglePlayGateway.class);
        when(google.encrypt(anyString())).thenAnswer(i -> "enc:" + i.getArgument(0));
        when(google.decrypt(anyString())).thenAnswer(i -> ((String) i.getArgument(0)).substring(4));
        when(google.packageName()).thenReturn("com.kylim0103.jizhangapp");
        billing = new GoogleBillingService(premium, google, json, db.transactions, props);
        db.jdbc.update("UPDATE billing_settings SET enrollment_open=TRUE, gates_enabled=TRUE");
    }

    @AfterEach void clear() { signOut(); }

    static GooglePlayGateway.Verified verified(String state, String account) {
        return verified(state, account, false, "");
    }

    static GooglePlayGateway.Verified verified(String state, String account, boolean acked, String linked) {
        return new GooglePlayGateway.Verified(state, Instant.now().plusSeconds(3600), "monthly", true, acked, account, linked, "", "", false);
    }

    String guestAccount(String guest) { return premium.status(guest).obfuscatedAccountId(); }

    @Test void verifiedPurchaseGrantsAndIsAcknowledgedOnce() {
        String guest = premium.createGuest().token();
        when(google.verify("t1")).thenReturn(verified("ACTIVE", guestAccount(guest)));
        assertThat(billing.verify(guest, "t1", false, false).active()).isTrue();
        verify(google, times(1)).acknowledge("t1");
        assertThat(db.jdbc.queryForObject("SELECT acknowledged FROM billing_subscriptions", Boolean.class)).isTrue();
        // Replays are idempotent: same row, no second subscription.
        billing.verify(guest, "t1", false, false);
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);
    }

    @Test void failedAcknowledgementIsRetriedByTheReconciler() {
        String guest = premium.createGuest().token();
        when(google.verify("t1")).thenReturn(verified("ACTIVE", guestAccount(guest)));
        doThrow(ApiException.upstream("down")).doNothing().when(google).acknowledge("t1");
        assertThat(billing.verify(guest, "t1", false, false).active()).as("grant does not wait for acknowledgement").isTrue();
        assertThat(db.jdbc.queryForObject("SELECT acknowledged FROM billing_subscriptions", Boolean.class)).isFalse();
        billing.reconcile(PremiumService.digest("t1"));
        assertThat(db.jdbc.queryForObject("SELECT acknowledged FROM billing_subscriptions", Boolean.class)).isTrue();
    }

    @Test void pendingPurchaseNeitherGrantsNorAcknowledges() {
        String guest = premium.createGuest().token();
        when(google.verify("p")).thenReturn(verified("PENDING", guestAccount(guest)));
        assertThat(billing.verify(guest, "p", false, false).active()).isFalse();
        verify(google, never()).acknowledge(anyString());
        // Payment completes later: the reconciler picks it up and grants without the app being open.
        when(google.verify("p")).thenReturn(verified("ACTIVE", guestAccount(guest)));
        billing.reconcile(PremiumService.digest("p"));
        assertThat(premium.status(guest).active()).isTrue();
        verify(google).acknowledge("p");
    }

    @Test void accountMappingMustMatch() {
        String guest = premium.createGuest().token();
        when(google.verify("forged")).thenReturn(verified("ACTIVE", "someone-else"));
        assertThatThrownBy(() -> billing.verify(guest, "forged", false, false)).isInstanceOf(ApiException.class);
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions", Integer.class)).isZero();
    }

    @Test void purchaseOfAnotherAccountIsNeverMoved() {
        signIn(2, "other@example.com", AuthPrincipal.METHOD_PASSWORD);
        String account = premium.status(null).obfuscatedAccountId();
        when(google.verify("owned")).thenReturn(verified("ACTIVE", account));
        billing.verify(null, "owned", false, false);
        signIn(3, "third@example.com", AuthPrincipal.METHOD_PASSWORD);
        assertThatThrownBy(() -> billing.verify(null, "owned", true, true))
                .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.code()).isEqualTo(ErrorCode.BILLING_OWNED_BY_OTHER));
        assertThat(premium.status(null).active()).isFalse();
        signOut();
        String guest = premium.createGuest().token();
        assertThatThrownBy(() -> billing.verify(guest, "owned", true, false)).isInstanceOf(ApiException.class);
    }

    @Test void signedInUserMustConfirmBeforeAGuestPurchaseIsBound() {
        String guest = premium.createGuest().token();
        when(google.verify("g")).thenReturn(verified("ACTIVE", guestAccount(guest)));
        billing.verify(guest, "g", false, false);
        // New phone: the guest credential is gone, the user signs in and restores from Play.
        signIn(2, "other@example.com", AuthPrincipal.METHOD_PASSWORD);
        assertThatThrownBy(() -> billing.verify(null, "g", true, false))
                .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.code()).isEqualTo(ErrorCode.BILLING_CLAIM_REQUIRED));
        assertThat(billing.verify(null, "g", true, true).active()).isTrue();
        signOut();
        assertThatThrownBy(() -> premium.status(guest)).as("old guest credential retired").isInstanceOf(ApiException.class);
    }

    @Test void reinstalledGuestRestoresTheirOwnUnboundPurchase() {
        String oldGuest = premium.createGuest().token();
        when(google.verify("g")).thenReturn(verified("ACTIVE", guestAccount(oldGuest)));
        billing.verify(oldGuest, "g", false, false);
        String newGuest = premium.createGuest().token();
        assertThatThrownBy(() -> billing.verify(newGuest, "g", false, false)).as("only a restore may move it").isInstanceOf(ApiException.class);
        assertThat(billing.verify(newGuest, "g", true, false).active()).isTrue();
        assertThat(premium.status(newGuest).active()).isTrue();
    }

    @Test void deletedAccountPurchaseCanBeReclaimedAfterConfirmation() {
        signIn(2, "other@example.com", AuthPrincipal.METHOD_PASSWORD);
        String account = premium.status(null).obfuscatedAccountId();
        when(google.verify("d")).thenReturn(verified("ACTIVE", account));
        billing.verify(null, "d", false, false);
        db.jdbc.update("UPDATE billing_subjects SET detached_at=CURRENT_TIMESTAMP, user_id=NULL WHERE user_id=2");
        signIn(3, "third@example.com", AuthPrincipal.METHOD_PASSWORD);
        assertThatThrownBy(() -> billing.verify(null, "d", true, false)).isInstanceOf(ApiException.class);
        assertThat(billing.verify(null, "d", true, true).active()).isTrue();
    }

    @Test void replacementPurchaseRetiresTheOldToken() {
        String guest = premium.createGuest().token();
        String account = guestAccount(guest);
        when(google.verify("old")).thenReturn(verified("ACTIVE", account, true, ""));
        billing.verify(guest, "old", false, false);
        when(google.verify("new")).thenReturn(verified("ACTIVE", account, true, "old"));
        billing.verify(guest, "new", false, false);
        assertThat(db.jdbc.queryForObject("SELECT subscription_state FROM billing_subscriptions WHERE token_hash=?", String.class,
                PremiumService.digest("old"))).isEqualTo("EXPIRED");
        assertThat(premium.status(guest).active()).isTrue();
    }

    @Test void closedEnrollmentBlocksNewPurchasesButNotRestores() {
        db.jdbc.update("UPDATE billing_settings SET enrollment_open=FALSE");
        String guest = premium.createGuest().token();
        when(google.verify("t")).thenReturn(verified("ACTIVE", guestAccount(guest)));
        assertThatThrownBy(() -> billing.verify(guest, "t", false, false)).isInstanceOf(ApiException.class);
        assertThat(billing.verify(guest, "t", true, false).active()).isTrue();
    }

    @Test void withGuestSubscriptionsOffAGuestCannotRegisterAPurchase() {
        var accountsOnly = new BillingProperties("production", false, true, ADMIN_EMAIL, "", 7, false);
        var strictPremium = db.service(accountsOnly);
        var strict = new GoogleBillingService(strictPremium, google, json, db.transactions, accountsOnly);
        String guest = strictPremium.createGuest().token();
        assertThatThrownBy(() -> strict.verify(guest, "t", false, false))
                .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.code()).isEqualTo(ErrorCode.ACCOUNT_REQUIRED));
        verify(google, never()).verify(anyString());
    }

    @Test void googleDisabledDeploymentRejectsVerification() {
        var off = new BillingProperties("production", false, false, ADMIN_EMAIL, "", 7);
        var disabled = new GoogleBillingService(premium, google, json, db.transactions, off);
        assertThatThrownBy(() -> disabled.verify(null, "t", false, false)).isInstanceOf(ApiException.class);
        verifyNoInteractions(google);
    }

    // ── notifications ──

    com.fasterxml.jackson.databind.JsonNode envelope(String id, String payload) throws Exception {
        String data = Base64.getEncoder().encodeToString(payload.getBytes());
        return json.readTree("{\"message\":{\"messageId\":\"" + id + "\",\"data\":\"" + data + "\"}}");
    }

    @Test void notificationForUnknownOwnerIsParkedThenAttributed() throws Exception {
        String guest = premium.createGuest().token();
        when(google.verify("early")).thenReturn(verified("ACTIVE", "not-yet-known"));
        billing.notification("Bearer x", envelope("m1", """
            {"packageName":"com.kylim0103.jizhangapp","subscriptionNotification":{"notificationType":4,"purchaseToken":"early"}}"""));
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_orphans", Integer.class)).isEqualTo(1);
        verify(google, never()).acknowledge(anyString());
        // Duplicate delivery is ignored.
        billing.notification("Bearer x", envelope("m1", "{}"));
        verify(google, times(1)).verify("early");
        // The app reports it: attributed, orphan removed.
        when(google.verify("early")).thenReturn(verified("ACTIVE", guestAccount(guest)));
        billing.verify(guest, "early", false, false);
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_orphans", Integer.class)).isZero();
    }

    @Test void refundIsRecordedSeparatelyFromRevocation() throws Exception {
        String guest = premium.createGuest().token();
        String account = guestAccount(guest);
        when(google.verify("r")).thenReturn(verified("ACTIVE", account, true, ""));
        billing.verify(guest, "r", false, false);
        billing.notification("Bearer x", envelope("v1", """
            {"packageName":"com.kylim0103.jizhangapp","voidedPurchaseNotification":{"purchaseToken":"r","productType":1,"refundType":1}}"""));
        var refunded = premium.status(guest);
        assertThat(refunded.subscriptions().getFirst().refundType()).isEqualTo("FULL_REFUND");
        assertThat(refunded.active()).as("refund without revocation keeps Google's state").isTrue();
        when(google.verify("r")).thenReturn(new GooglePlayGateway.Verified("EXPIRED", Instant.now(), "monthly", false, true, account, "", "", "", false));
        billing.notification("Bearer x", envelope("v2", """
            {"packageName":"com.kylim0103.jizhangapp","subscriptionNotification":{"notificationType":12,"purchaseToken":"r"}}"""));
        assertThat(premium.status(guest).active()).isFalse();
        assertThat(db.jdbc.queryForObject("SELECT revoked_at IS NOT NULL FROM billing_subscriptions", Boolean.class)).isTrue();
    }

    @Test void unsupportedOrForeignNotificationsDoNotLoop() throws Exception {
        when(google.verify("odd")).thenThrow(new GooglePlayGateway.Unsupported("other product"));
        assertThatCode(() -> billing.notification("Bearer x", envelope("u1", """
            {"packageName":"com.kylim0103.jizhangapp","subscriptionNotification":{"notificationType":4,"purchaseToken":"odd"}}""")))
                .doesNotThrowAnyException();
        assertThatCode(() -> billing.notification("Bearer x", envelope("u2", """
            {"packageName":"com.other","subscriptionNotification":{"notificationType":4,"purchaseToken":"x"}}""")))
                .doesNotThrowAnyException();
    }

    @Test void transientGoogleFailuresAreRetriedByPubSub() throws Exception {
        when(google.verify("t")).thenThrow(ApiException.upstream("down"));
        assertThatThrownBy(() -> billing.notification("Bearer x", envelope("t1", """
            {"packageName":"com.kylim0103.jizhangapp","subscriptionNotification":{"notificationType":2,"purchaseToken":"t"}}""")))
                .isInstanceOf(ApiException.class);
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_events", Integer.class)).as("not marked processed").isZero();
    }
}
