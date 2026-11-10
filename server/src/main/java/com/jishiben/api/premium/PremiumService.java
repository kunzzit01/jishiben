package com.jishiben.api.premium;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.security.CurrentUser;
import com.jishiben.api.user.User;
import com.jishiben.api.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PremiumService {
    final JdbcTemplate jdbc;
    private final UserRepository users;
    private final boolean sandboxAllowed;
    final String mode;
    private final String adminEmail;

    public PremiumService(JdbcTemplate jdbc, UserRepository users,
            @Value("${app.billing.sandbox-allowed:false}") boolean sandboxAllowed,
            @Value("${app.billing.mode:SANDBOX}") String mode,
            @Value("${app.billing.admin-email:mingsoon249@gmail.com}") String adminEmail) {
        if (!List.of("SANDBOX", "GOOGLE_PLAY").contains(mode)) throw new IllegalArgumentException("Invalid billing mode");
        this.jdbc = jdbc;
        this.users = users;
        this.sandboxAllowed = sandboxAllowed;
        this.mode = mode;
        this.adminEmail = adminEmail;
    }

    public record Subject(long id, String publicId) {}
    record Row(long id, long subjectId, String publicId, String provider, String plan, String state,
               Instant expiry, boolean autoRenew, int revision, boolean acknowledged) {
        PremiumDtos.Subscription dto() {
            return new PremiumDtos.Subscription(publicId, provider, plan, state, expiry, autoRenew, revision, acknowledged);
        }
    }
    static Row row(ResultSet rs, int ignored) throws SQLException {
        Timestamp expiry = rs.getTimestamp("expires_at");
        return new Row(rs.getLong("id"), rs.getLong("subject_id"), rs.getString("public_id"),
                rs.getString("provider"), rs.getString("base_plan"), rs.getString("subscription_state"),
                expiry == null ? null : expiry.toInstant(), rs.getBoolean("auto_renew"),
                rs.getInt("revision"), rs.getBoolean("acknowledged"));
    }

    @Transactional
    public PremiumDtos.Guest createGuest() {
        String token = UUID.randomUUID().toString() + UUID.randomUUID().toString();
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO billing_subjects (public_id, account_hash, guest_hash) VALUES (?, ?, ?)", id, digest(id), digest(token));
        return new PremiumDtos.Guest(token);
    }

    @Transactional
    public Subject subject(String guestToken) {
        AuthPrincipal caller = authenticated();
        if (caller != null) return forUser(caller.id());
        if (guestToken == null || guestToken.length() != 72) throw ApiException.unauthorized("Billing identity required");
        return jdbc.query("SELECT id, public_id FROM billing_subjects WHERE guest_hash=? AND linked_to IS NULL",
                (rs, i) -> new Subject(rs.getLong(1), rs.getString(2)), digest(guestToken)).stream()
                .findFirst().orElseThrow(() -> ApiException.unauthorized("Guest billing identity is no longer valid"));
    }

    private Subject forUser(long userId) {
        // Serialize first-use creation against the existing account row, including across instances.
        jdbc.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", Long.class, userId);
        List<Subject> existing = jdbc.query("SELECT id, public_id FROM billing_subjects WHERE user_id=?",
                (rs, i) -> new Subject(rs.getLong(1), rs.getString(2)), userId);
        if (!existing.isEmpty()) return existing.getFirst();
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO billing_subjects (public_id, account_hash, user_id) VALUES (?, ?, ?)", id, digest(id), userId);
        return new Subject(jdbc.queryForObject("SELECT id FROM billing_subjects WHERE public_id=?", Long.class, id), id);
    }

    @Transactional
    public void claimGuest(String token) {
        long userId = CurrentUser.id();
        lockSettings();
        Subject target = forUser(userId);
        List<Subject> guests = jdbc.query("SELECT id, public_id FROM billing_subjects WHERE guest_hash=? AND user_id IS NULL AND linked_to IS NULL FOR UPDATE",
                (rs, i) -> new Subject(rs.getLong(1), rs.getString(2)), digest(token));
        if (guests.isEmpty()) throw ApiException.conflict("Guest identity was already claimed or is invalid");
        // Keep the original public id for Google purchase-account matching after registration.
        jdbc.update("UPDATE billing_subjects SET linked_to=?, guest_hash=NULL WHERE id=?", target.id(), guests.getFirst().id());
    }

    public PremiumDtos.Settings settings() {
        return jdbc.queryForObject("SELECT * FROM billing_settings WHERE id=1", (rs, i) ->
                new PremiumDtos.Settings(rs.getBoolean("enrollment_open"), rs.getBoolean("sandbox_open"), rs.getBoolean("gates_enabled")));
    }
    void lockSettings() { jdbc.queryForObject("SELECT id FROM billing_settings WHERE id=1 FOR UPDATE", Long.class); }

    @Transactional
    public PremiumDtos.Status status(String guestToken) { return statusFor(subject(guestToken)); }

    PremiumDtos.Status statusFor(Subject subject) {
        PremiumDtos.Settings cfg = settings();
        Instant now = Instant.now();
        List<Row> rows = rowsFor(subject.id());
        List<Row> valid = rows.stream().filter(row ->
                ("GOOGLE_PLAY".equals(row.provider()) || (sandboxAllowed && cfg.sandboxOpen() && "SANDBOX".equals(mode)))
                && SubscriptionPolicy.entitled(row.state(), row.expiry(), now)).toList();
        boolean active = !valid.isEmpty();
        Map<String, Boolean> caps = new LinkedHashMap<>();
        for (String feature : SubscriptionPolicy.FEATURES) caps.put(feature, !cfg.gatesEnabled() || active);
        caps.put("reminders", true);
        return new PremiumDtos.Status(true, active, isAdministrator(), subject.publicId(), digest(subject.publicId()), mode,
                cfg.enrollmentOpen(), sandboxAllowed && cfg.sandboxOpen() && "SANDBOX".equals(mode), cfg.gatesEnabled(), now,
                valid.stream().map(Row::expiry).max(Instant::compareTo).orElse(null), caps, rows.stream().map(Row::dto).toList());
    }
    List<Row> rowsFor(long subjectId) {
        return jdbc.query("SELECT p.* FROM billing_subscriptions p JOIN billing_subjects s ON s.id=p.subject_id "
                + "WHERE (s.id=? OR s.linked_to=?) ORDER BY p.id DESC", PremiumService::row, subjectId, subjectId);
    }

    @Transactional
    public PremiumDtos.Status apply(String token, PremiumDtos.Application request) {
        lockSettings();
        requireSandbox(true);
        Subject subject = subject(token);
        List<Row> existing = jdbc.query("SELECT * FROM billing_subscriptions WHERE subject_id=? AND provider='SANDBOX' AND request_key=?",
                PremiumService::row, subject.id(), request.requestKey());
        if (!existing.isEmpty()) return statusFor(subject);
        boolean hasOpen = rowsFor(subject.id()).stream().anyMatch(row -> "SANDBOX".equals(row.provider())
                && ("PENDING".equals(row.state()) || SubscriptionPolicy.entitled(row.state(), row.expiry(), Instant.now())
                    || List.of("ON_HOLD", "PAUSED").contains(row.state())));
        if (hasOpen) throw ApiException.conflict("An existing subscription or application must be resolved first");
        jdbc.update("INSERT INTO billing_subscriptions (public_id, subject_id, provider, base_plan, subscription_state, request_key) "
                + "VALUES (?, ?, 'SANDBOX', ?, 'PENDING', ?)", UUID.randomUUID().toString(), subject.id(), request.basePlan(), request.requestKey());
        return statusFor(subject);
    }

    @Transactional
    public PremiumDtos.Status cancelSandbox(String token, String id, PremiumDtos.Event event) {
        lockSettings();
        requireSandbox(false);
        Subject subject = subject(token);
        Row row = rowsFor(subject.id()).stream().filter(r -> r.publicId().equals(id)).findFirst()
                .orElseThrow(() -> ApiException.notFound("Subscription not found"));
        if (!"CANCEL".equals(event.event())) throw ApiException.forbidden("Only cancellation is allowed here");
        mutate(row, event, null);
        return statusFor(subject);
    }

    @Transactional
    public PremiumDtos.Console console() {
        requireAdmin();
        List<PremiumDtos.AdminSubscription> subscriptions = jdbc.query(
                "SELECT p.*, s.public_id AS subject_public, u.email AS owner_email "
                + "FROM billing_subscriptions p JOIN billing_subjects s ON s.id=p.subject_id "
                + "LEFT JOIN billing_subjects parent ON parent.id=s.linked_to "
                + "LEFT JOIN users u ON u.id=COALESCE(s.user_id,parent.user_id) ORDER BY p.id DESC LIMIT 100",
                (rs, i) -> new PremiumDtos.AdminSubscription(row(rs, i).dto(), rs.getString("subject_public"),
                        rs.getString("owner_email") == null ? "GUEST" : rs.getString("owner_email")));
        return new PremiumDtos.Console(settings(), sandboxAllowed && "SANDBOX".equals(mode), subscriptions);
    }

    @Transactional
    public PremiumDtos.Console updateSettings(PremiumDtos.Settings request) {
        requireAdmin();
        lockSettings();
        if (request.sandboxOpen() && (!sandboxAllowed || !"SANDBOX".equals(mode))) throw ApiException.forbidden("Sandbox is disabled by deployment");
        jdbc.update("UPDATE billing_settings SET enrollment_open=?, sandbox_open=?, gates_enabled=?, updated_by=? WHERE id=1",
                request.enrollmentOpen(), request.sandboxOpen(), request.gatesEnabled(), CurrentUser.id());
        audit("settings:" + UUID.randomUUID(), null, CurrentUser.id(), "SETTINGS_CHANGED");
        return console();
    }

    @Transactional
    public PremiumDtos.Console simulate(String publicId, PremiumDtos.Event event) {
        requireAdmin();
        lockSettings();
        requireSandbox(false);
        Row row = jdbc.query("SELECT * FROM billing_subscriptions WHERE public_id=? FOR UPDATE", PremiumService::row, publicId)
                .stream().findFirst().orElseThrow(() -> ApiException.notFound("Subscription not found"));
        mutate(row, event, CurrentUser.id());
        return console();
    }

    private void mutate(Row row, PremiumDtos.Event event, Long actor) {
        if (!"SANDBOX".equals(row.provider())) throw ApiException.forbidden("Real purchases require verified Google state");
        String key = "sandbox:" + row.publicId() + ":" + event.requestKey();
        if (Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM billing_events WHERE event_key=?)", Boolean.class, key))) return;
        if (event.expectedRevision() != row.revision()) throw ApiException.conflict("Subscription changed; reload before retrying");
        SubscriptionPolicy.Change next = SubscriptionPolicy.simulate(event.event(), row.state(), row.plan(), row.expiry(), row.autoRenew(), Instant.now());
        jdbc.update("UPDATE billing_subscriptions SET subscription_state=?, expires_at=?, auto_renew=?, revision=revision+1, acknowledged=? WHERE id=?",
                next.state(), timestamp(next.expiry()), next.autoRenew(), !"PENDING".equals(next.state()), row.id());
        audit(key, row.id(), actor, event.event());
    }

    void audit(String key, Long subscriptionId, Long actor, String event) {
        jdbc.update("INSERT INTO billing_events (event_key, subscription_id, actor_id, event_type) VALUES (?, ?, ?, ?)", key, subscriptionId, actor, event);
    }
    private void requireSandbox(boolean enrollment) {
        PremiumDtos.Settings cfg = settings();
        if (!sandboxAllowed || !"SANDBOX".equals(mode) || !cfg.sandboxOpen()) throw ApiException.forbidden("Sandbox is closed");
        if (enrollment && !cfg.enrollmentOpen()) throw ApiException.forbidden("Subscription applications are closed");
    }

    public boolean isAdministrator() {
        AuthPrincipal principal = authenticated();
        if (principal == null) return false;
        User user = users.findById(principal.id()).orElse(null);
        return user != null && ("ADMIN".equals(user.getUserRole()) || (user.getEmail() != null && user.getEmail().equalsIgnoreCase(adminEmail)
                && user.getEmailVerifiedAt() != null && user.getGoogleSub() != null));
    }
    void requireAdmin() { if (!isAdministrator()) throw ApiException.forbidden("Verified billing administrator required"); }
    static AuthPrincipal authenticated() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof AuthPrincipal p ? p : null;
    }

    @Transactional
    public void lockAccount(long ownerId) {
        jdbc.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", Long.class, ownerId);
    }

    @Transactional
    public void requireFeature(long ownerId, String feature) {
        if (!SubscriptionPolicy.FEATURES.contains(feature)) throw ApiException.validation("Unknown premium feature");
        if (settings().gatesEnabled() && !statusFor(forUser(ownerId)).active()) throw ApiException.forbidden("PREMIUM_REQUIRED:" + feature);
    }
    static String digest(String value) {
        if (value == null) throw ApiException.badRequest("Missing identity proof");
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    static Timestamp timestamp(Instant value) { return value == null ? null : Timestamp.from(value); }
}
