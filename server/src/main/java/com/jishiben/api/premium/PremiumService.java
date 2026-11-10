package com.jishiben.api.premium;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.security.CurrentUser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Billing identities (guest / account), entitlement and the staging-only simulator.
 *
 * <p>Ownership model: a subscription belongs to a billing subject. A signed-in account has one
 * subject; a guest subject is proven by a random bearer credential whose digest is stored. A guest
 * subject is only ever attached to an account by an explicit user action (claim), and a subject that
 * already belongs to an account is never moved to another account automatically.
 */
@Service
public class PremiumService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Set<String> OPEN_STATES = Set.of("PENDING", "ON_HOLD", "PAUSED");

    final JdbcTemplate jdbc;
    final BillingProperties props;
    private final BillingAdminService admins;

    public PremiumService(JdbcTemplate jdbc, BillingProperties props, BillingAdminService admins) {
        this.jdbc = jdbc;
        this.props = props;
        this.admins = admins;
    }

    public record Subject(long id, String publicId, String accountHash) {}

    record Row(long id, long subjectId, String publicId, String provider, String plan, String state,
               Instant expiry, boolean autoRenew, int revision, boolean acknowledged, Instant entitledUntil,
               boolean testPurchase, Instant refundedAt, String refundType, Instant revokedAt) {
        PremiumDtos.Subscription dto() {
            return new PremiumDtos.Subscription(publicId, provider, plan, state, expiry, autoRenew, revision,
                    acknowledged, testPurchase, refundedAt, refundType);
        }
    }

    static Row row(ResultSet rs, int ignored) throws SQLException {
        return new Row(rs.getLong("id"), rs.getLong("subject_id"), rs.getString("public_id"),
                rs.getString("provider"), rs.getString("base_plan"), rs.getString("subscription_state"),
                instant(rs, "expires_at"), rs.getBoolean("auto_renew"), rs.getInt("revision"),
                rs.getBoolean("acknowledged"), instant(rs, "entitled_until"), rs.getBoolean("test_purchase"),
                instant(rs, "refunded_at"), rs.getString("refund_type"), instant(rs, "revoked_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static final String SUBJECT_COLUMNS = "SELECT id, public_id, account_hash FROM billing_subjects ";

    private static Subject subjectRow(ResultSet rs, int ignored) throws SQLException {
        return new Subject(rs.getLong(1), rs.getString(2), rs.getString(3));
    }

    // ───────────────────────────── identities ─────────────────────────────

    @Transactional
    public PremiumDtos.Guest createGuest() {
        byte[] secret = new byte[32];
        RANDOM.nextBytes(secret);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO billing_subjects (public_id, account_hash, guest_hash) VALUES (?, ?, ?)",
                id, digest(id), digest(token));
        return new PremiumDtos.Guest(token);
    }

    /** The caller's subject: the signed-in account, otherwise the presented guest credential. */
    public Subject subject(String guestToken) {
        Subject subject = optionalSubject(guestToken);
        if (subject == null) throw ApiException.unauthorized("Billing identity required");
        return subject;
    }

    /** Like {@link #subject} but returns null for an anonymous caller without any billing identity. */
    public Subject optionalSubject(String guestToken) {
        AuthPrincipal caller = BillingAdminService.principal();
        if (caller != null) return forUser(caller.id());
        if (guestToken == null || guestToken.isBlank()) return null;
        if (guestToken.length() > 128) throw ApiException.unauthorized("Guest billing identity is not valid");
        return jdbc.query(SUBJECT_COLUMNS + "WHERE guest_hash=? AND user_id IS NULL AND linked_to IS NULL",
                PremiumService::subjectRow, digest(guestToken)).stream().findFirst()
                .orElseThrow(() -> ApiException.unauthorized("Guest billing identity is no longer valid"));
    }

    Subject forUser(long userId) {
        List<Subject> existing = jdbc.query(SUBJECT_COLUMNS + "WHERE user_id=?", PremiumService::subjectRow, userId);
        if (!existing.isEmpty()) return existing.getFirst();
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update("INSERT INTO billing_subjects (public_id, account_hash, user_id) VALUES (?, ?, ?)", id, digest(id), userId);
        } catch (DuplicateKeyException race) {
            // Another request created it first; the unique key on user_id keeps exactly one.
        }
        return jdbc.query(SUBJECT_COLUMNS + "WHERE user_id=?", PremiumService::subjectRow, userId).getFirst();
    }

    /** Root subject (the account subject a guest was bound to, or the subject itself). */
    long rootOf(long subjectId) {
        return jdbc.queryForObject("SELECT COALESCE(linked_to, id) FROM billing_subjects WHERE id=?", Long.class, subjectId);
    }

    Subject subjectById(long id) {
        return jdbc.query(SUBJECT_COLUMNS + "WHERE id=?", PremiumService::subjectRow, id).getFirst();
    }

    /** True when the root subject belongs to no account (a guest, or an account that was deleted). */
    boolean unclaimed(long rootId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_subjects WHERE id=? AND user_id IS NULL AND linked_to IS NULL", Integer.class, rootId);
        return count != null && count == 1;
    }

    boolean owns(Subject subject, long ownerSubjectId) {
        return rootOf(ownerSubjectId) == subject.id();
    }

    /**
     * Explicitly binds the guest identity presented by this device to the signed-in account. The
     * guest credential stops working; its purchases (and Google obfuscated account id) stay valid.
     */
    @Transactional
    public PremiumDtos.Status claimGuest(String token) {
        long userId = CurrentUser.id();
        Subject target = forUser(userId);
        List<Subject> guests = jdbc.query(SUBJECT_COLUMNS
                        + "WHERE guest_hash=? AND user_id IS NULL AND linked_to IS NULL FOR UPDATE",
                PremiumService::subjectRow, digest(token));
        if (guests.isEmpty()) throw ApiException.conflict("Guest identity was already bound or is not valid");
        mergeInto(guests.getFirst().id(), target, userId, "GUEST_CLAIMED");
        return statusFor(target);
    }

    /** Re-points an unclaimed root (and anything bound to it) at the target account subject. */
    void mergeInto(long rootId, Subject target, Long actor, String eventType) {
        if (rootId == target.id()) return;
        jdbc.update("UPDATE billing_subjects SET linked_to=?, guest_hash=NULL WHERE id=? OR linked_to=?",
                target.id(), rootId, rootId);
        audit(eventType + ":" + UUID.randomUUID(), null, actor, eventType, null, null, null);
    }

    // ───────────────────────────── entitlement ─────────────────────────────

    public PremiumDtos.Settings settings() {
        return jdbc.queryForObject("SELECT enrollment_open, sandbox_open, gates_enabled FROM billing_settings WHERE id=1", (rs, i) ->
                new PremiumDtos.Settings(rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3)));
    }

    boolean sandboxActive(PremiumDtos.Settings cfg) {
        return props.sandboxAllowed() && cfg.sandboxOpen();
    }

    private boolean counts(Row row, PremiumDtos.Settings cfg) {
        return "GOOGLE_PLAY".equals(row.provider()) || ("SANDBOX".equals(row.provider()) && sandboxActive(cfg));
    }

    private String mode(PremiumDtos.Settings cfg) {
        return sandboxActive(cfg) ? "SANDBOX" : props.googleEnabled() ? "GOOGLE_PLAY" : "NONE";
    }

    @Transactional
    public PremiumDtos.Status status(String guestToken) {
        Subject subject = optionalSubject(guestToken);
        return subject == null ? anonymousStatus() : statusFor(subject);
    }

    PremiumDtos.Status anonymousStatus() {
        PremiumDtos.Settings cfg = settings();
        Instant now = Instant.now();
        return new PremiumDtos.Status(true, false, false, null, null, mode(cfg), props.environment(), props.googleEnabled(),
                cfg.enrollmentOpen(), sandboxActive(cfg), cfg.gatesEnabled(), now, null, capabilities(cfg, false), List.of());
    }

    PremiumDtos.Status statusFor(Subject subject) {
        PremiumDtos.Settings cfg = settings();
        Instant now = Instant.now();
        List<Row> rows = rowsFor(subject.id());
        List<Row> valid = rows.stream()
                .filter(row -> counts(row, cfg) && SubscriptionPolicy.entitled(row.state(), row.expiry(), now)).toList();
        boolean active = !valid.isEmpty();
        return new PremiumDtos.Status(true, active, admins.isAdministrator(), subject.publicId(), subject.accountHash(),
                mode(cfg), props.environment(), props.googleEnabled(), cfg.enrollmentOpen(), sandboxActive(cfg),
                cfg.gatesEnabled(), now, valid.stream().map(Row::expiry).max(Instant::compareTo).orElse(null),
                capabilities(cfg, active), rows.stream().filter(row -> counts(row, cfg)).map(Row::dto).toList());
    }

    private static Map<String, Boolean> capabilities(PremiumDtos.Settings cfg, boolean active) {
        Map<String, Boolean> caps = new LinkedHashMap<>();
        for (String feature : List.of("scan", "financialPlan", "addLedger", "exchange")) caps.put(feature, !cfg.gatesEnabled() || active);
        caps.put("reminders", true);
        return caps;
    }

    List<Row> rowsFor(long subjectId) {
        return jdbc.query("SELECT p.* FROM billing_subscriptions p JOIN billing_subjects s ON s.id=p.subject_id "
                + "WHERE (s.id=? OR s.linked_to=?) ORDER BY p.id DESC", PremiumService::row, subjectId, subjectId);
    }

    /** Serializes "first ledger is free" checks for one account. */
    @Transactional
    public void lockAccount(long ownerId) {
        jdbc.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", Long.class, ownerId);
    }

    /**
     * Server-side gate for paid write operations of a signed-in account. Records created offline
     * while subscribed may sync for {@code sync-grace-days} after membership ended; revoked
     * (refunded) memberships get no grace.
     */
    @Transactional
    public void requireFeature(long ownerId, String feature) {
        if (!Set.of("scan", "financialPlan", "addLedger", "exchange").contains(feature)) throw ApiException.validation("Unknown premium feature");
        PremiumDtos.Settings cfg = settings();
        if (!cfg.gatesEnabled()) return;
        Instant now = Instant.now();
        Instant graceFloor = now.minus(Duration.ofDays(props.syncGraceDays()));
        for (Row row : rowsFor(forUser(ownerId).id())) {
            if (!counts(row, cfg)) continue;
            if (SubscriptionPolicy.entitled(row.state(), row.expiry(), now)) return;
            if (row.revokedAt() == null && row.entitledUntil() != null && row.entitledUntil().isAfter(graceFloor)) return;
        }
        throw premiumRequired(feature);
    }

    static ApiException premiumRequired(String feature) {
        return new ApiException(HttpStatus.FORBIDDEN, ErrorCode.PREMIUM_REQUIRED, "PREMIUM_REQUIRED:" + feature);
    }

    /** OCR gateway check: live usage, so no sync grace. */
    @Transactional
    public boolean scanAllowed(String guestToken) {
        if (!settings().gatesEnabled()) return true;
        Subject subject = optionalSubject(guestToken);
        return subject != null && statusFor(subject).active();
    }

    // ───────────────────────────── simulator (staging only) ─────────────────────────────

    private void requireSandbox(boolean enrollment) {
        PremiumDtos.Settings cfg = settings();
        if (!sandboxActive(cfg)) throw ApiException.forbidden("Simulated billing is not available in this deployment");
        if (enrollment && !cfg.enrollmentOpen()) throw ApiException.forbidden("Subscription applications are closed");
    }

    @Transactional
    public PremiumDtos.Status apply(String token, PremiumDtos.Application request) {
        requireSandbox(true);
        Subject subject = subject(token);
        // Serialize concurrent applications of the same identity.
        jdbc.queryForObject("SELECT id FROM billing_subjects WHERE id=? FOR UPDATE", Long.class, subject.id());
        List<Row> existing = jdbc.query("SELECT * FROM billing_subscriptions WHERE subject_id=? AND provider='SANDBOX' AND request_key=?",
                PremiumService::row, subject.id(), request.requestKey());
        if (!existing.isEmpty()) return statusFor(subject);
        Instant now = Instant.now();
        boolean hasOpen = rowsFor(subject.id()).stream().anyMatch(row -> OPEN_STATES.contains(row.state())
                || SubscriptionPolicy.entitled(row.state(), row.expiry(), now));
        if (hasOpen) throw ApiException.conflict("An existing subscription or application must be resolved first");
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO billing_subscriptions (public_id, subject_id, provider, base_plan, subscription_state, request_key) "
                + "VALUES (?, ?, 'SANDBOX', ?, 'PENDING', ?)", id, subject.id(), request.basePlan(), request.requestKey());
        Long rowId = jdbc.queryForObject("SELECT id FROM billing_subscriptions WHERE public_id=?", Long.class, id);
        Long actor = BillingAdminService.principal() == null ? null : BillingAdminService.principal().id();
        audit("sandbox:" + id + ":apply", rowId, actor, "APPLY", null, "PENDING", request.basePlan());
        return statusFor(subject);
    }

    /** The subscriber may withdraw a pending application or stop renewal of their own simulated plan. */
    @Transactional
    public PremiumDtos.Status cancelSandbox(String token, String id, PremiumDtos.Event event) {
        requireSandbox(false);
        if (!"CANCEL".equals(event.event())) throw ApiException.forbidden("Only cancellation is allowed here");
        Subject subject = subject(token);
        Row row = jdbc.query("SELECT * FROM billing_subscriptions WHERE public_id=? FOR UPDATE", PremiumService::row, id)
                .stream().filter(r -> owns(subject, r.subjectId())).findFirst()
                .orElseThrow(() -> ApiException.notFound("Subscription not found"));
        AuthPrincipal caller = BillingAdminService.principal();
        mutate(row, event, caller == null ? null : caller.id());
        return statusFor(subject);
    }

    @Transactional
    public PremiumDtos.Console simulate(String publicId, PremiumDtos.Event event) {
        long actor = admins.requireAdmin();
        requireSandbox(false);
        Row row = jdbc.query("SELECT * FROM billing_subscriptions WHERE public_id=? FOR UPDATE", PremiumService::row, publicId)
                .stream().findFirst().orElseThrow(() -> ApiException.notFound("Subscription not found"));
        mutate(row, event, actor);
        return console();
    }

    private void mutate(Row row, PremiumDtos.Event event, Long actor) {
        // Simulated events can never change a real store purchase.
        if (!"SANDBOX".equals(row.provider())) throw ApiException.forbidden("Real purchases follow verified Google state only");
        String key = "sandbox:" + row.publicId() + ":" + event.requestKey();
        if (eventExists(key)) return;
        if (event.expectedRevision() != row.revision()) throw ApiException.conflict("Subscription changed; reload before retrying");
        Instant now = Instant.now();
        SubscriptionPolicy.Change next = SubscriptionPolicy.simulate(event.event(), row.state(), row.plan(), row.expiry(), row.autoRenew(), now);
        boolean revoke = "REVOKE".equals(event.event());
        boolean refund = revoke || "REFUND_ONLY".equals(event.event());
        Instant until = SubscriptionPolicy.entitledUntil(row.state(), row.expiry(), row.entitledUntil(),
                next.state(), next.expiry(), revoke, now);
        jdbc.update("UPDATE billing_subscriptions SET subscription_state=?, expires_at=?, auto_renew=?, entitled_until=?, "
                        + "acknowledged=?, refunded_at=?, refund_type=?, revoked_at=?, revision=revision+1 WHERE id=?",
                next.state(), timestamp(next.expiry()), next.autoRenew(), timestamp(until),
                row.acknowledged() || "ACTIVE".equals(next.state()),
                timestamp(refund ? now : row.refundedAt()), refund ? (revoke ? "SIMULATED_REFUND_REVOKE" : "SIMULATED_REFUND") : row.refundType(),
                timestamp(revoke ? now : row.revokedAt()), row.id());
        audit(key, row.id(), actor, event.event(), row.state(), next.state(), null);
    }

    // ───────────────────────────── administration ─────────────────────────────

    public boolean isAdministrator() { return admins.isAdministrator(); }

    @Transactional
    public PremiumDtos.Console console() {
        admins.requireAdmin();
        List<PremiumDtos.AdminSubscription> subscriptions = jdbc.query(
                "SELECT p.*, s.public_id AS subject_public, u.email AS owner_email "
                        + "FROM billing_subscriptions p JOIN billing_subjects s ON s.id=p.subject_id "
                        + "LEFT JOIN billing_subjects parent ON parent.id=s.linked_to "
                        + "LEFT JOIN users u ON u.id=COALESCE(parent.user_id, s.user_id) ORDER BY p.id DESC LIMIT 100",
                (rs, i) -> new PremiumDtos.AdminSubscription(row(rs, i).dto(), rs.getString("subject_public"),
                        rs.getString("owner_email") == null ? "GUEST" : rs.getString("owner_email")));
        List<PremiumDtos.AdminEvent> events = jdbc.query(
                "SELECT e.created_at, e.event_type, p.public_id, e.from_state, e.to_state, e.actor_id, e.detail "
                        + "FROM billing_events e LEFT JOIN billing_subscriptions p ON p.id=e.subscription_id ORDER BY e.id DESC LIMIT 50",
                (rs, i) -> new PremiumDtos.AdminEvent(rs.getTimestamp(1).toInstant(), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getObject(6) == null ? null : rs.getLong(6), rs.getString(7)));
        return new PremiumDtos.Console(settings(), props.environment(), props.sandboxAllowed(), props.googleEnabled(),
                subscriptions, events, alerts());
    }

    /** Operational warnings shown to the administrator (also logged by the reconciler). */
    List<String> alerts() {
        List<String> alerts = new ArrayList<>();
        Integer unacked = jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions WHERE provider='GOOGLE_PLAY' "
                + "AND acknowledged=FALSE AND subscription_state IN ('ACTIVE','IN_GRACE_PERIOD','CANCELED') "
                + "AND created_at < ?", Integer.class, timestamp(Instant.now().minus(Duration.ofHours(24))));
        if (unacked != null && unacked > 0) alerts.add("UNACKNOWLEDGED_OVER_24H:" + unacked);
        Integer orphans = jdbc.queryForObject("SELECT COUNT(*) FROM billing_orphans", Integer.class);
        if (orphans != null && orphans > 0) alerts.add("UNATTRIBUTED_PURCHASES:" + orphans);
        Integer failing = jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions WHERE provider='GOOGLE_PLAY' AND failures >= 5",
                Integer.class);
        if (failing != null && failing > 0) alerts.add("VERIFICATION_FAILING:" + failing);
        return alerts;
    }

    @Transactional
    public PremiumDtos.Console updateSettings(PremiumDtos.Settings request) {
        long actor = admins.requireAdmin();
        if (request.sandboxOpen() && !props.sandboxAllowed()) throw ApiException.forbidden("Simulated billing is disabled in this deployment");
        PremiumDtos.Settings before = settings();
        jdbc.update("UPDATE billing_settings SET enrollment_open=?, sandbox_open=?, gates_enabled=?, updated_by=? WHERE id=1",
                request.enrollmentOpen(), request.sandboxOpen(), request.gatesEnabled(), actor);
        audit("settings:" + UUID.randomUUID(), null, actor, "SETTINGS_CHANGED", null, null,
                "enrollment " + before.enrollmentOpen() + "->" + request.enrollmentOpen()
                        + ", sandbox " + before.sandboxOpen() + "->" + request.sandboxOpen()
                        + ", gates " + before.gatesEnabled() + "->" + request.gatesEnabled());
        return console();
    }

    // ───────────────────────────── helpers ─────────────────────────────

    boolean eventExists(String key) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM billing_events WHERE event_key=?", Integer.class, key);
        return count != null && count > 0;
    }

    void audit(String key, Long subscriptionId, Long actor, String event, String from, String to, String detail) {
        jdbc.update("INSERT INTO billing_events (event_key, subscription_id, actor_id, event_type, from_state, to_state, detail) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?)", key, subscriptionId, actor, event, from, to,
                detail == null ? null : detail.substring(0, Math.min(255, detail.length())));
    }

    static String digest(String value) {
        if (value == null) throw ApiException.badRequest("Missing identity proof");
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    static Timestamp timestamp(Instant value) { return value == null ? null : Timestamp.from(value); }
}
