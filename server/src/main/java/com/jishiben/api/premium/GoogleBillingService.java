package com.jishiben.api.premium;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jishiben.api.common.ApiException;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GoogleBillingService {
    private final PremiumService premium;
    private final GooglePlayGateway google;
    private final ObjectMapper json;
    public GoogleBillingService(PremiumService premium, GooglePlayGateway google, ObjectMapper json) {
        this.premium = premium; this.google = google; this.json = json;
    }

    @Transactional
    public PremiumDtos.Status verify(String guest, String token, boolean restore) {
        requireMode();
        premium.lockSettings();
        var subject = premium.subject(guest);
        var existing = find(token);
        if (existing == null && !restore && !premium.settings().enrollmentOpen()) throw ApiException.forbidden("New subscriptions are closed");
        var verified = google.verify(token);
        if (existing != null && !owns(subject.id(), existing.subjectId())) {
            // Google can restore an unclaimed guest purchase on the same Play account after reinstall.
            // Already registered/claimed purchases require the original app account.
            if (!restore || PremiumService.authenticated() != null || guest == null)
                throw ApiException.conflict("Purchase belongs to another billing identity; sign in to the original account");
            Integer unclaimed = premium.jdbc.queryForObject("SELECT COUNT(*) FROM billing_subjects WHERE id=? AND user_id IS NULL AND linked_to IS NULL", Integer.class, existing.subjectId());
            if (unclaimed == null || unclaimed != 1 || !premium.rowsFor(subject.id()).isEmpty())
                throw ApiException.conflict("Purchase belongs to an existing account");
            premium.jdbc.update("UPDATE billing_subjects SET guest_hash=NULL WHERE id=?", subject.id());
            premium.jdbc.update("UPDATE billing_subjects SET guest_hash=? WHERE id=?", PremiumService.digest(guest), existing.subjectId());
            subject = premium.subject(guest);
        }
        persist(token, verified, subject);
        return premium.statusFor(subject);
    }

    private boolean owns(long subject, long owner) {
        return Boolean.TRUE.equals(premium.jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM billing_subjects WHERE id=? AND (id=? OR linked_to=?))",
                Boolean.class, owner, subject, subject));
    }
    private PremiumService.Row find(String token) {
        return premium.jdbc.query("SELECT * FROM billing_subscriptions WHERE token_hash=?", PremiumService::row,
                PremiumService.digest(token)).stream().findFirst().orElse(null);
    }

    private void persist(String token, GooglePlayGateway.Verified v, PremiumService.Subject subject) {
        var existing = find(token);
        if (existing != null && !owns(subject.id(), existing.subjectId())) throw ApiException.conflict("Purchase already bound to another account");
        if (existing == null) {
            List<Long> matches = premium.jdbc.query("SELECT id FROM billing_subjects WHERE account_hash=? AND (id=? OR linked_to=?)",
                    (rs, i) -> rs.getLong(1), v.accountId(), subject.id(), subject.id());
            if (matches.isEmpty()) throw ApiException.forbidden("Google purchase account mapping does not match");
            String id = UUID.randomUUID().toString();
            premium.jdbc.update("INSERT INTO billing_subscriptions (public_id,subject_id,provider,base_plan,subscription_state,request_key,token_hash,token_cipher) "
                    + "VALUES (?,?,'GOOGLE_PLAY',?,?,?,?,?)", id, matches.getFirst(), v.plan(), v.state(), id,
                    PremiumService.digest(token), google.encrypt(token));
            existing = find(token);
        }
        // Invalidate a replaced token only after checking it belongs to this same identity.
        if (!v.linkedToken().isBlank()) {
            var old = find(v.linkedToken());
            if (old != null) {
                if (!owns(subject.id(), old.subjectId())) throw ApiException.conflict("Linked purchase belongs to another account");
                premium.jdbc.update("UPDATE billing_subscriptions SET subscription_state='EXPIRED',auto_renew=FALSE,expires_at=?,revision=revision+1 WHERE id=?",
                        PremiumService.timestamp(Instant.now()), old.id());
            }
        }
        premium.jdbc.update("UPDATE billing_subscriptions SET base_plan=?,subscription_state=?,expires_at=?,auto_renew=?,acknowledged=?,last_checked_at=?,next_check_at=?,failures=0,revision=revision+1 WHERE id=?",
                v.plan(), v.state(), PremiumService.timestamp(v.expiry()), v.autoRenew(), v.acknowledged(), PremiumService.timestamp(Instant.now()), PremiumService.timestamp(Instant.now().plusSeconds(v.acknowledged() ? 3600 : 60)), existing.id());
    }

    @Transactional
    public void notification(String authorization, JsonNode envelope) {
        requireMode();
        google.verifyPush(authorization);
        JsonNode message = envelope.path("message");
        String messageId = message.path("messageId").asText();
        if (messageId.isBlank() || message.path("data").asText().length() > 65536) throw ApiException.badRequest("Invalid notification");
        JsonNode event;
        try { event = json.readTree(Base64.getDecoder().decode(message.path("data").asText())); }
        catch (Exception ex) { throw ApiException.badRequest("Invalid notification data"); }
        if (!google.packageName().equals(event.path("packageName").asText())) throw ApiException.badRequest("Unexpected package");
        premium.lockSettings();
        String eventKey = "rtdn:" + PremiumService.digest(messageId);
        if (Boolean.TRUE.equals(premium.jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM billing_events WHERE event_key=?)", Boolean.class, eventKey))) return;
        if (event.has("testNotification")) { premium.audit(eventKey, null, null, "GOOGLE_TEST"); return; }
        String token = event.path("subscriptionNotification").path("purchaseToken").asText();
        if (token.isBlank()) token = event.path("voidedPurchaseNotification").path("purchaseToken").asText();
        if (token.isBlank()) { premium.audit(eventKey, null, null, "GOOGLE_IGNORED"); return; }
        var v = google.verify(token);
        var old = find(token);
        Long owner = old == null ? null : old.subjectId();
        if (owner == null && !v.linkedToken().isBlank()) { var linked = find(v.linkedToken()); if (linked != null) owner = linked.subjectId(); }
        if (owner == null && !v.expiredToken().isBlank()) { var expired = find(v.expiredToken()); if (expired != null) owner = expired.subjectId(); }
        if (owner == null && !v.accountId().isBlank()) {
            var matches = premium.jdbc.query("SELECT id FROM billing_subjects WHERE account_hash=?", (rs, i) -> rs.getLong(1), v.accountId());
            if (!matches.isEmpty()) owner = matches.getFirst();
        }
        if (owner == null) throw ApiException.upstream("Purchase identity is not yet available; notification will retry");
        long source = owner;
        long root = premium.jdbc.queryForObject("SELECT COALESCE(linked_to,id) FROM billing_subjects WHERE id=?", Long.class, source);
        String rootPublic = premium.jdbc.queryForObject("SELECT public_id FROM billing_subjects WHERE id=?", String.class, root);
        persist(token, v, new PremiumService.Subject(root, rootPublic));
        premium.audit(eventKey, find(token).id(), null, "GOOGLE_REFRESH");
    }

    @Transactional
    public void reconcile(String tokenHash) {
        requireMode();
        premium.lockSettings();
        var data = premium.jdbc.queryForList("SELECT token_cipher,subject_id FROM billing_subscriptions WHERE token_hash=? AND provider='GOOGLE_PLAY'", tokenHash);
        if (data.isEmpty()) return;
        String token = google.decrypt((String) data.getFirst().get("token_cipher"));
        long source = ((Number) data.getFirst().get("subject_id")).longValue();
        long root = premium.jdbc.queryForObject("SELECT COALESCE(linked_to,id) FROM billing_subjects WHERE id=?", Long.class, source);
        String rootPublic = premium.jdbc.queryForObject("SELECT public_id FROM billing_subjects WHERE id=?", String.class, root);
        var v = google.verify(token);
        persist(token, v, new PremiumService.Subject(root, rootPublic));
        // This method runs only for already committed purchases. Granting and acknowledgment are separate durable phases.
        if (!v.acknowledged() && SubscriptionPolicy.entitled(v.state(), v.expiry(), Instant.now())) {
            google.acknowledge(token);
            premium.jdbc.update("UPDATE billing_subscriptions SET acknowledged=TRUE WHERE token_hash=?", tokenHash);
        }
    }
    void requireMode() { if (!"GOOGLE_PLAY".equals(premium.mode)) throw ApiException.forbidden("Google Play billing is not enabled"); }
}
