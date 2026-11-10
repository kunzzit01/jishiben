package com.jishiben.api.premium;

import static com.jishiben.api.premium.BillingFixture.*;
import static org.assertj.core.api.Assertions.*;

import com.jishiben.api.auth.GoogleTokenVerifier;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.user.User;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.Callable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PremiumServiceTest {
    BillingFixture db;
    BillingProperties props;
    BillingAdminService admins;
    PremiumService service;

    @BeforeEach void setUp() throws Exception {
        db = new BillingFixture();
        props = staging();
        admins = db.admins(props);
        service = new PremiumService(db.jdbc, props, admins);
    }

    @AfterEach void clear() { signOut(); }

    PremiumDtos.Subscription approve(String guest, String plan) {
        var pending = db.inTx(() -> service.apply(guest, new PremiumDtos.Application(plan, "apply-" + plan)));
        var order = pending.subscriptions().getFirst();
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        db.inTx(() -> service.simulate(order.id(), new PremiumDtos.Event("APPROVE", "approve-" + order.id(), order.revision())));
        signOut();
        return order;
    }

    // ── administrator ──

    @Test void administratorNeedsAGoogleSessionWithThePinnedGoogleAccount() {
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        assertThat(service.isAdministrator()).as("nothing pinned yet").isFalse();
        db.pinAdmin(admins);
        assertThat(service.isAdministrator()).isTrue();
        // Same account, signed in with the password: no admin (the password may belong to whoever registered the e-mail first).
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_PASSWORD);
        assertThat(service.isAdministrator()).isFalse();
        assertThatThrownBy(service::console).isInstanceOf(ApiException.class);
        // Another account using the same e-mail string but a different Google identity.
        db.user(3, ADMIN_EMAIL, "attacker-sub");
        signIn(3, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        assertThat(service.isAdministrator()).isFalse();
    }

    @Test void databaseGrantedAdminRoleWorksWithPasswordSessionAndIsReadFromTheDatabase() {
        User owner = new User();
        owner.setEmail(ADMIN_EMAIL);
        owner.setUserRole("ADMIN");
        org.mockito.Mockito.when(db.users.findById(2L)).thenReturn(java.util.Optional.of(owner));
        signIn(2, ADMIN_EMAIL, AuthPrincipal.METHOD_PASSWORD);
        assertThat(service.isAdministrator()).isTrue();
        // A forged role claim in the token alone does not help: the database says USER.
        db.user(3, "third@example.com", null);
        org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
                new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                        new AuthPrincipal(3, "third@example.com", "ADMIN", 0, AuthPrincipal.METHOD_PASSWORD), null, List.of()));
        assertThat(service.isAdministrator()).isFalse();
    }

    @Test void pinningHappensOnceAndOnlyForAVerifiedAdministratorEmail() {
        User u = new User();
        admins.onGoogleSignIn(u, new GoogleTokenVerifier.GoogleIdentity("unverified", ADMIN_EMAIL, false, null, null));
        admins.onGoogleSignIn(u, new GoogleTokenVerifier.GoogleIdentity("someone", "other@example.com", true, null, null));
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_admins", Integer.class)).isZero();
        db.pinAdmin(admins);
        admins.onGoogleSignIn(u, new GoogleTokenVerifier.GoogleIdentity("second-sub", ADMIN_EMAIL, true, null, null));
        assertThat(db.jdbc.queryForList("SELECT google_sub FROM billing_admins", String.class)).containsExactly(ADMIN_SUB);
    }

    @Test void simulatorStaysOffUnlessTheDeploymentAllowsItAndTheAdminOpensIt() {
        // Deployment does not allow it: admin cannot switch it on.
        var locked = new BillingProperties("production", false, true, ADMIN_EMAIL, "", 7);
        var lockedAdmins = db.admins(locked);
        db.pinAdmin(lockedAdmins);
        var lockedService = new PremiumService(db.jdbc, locked, lockedAdmins);
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        assertThatThrownBy(() -> db.inTx(() -> lockedService.updateSettings(new PremiumDtos.Settings(true, true, true))))
                .isInstanceOf(ApiException.class);
        assertThat(lockedService.status(null).mode()).isEqualTo("GOOGLE_PLAY");
        // Single deployment that allows it: off by default, on only after the admin opens it.
        var single = new BillingProperties("production", true, true, ADMIN_EMAIL, "", 7);
        var singleService = new PremiumService(db.jdbc, single, db.admins(single));
        assertThat(singleService.status(null).sandboxAvailable()).isFalse();
        db.inTx(() -> singleService.updateSettings(new PremiumDtos.Settings(true, true, false)));
        assertThat(singleService.status(null).mode()).isEqualTo("SANDBOX");
    }

    @Test void settingChangesAreAudited() {
        db.pinAdmin(admins);
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        var console = db.inTx(() -> service.updateSettings(new PremiumDtos.Settings(true, true, false)));
        assertThat(console.settings().enrollmentOpen()).isTrue();
        assertThat(console.events().getFirst().type()).isEqualTo("SETTINGS_CHANGED");
        assertThat(console.events().getFirst().detail()).contains("enrollment false->true");
        assertThat(console.events().getFirst().actorId()).isEqualTo(1L);
    }

    // ── identities ──

    @Test void anonymousStatusDoesNotCreateABillingIdentity() {
        var status = db.inTx(() -> service.status(null));
        assertThat(status.subjectId()).isNull();
        assertThat(status.capabilities()).containsEntry("addLedger", true).containsEntry("reminders", true);
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_subjects", Integer.class)).isZero();
    }

    @Test void guestApplicationApprovalAndCancellationFollowTheEntitlementPolicy() {
        db.pinAdmin(admins);
        db.open(true);
        String guest = service.createGuest().token();
        var pending = db.inTx(() -> service.apply(guest, new PremiumDtos.Application("monthly", "apply-1")));
        assertThat(pending.active()).isFalse();
        assertThat(pending.capabilities()).containsEntry("scan", false).containsEntry("reminders", true);
        db.inTx(() -> service.apply(guest, new PremiumDtos.Application("monthly", "apply-1")));
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);
        var order = pending.subscriptions().getFirst();
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        var event = new PremiumDtos.Event("APPROVE", "approval-1", 0);
        db.inTx(() -> service.simulate(order.id(), event));
        db.inTx(() -> service.simulate(order.id(), event)); // idempotent replay
        var console = db.inTx(() -> service.console());
        assertThat(console.events()).extracting(PremiumDtos.AdminEvent::type).containsExactly("APPROVE", "APPLY");
        assertThat(console.events().getFirst().fromState()).isEqualTo("PENDING");
        assertThat(console.events().getFirst().toState()).isEqualTo("ACTIVE");
        signOut();
        var paid = service.status(guest);
        assertThat(paid.active()).isTrue();
        var canceled = db.inTx(() -> service.cancelSandbox(guest, order.id(), new PremiumDtos.Event("CANCEL", "cancel-1", 1)));
        assertThat(canceled.active()).as("canceled stays usable until expiry").isTrue();
        assertThat(canceled.expiresAt()).isEqualTo(paid.expiresAt());
        assertThat(canceled.subscriptions().getFirst().autoRenew()).isFalse();
    }

    @Test void withGuestSubscriptionsOffOnlySignedInAccountsCanApply() {
        var accountsOnly = new BillingProperties("production", true, false, ADMIN_EMAIL, "", 7, false);
        var strict = new PremiumService(db.jdbc, accountsOnly, db.admins(accountsOnly));
        db.open(true);
        String guest = strict.createGuest().token();
        assertThatThrownBy(() -> db.inTx(() -> strict.apply(guest, new PremiumDtos.Application("monthly", "g1"))))
                .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.code()).isEqualTo(ErrorCode.ACCOUNT_REQUIRED));
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions", Integer.class)).isZero();
        signIn(2, "other@example.com", AuthPrincipal.METHOD_PASSWORD);
        var applied = db.inTx(() -> strict.apply(null, new PremiumDtos.Application("monthly", "u1")));
        assertThat(applied.subscriptions().getFirst().state()).isEqualTo("PENDING");
    }

    @Test void aPendingApplicationCanBeWithdrawn() {
        db.open(false);
        String guest = service.createGuest().token();
        var order = db.inTx(() -> service.apply(guest, new PremiumDtos.Application("yearly", "k"))).subscriptions().getFirst();
        var after = db.inTx(() -> service.cancelSandbox(guest, order.id(), new PremiumDtos.Event("CANCEL", "w", 0)));
        assertThat(after.subscriptions().getFirst().state()).isEqualTo("PENDING_PURCHASE_CANCELED");
        // A new application is allowed afterwards.
        db.inTx(() -> service.apply(guest, new PremiumDtos.Application("monthly", "k2")));
    }

    @Test void guestClaimIsExplicitAndHappensOnce() {
        db.pinAdmin(admins);
        db.open(true);
        String guest = service.createGuest().token();
        approve(guest, "yearly");
        signIn(2, "other@example.com", AuthPrincipal.METHOD_PASSWORD);
        assertThat(service.status(null).active()).as("not shared before claiming").isFalse();
        db.inTx(() -> service.claimGuest(guest));
        assertThat(service.status(null).active()).isTrue();
        assertThatThrownBy(() -> db.inTx(() -> service.claimGuest(guest))).isInstanceOf(ApiException.class);
        // A different account cannot claim it either.
        signIn(3, "third@example.com", AuthPrincipal.METHOD_PASSWORD);
        assertThatThrownBy(() -> db.inTx(() -> service.claimGuest(guest))).isInstanceOf(ApiException.class);
        assertThat(service.status(null).active()).isFalse();
        signOut();
        assertThatThrownBy(() -> service.status(guest)).as("guest credential retired").isInstanceOf(ApiException.class);
    }

    @Test void simulatedEntitlementStopsWhenTheSimulatorIsClosed() {
        db.pinAdmin(admins);
        db.open(true);
        String guest = service.createGuest().token();
        approve(guest, "monthly");
        assertThat(service.status(guest).active()).isTrue();
        db.jdbc.update("UPDATE billing_settings SET sandbox_open=FALSE");
        assertThat(service.status(guest).active()).isFalse();
        assertThat(service.status(guest).subscriptions()).isEmpty();
    }

    @Test void refundOnlyKeepsAccessButRefundAndRevokeRemovesIt() {
        db.pinAdmin(admins);
        db.open(true);
        String guest = service.createGuest().token();
        var order = approve(guest, "monthly");
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        db.inTx(() -> service.simulate(order.id(), new PremiumDtos.Event("REFUND_ONLY", "r1", 1)));
        signOut();
        var refunded = service.status(guest);
        assertThat(refunded.active()).isTrue();
        assertThat(refunded.subscriptions().getFirst().refundType()).isEqualTo("SIMULATED_REFUND");
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        db.inTx(() -> service.simulate(order.id(), new PremiumDtos.Event("REVOKE", "r2", 2)));
        signOut();
        assertThat(service.status(guest).active()).isFalse();
        assertThat(service.status(guest).subscriptions().getFirst().state()).isEqualTo("REVOKED");
    }

    @Test void staleRevisionIsRejected() {
        db.pinAdmin(admins);
        db.open(true);
        String guest = service.createGuest().token();
        var order = approve(guest, "monthly");
        signIn(1, ADMIN_EMAIL, AuthPrincipal.METHOD_GOOGLE);
        assertThatThrownBy(() -> db.inTx(() -> service.simulate(order.id(), new PremiumDtos.Event("RENEW", "x", 0))))
                .isInstanceOf(ApiException.class).hasMessageContaining("reload");
    }

    @Test void duplicateConcurrentApplicationsCannotCreateTwoOrders() throws Exception {
        db.open(false);
        String guest = service.createGuest().token();
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            Callable<PremiumDtos.Status> work = () -> db.inTx(() -> service.apply(guest, new PremiumDtos.Application("monthly", "same-key")));
            for (var result : pool.invokeAll(List.of(work, work))) assertThat(result.get().subscriptions()).hasSize(1);
        }
        assertThat(db.jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);
    }

    // ── server-side gate with sync grace ──

    long accountSubscription(long userId, String state, Instant expiry, Instant until, boolean revoked) {
        long subject = service.forUser(userId).id();
        db.jdbc.update("INSERT INTO billing_subscriptions (public_id, subject_id, provider, base_plan, subscription_state, request_key, "
                        + "expires_at, entitled_until, revoked_at) VALUES (?, ?, 'SANDBOX', 'monthly', ?, ?, ?, ?, ?)",
                java.util.UUID.randomUUID().toString(), subject, state, java.util.UUID.randomUUID().toString(),
                ts(expiry), until == null ? null : ts(until), revoked ? ts(Instant.now()) : null);
        return subject;
    }

    @Test void gatesOffNeverBlock() {
        assertThatCode(() -> service.requireFeature(2, "addLedger")).doesNotThrowAnyException();
    }

    @Test void gatedWritesNeedMembershipWithASevenDaySyncGrace() {
        db.open(true);
        assertThatThrownBy(() -> service.requireFeature(2, "addLedger"))
                .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.code()).isEqualTo(ErrorCode.PREMIUM_REQUIRED));
        Instant threeDaysAgo = Instant.now().minusSeconds(3 * 86400);
        accountSubscription(2, "EXPIRED", threeDaysAgo, threeDaysAgo, false);
        assertThatCode(() -> service.requireFeature(2, "exchange")).as("within grace").doesNotThrowAnyException();
        assertThat(service.status(null).active()).isFalse();

        Instant eightDaysAgo = Instant.now().minusSeconds(8 * 86400);
        accountSubscription(3, "EXPIRED", eightDaysAgo, eightDaysAgo, false);
        assertThatThrownBy(() -> service.requireFeature(3, "exchange")).isInstanceOf(ApiException.class);
    }

    @Test void revokedMembershipGetsNoGrace() {
        db.open(true);
        accountSubscription(2, "REVOKED", Instant.now().minusSeconds(60), null, true);
        assertThatThrownBy(() -> service.requireFeature(2, "financialPlan")).isInstanceOf(ApiException.class);
    }

    @Test void scanGateHasNoGraceAndNeedsAnIdentity() {
        db.open(true);
        assertThat(db.inTx(() -> service.scanAllowed(null))).isFalse();
        Instant yesterday = Instant.now().minusSeconds(86400);
        accountSubscription(2, "EXPIRED", yesterday, yesterday, false);
        signIn(2, "other@example.com", AuthPrincipal.METHOD_PASSWORD);
        assertThat(db.inTx(() -> service.scanAllowed(null))).isFalse();
        accountSubscription(2, "ACTIVE", Instant.now().plusSeconds(3600), Instant.now().plusSeconds(3600), false);
        assertThat(db.inTx(() -> service.scanAllowed(null))).isTrue();
    }
}
