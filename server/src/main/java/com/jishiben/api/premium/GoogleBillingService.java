package com.jishiben.api.premium;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.security.AuthPrincipal;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Real Google Play subscriptions. Google is always asked first (outside any database transaction),
 * then the result is applied in a short transaction that locks only the affected purchase row.
 * Membership is granted automatically once Google reports the purchase; simulator events can never
 * touch these rows.
 */
@Service
public class GoogleBillingService {
    private static final Logger log = LoggerFactory.getLogger(GoogleBillingService.class);
    static final int NOTIFICATION_REVOKED = 12;

    private final PremiumService premium;
    private final GooglePlayGateway google;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final BillingProperties props;

    public GoogleBillingService(PremiumService premium, GooglePlayGateway google, ObjectMapper json,
                                PlatformTransactionManager transactions, BillingProperties props) {
        this.premium = premium;
        this.google = google;
        this.json = json;
        this.tx = new TransactionTemplate(transactions);
        this.props = props;
    }

    // ───────────────────────────── client verification / restore ─────────────────────────────

    /**
     * Verifies a purchase reported by the app. {@code restore} is set for purchases found by
     * querying Play (reinstall / new phone / app start); {@code claim} is the user's confirmation
     * to move an unbound guest purchase into the signed-in account.
     */
    public PremiumDtos.Status verify(String guest, String token, boolean restore, boolean claim) {
        requireGoogle();
        premium.requireAccountForSubscribing();
        PremiumService.Subject caller = premium.subject(guest);
        PremiumService.Row known = find(token, false);
        if (known == null && !restore && !premium.settings().enrollmentOpen()) {
            throw ApiException.forbidden("New subscriptions are closed");
        }
        GooglePlayGateway.Verified verified = verifyWithGoogle(token);
        PremiumService.Subject owner = tx.execute(status -> attach(caller, guest, token, verified, restore, claim));
        acknowledgeIfNeeded(token, verified);
        return tx.execute(status -> premium.statusFor(owner));
    }

    private GooglePlayGateway.Verified verifyWithGoogle(String token) {
        try {
            return google.verify(token);
        } catch (GooglePlayGateway.Unsupported ex) {
            throw ApiException.validation(ex.getMessage());
        }
    }

    private PremiumService.Subject attach(PremiumService.Subject caller, String guest, String token,
                                          GooglePlayGateway.Verified v, boolean restore, boolean claim) {
        PremiumService.Row existing = find(token, true);
        Long ownerSubject = existing != null ? Long.valueOf(existing.subjectId()) : subjectForAccount(v);
        if (ownerSubject == null) {
            throw ApiException.forbidden("Google purchase account mapping does not match this app identity");
        }
        long ownerRoot = premium.rootOf(ownerSubject);
        PremiumService.Subject owner = caller;
        if (ownerRoot != caller.id()) {
            if (!premium.unclaimed(ownerRoot)) {
                throw new ApiException(HttpStatus.CONFLICT, ErrorCode.BILLING_OWNED_BY_OTHER,
                        "This Google Play subscription belongs to another app account; sign in to that account");
            }
            AuthPrincipal signedIn = BillingAdminService.principal();
            if (signedIn == null) {
                // Same Play account, fresh install: the new guest credential takes over the old,
                // never-bound guest identity. Only when this device's guest has nothing of its own.
                if (!restore || guest == null || !premium.rowsFor(caller.id()).isEmpty()) {
                    throw new ApiException(HttpStatus.CONFLICT, ErrorCode.BILLING_OWNED_BY_OTHER,
                            "This purchase belongs to another billing identity");
                }
                premium.jdbc.update("UPDATE billing_subjects SET guest_hash=NULL WHERE id=?", caller.id());
                premium.jdbc.update("UPDATE billing_subjects SET guest_hash=? WHERE id=?", PremiumService.digest(guest), ownerRoot);
                premium.audit("guest-restore:" + UUID.randomUUID(), null, null, "GUEST_RESTORED", null, null, null);
                owner = premium.subjectById(ownerRoot);
            } else {
                if (!claim) {
                    throw new ApiException(HttpStatus.CONFLICT, ErrorCode.BILLING_CLAIM_REQUIRED,
                            "This purchase belongs to a guest identity; confirm to bind it to this account");
                }
                premium.mergeInto(ownerRoot, caller, signedIn.id(), "PURCHASE_CLAIMED");
            }
        }
        persist(existing, ownerSubject, token, v, false);
        return owner;
    }

    /** The subject Google says the purchase was made for (obfuscatedAccountId), if known here. */
    private Long subjectForAccount(GooglePlayGateway.Verified v) {
        for (String account : List.of(v.accountId(), v.expiredAccountId())) {
            if (account == null || account.isBlank()) continue;
            List<Long> ids = premium.jdbc.query("SELECT id FROM billing_subjects WHERE account_hash=?", (rs, i) -> rs.getLong(1), account);
            if (!ids.isEmpty()) return ids.getFirst();
        }
        return null;
    }

    /** Inserts or updates the purchase row from Google's state. Must run inside a transaction. */
    private void persist(PremiumService.Row existing, long subjectId, String token, GooglePlayGateway.Verified v, boolean revokedNow) {
        Instant now = Instant.now();
        String hash = PremiumService.digest(token);
        if (existing == null) {
            String id = UUID.randomUUID().toString();
            premium.jdbc.update("INSERT INTO billing_subscriptions (public_id, subject_id, provider, base_plan, subscription_state, "
                            + "request_key, token_hash, token_cipher) VALUES (?, ?, 'GOOGLE_PLAY', ?, ?, ?, ?, ?)",
                    id, subjectId, v.plan(), v.state(), id, hash, google.encrypt(token));
            existing = find(token, true);
        }
        boolean revoked = revokedNow || existing.revokedAt() != null;
        Instant until = SubscriptionPolicy.entitledUntil(existing.state(), existing.expiry(), existing.entitledUntil(),
                v.state(), v.expiry(), revoked, now);
        premium.jdbc.update("UPDATE billing_subscriptions SET base_plan=?, subscription_state=?, expires_at=?, auto_renew=?, "
                        + "acknowledged=?, test_purchase=?, entitled_until=?, revoked_at=?, last_checked_at=?, next_check_at=?, "
                        + "failures=0, revision=revision+1 WHERE id=?",
                v.plan(), v.state(), PremiumService.timestamp(v.expiry()), v.autoRenew(), v.acknowledged() || existing.acknowledged(),
                v.testPurchase(), PremiumService.timestamp(until),
                PremiumService.timestamp(revokedNow && existing.revokedAt() == null ? now : existing.revokedAt()),
                PremiumService.timestamp(now), PremiumService.timestamp(now.plusSeconds(nextCheckSeconds(v))), existing.id());
        if (!existing.state().equals(v.state()) || revokedNow) {
            premium.audit("google:" + UUID.randomUUID(), existing.id(), null, revokedNow ? "GOOGLE_REVOKED" : "GOOGLE_STATE",
                    existing.state(), v.state(), v.testPurchase() ? "test purchase" : null);
        }
        // A replacement purchase (resubscribe / plan change) retires the token it replaces, but only
        // when that token belongs to the same owner.
        for (String replaced : List.of(v.linkedToken(), v.expiredToken())) {
            if (replaced == null || replaced.isBlank()) continue;
            PremiumService.Row old = find(replaced, true);
            if (old == null || old.id() == existing.id()) continue;
            if (premium.rootOf(old.subjectId()) != premium.rootOf(existing.subjectId())) {
                log.warn("Linked purchase belongs to a different owner; not retired");
                continue;
            }
            if (SubscriptionPolicy.entitled(old.state(), old.expiry(), now) || !"EXPIRED".equals(old.state())) {
                premium.jdbc.update("UPDATE billing_subscriptions SET subscription_state='EXPIRED', auto_renew=FALSE, expires_at=?, "
                                + "entitled_until=?, revision=revision+1 WHERE id=?",
                        PremiumService.timestamp(now), PremiumService.timestamp(SubscriptionPolicy.entitled(old.state(), old.expiry(), now) ? now : old.entitledUntil()),
                        old.id());
                premium.audit("google-replaced:" + UUID.randomUUID(), old.id(), null, "GOOGLE_REPLACED", old.state(), "EXPIRED", null);
            }
        }
        premium.jdbc.update("DELETE FROM billing_orphans WHERE token_hash=?", hash);
    }

    private static long nextCheckSeconds(GooglePlayGateway.Verified v) {
        if (!v.acknowledged() && SubscriptionPolicy.entitled(v.state(), v.expiry(), Instant.now())) return 60;
        if ("PENDING".equals(v.state())) return 300;
        return 6 * 3600;
    }

    /** Acknowledge right after the grant is committed; failures are retried by the reconciler. */
    void acknowledgeIfNeeded(String token, GooglePlayGateway.Verified v) {
        if (v.acknowledged() || !SubscriptionPolicy.entitled(v.state(), v.expiry(), Instant.now())) return;
        try {
            google.acknowledge(token);
            premium.jdbc.update("UPDATE billing_subscriptions SET acknowledged=TRUE WHERE token_hash=?", PremiumService.digest(token));
        } catch (ApiException ex) {
            log.warn("Purchase acknowledgement failed; the reconciler will retry");
        }
    }

    // ───────────────────────────── real-time developer notifications ─────────────────────────────

    public void notification(String authorization, JsonNode envelope) {
        requireGoogle();
        google.verifyPush(authorization);
        JsonNode message = envelope.path("message");
        String messageId = message.path("messageId").asText();
        String encoded = message.path("data").asText();
        if (messageId.isBlank() || encoded.isBlank() || encoded.length() > 65536) throw ApiException.badRequest("Invalid notification");
        JsonNode event;
        try {
            event = json.readTree(Base64.getDecoder().decode(encoded));
        } catch (Exception ex) {
            throw ApiException.badRequest("Invalid notification data");
        }
        String eventKey = "rtdn:" + PremiumService.digest(messageId);
        if (premium.eventExists(eventKey)) return;
        if (!google.packageName().equals(event.path("packageName").asText())) {
            record(eventKey, "GOOGLE_OTHER_PACKAGE");
            return;
        }
        if (event.has("testNotification")) {
            record(eventKey, "GOOGLE_TEST");
            return;
        }
        if (event.has("voidedPurchaseNotification")) {
            JsonNode voided = event.path("voidedPurchaseNotification");
            if (voided.path("productType").asInt(1) != 1) {
                record(eventKey, "GOOGLE_IGNORED");
                return;
            }
            String token = voided.path("purchaseToken").asText();
            recordRefund(token, voided.path("refundType").asInt(1));
            refresh(token, 0);
            record(eventKey, "GOOGLE_VOIDED");
            return;
        }
        if (event.has("subscriptionNotification")) {
            JsonNode sub = event.path("subscriptionNotification");
            refresh(sub.path("purchaseToken").asText(), sub.path("notificationType").asInt(0));
            record(eventKey, "GOOGLE_RTDN_" + sub.path("notificationType").asInt(0));
            return;
        }
        record(eventKey, "GOOGLE_IGNORED");
    }

    private void record(String key, String type) {
        try {
            premium.audit(key, null, null, type, null, null, null);
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            // Delivered twice concurrently; already processed.
        }
    }

    /**
     * Re-reads Google's state for a token and applies it to whichever owner it belongs to. Unknown
     * owners are parked as orphans (2xx to Pub/Sub, so it does not retry forever) and picked up by
     * the reconciler once the app reports the purchase.
     */
    void refresh(String token, int notificationType) {
        if (token == null || token.isBlank()) return;
        GooglePlayGateway.Verified v;
        try {
            v = google.verify(token);
        } catch (GooglePlayGateway.Unsupported ex) {
            log.warn("Ignoring unsupported Google purchase: {}", ex.getMessage());
            return;
        } catch (ApiException ex) {
            if (ex.code() == ErrorCode.BAD_REQUEST) {
                log.warn("Google no longer recognises a stored purchase token");
                return;
            }
            throw ex; // transient: Pub/Sub or the reconciler retries
        }
        boolean attributed = Boolean.TRUE.equals(tx.execute(status -> {
            PremiumService.Row existing = find(token, true);
            Long owner = existing != null ? Long.valueOf(existing.subjectId()) : null;
            if (owner == null) {
                for (String other : List.of(v.linkedToken(), v.expiredToken())) {
                    if (owner != null || other == null || other.isBlank()) continue;
                    PremiumService.Row linked = find(other, false);
                    if (linked != null) owner = premium.rootOf(linked.subjectId());
                }
            }
            if (owner == null) owner = subjectForAccount(v);
            if (owner == null) {
                premium.jdbc.update("INSERT INTO billing_orphans (token_hash, token_cipher, account_hash) SELECT ?, ?, ? "
                                + "WHERE NOT EXISTS (SELECT 1 FROM billing_orphans WHERE token_hash=?)",
                        PremiumService.digest(token), google.encrypt(token), v.accountId(), PremiumService.digest(token));
                return false;
            }
            persist(existing, owner, token, v, notificationType == NOTIFICATION_REVOKED);
            return true;
        }));
        if (attributed) acknowledgeIfNeeded(token, v);
    }

    void recordRefund(String token, int refundType) {
        if (token == null || token.isBlank()) return;
        String type = refundType == 2 ? "PARTIAL_REFUND" : "FULL_REFUND";
        tx.executeWithoutResult(status -> {
            PremiumService.Row row = find(token, true);
            if (row == null || row.refundedAt() != null) return;
            premium.jdbc.update("UPDATE billing_subscriptions SET refunded_at=?, refund_type=?, revision=revision+1 WHERE id=?",
                    PremiumService.timestamp(Instant.now()), type, row.id());
            premium.audit("google-refund:" + UUID.randomUUID(), row.id(), null, "GOOGLE_REFUND", row.state(), row.state(), type);
        });
    }

    // ───────────────────────────── background reconciliation ─────────────────────────────

    /** Re-checks one stored purchase (acknowledgement retry, missed notifications). */
    void reconcile(String tokenHash) {
        String cipher = premium.jdbc.query("SELECT token_cipher FROM billing_subscriptions WHERE token_hash=? AND provider='GOOGLE_PLAY'",
                (rs, i) -> rs.getString(1), tokenHash).stream().findFirst().orElse(null);
        if (cipher != null) refresh(google.decrypt(cipher), 0);
    }

    /** Tries to attribute a parked purchase; gives up after four days (Google refunds it). */
    void reconcileOrphan(String tokenHash) {
        String cipher = premium.jdbc.query("SELECT token_cipher FROM billing_orphans WHERE token_hash=?",
                (rs, i) -> rs.getString(1), tokenHash).stream().findFirst().orElse(null);
        if (cipher == null) return;
        refresh(google.decrypt(cipher), 0);
        premium.jdbc.update("UPDATE billing_orphans SET attempts=attempts+1 WHERE token_hash=?", tokenHash);
        premium.jdbc.update("DELETE FROM billing_orphans WHERE token_hash=? AND created_at < ?", tokenHash,
                PremiumService.timestamp(Instant.now().minusSeconds(4 * 86400)));
    }

    /** Applies the Voided Purchases API since the given instant. */
    int applyVoided(Instant since) {
        int applied = 0;
        for (GooglePlayGateway.Voided voided : google.voided(since)) {
            if (find(voided.purchaseToken(), false) == null) continue;
            recordRefund(voided.purchaseToken(), voided.refundType());
            refresh(voided.purchaseToken(), 0);
            applied++;
        }
        return applied;
    }

    private PremiumService.Row find(String token, boolean forUpdate) {
        return premium.jdbc.query("SELECT * FROM billing_subscriptions WHERE token_hash=?" + (forUpdate ? " FOR UPDATE" : ""),
                PremiumService::row, PremiumService.digest(token)).stream().findFirst().orElse(null);
    }

    boolean enabled() { return props.googleEnabled(); }

    void requireGoogle() {
        if (!props.googleEnabled()) throw ApiException.forbidden("Google Play billing is not enabled in this deployment");
    }
}
