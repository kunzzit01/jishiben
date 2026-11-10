package com.jishiben.api.premium;

import java.net.InetAddress;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Background work for real Google purchases: acknowledgement retries (the 3-day window must not
 * depend on the app staying open), missed notifications, unattributed purchases and refunds via the
 * Voided Purchases API. Each job holds a short database lease so only one API instance runs it, and
 * processes a bounded batch with exponential backoff per purchase.
 */
@Configuration
@EnableScheduling
public class BillingReconciler {
    private static final Logger log = LoggerFactory.getLogger(BillingReconciler.class);
    private static final int BATCH = 20;
    private final PremiumService premium;
    private final GoogleBillingService billing;
    private final String owner;

    public BillingReconciler(PremiumService premium, GoogleBillingService billing) {
        this.premium = premium;
        this.billing = billing;
        String host;
        try {
            host = InetAddress.getLocalHost().getHostName();
        } catch (Exception ex) {
            host = "api";
        }
        String id = host + "-" + UUID.randomUUID();
        this.owner = id.length() > 64 ? id.substring(id.length() - 64) : id;
    }

    boolean lease(String job, int seconds) {
        Instant now = Instant.now();
        return premium.jdbc.update("UPDATE billing_jobs SET locked_until=?, owner=? WHERE name=? AND (locked_until IS NULL OR locked_until < ?)",
                PremiumService.timestamp(now.plusSeconds(seconds)), owner, job, PremiumService.timestamp(now)) == 1;
    }

    private void release(String job, boolean success) {
        if (success) {
            premium.jdbc.update("UPDATE billing_jobs SET locked_until=NULL, last_success_at=? WHERE name=? AND owner=?",
                    PremiumService.timestamp(Instant.now()), job, owner);
        } else {
            premium.jdbc.update("UPDATE billing_jobs SET locked_until=NULL WHERE name=? AND owner=?", job, owner);
        }
    }

    @Scheduled(fixedDelayString = "${app.billing.reconcile-delay-ms:60000}", initialDelay = 20000)
    public void run() {
        if (!billing.enabled() || !lease("google-reconcile", 300)) return;
        boolean ok = false;
        try {
            Instant now = Instant.now();
            List<String> tokens = premium.jdbc.query("SELECT token_hash FROM billing_subscriptions WHERE provider='GOOGLE_PLAY' "
                            + "AND (expires_at IS NULL OR expires_at > ?) AND (next_check_at IS NULL OR next_check_at <= ?) "
                            + "ORDER BY acknowledged ASC, next_check_at ASC LIMIT " + BATCH, (rs, i) -> rs.getString(1),
                    PremiumService.timestamp(now.minusSeconds(59L * 86400)), PremiumService.timestamp(now));
            for (String hash : tokens) {
                try {
                    billing.reconcile(hash);
                } catch (Exception ex) {
                    backoff(hash);
                }
            }
            List<String> orphans = premium.jdbc.query("SELECT token_hash FROM billing_orphans ORDER BY attempts ASC, id ASC LIMIT " + BATCH,
                    (rs, i) -> rs.getString(1));
            for (String hash : orphans) {
                try {
                    billing.reconcileOrphan(hash);
                } catch (Exception ex) {
                    log.warn("Unattributed purchase check failed; will retry");
                }
            }
            List<String> alerts = premium.alerts();
            if (!alerts.isEmpty()) log.error("Billing attention required: {}", alerts);
            ok = true;
        } finally {
            release("google-reconcile", ok);
        }
    }

    private void backoff(String hash) {
        Integer failures = premium.jdbc.queryForObject("SELECT failures FROM billing_subscriptions WHERE token_hash=?", Integer.class, hash);
        int count = Math.min(12, failures == null ? 1 : failures + 1);
        long delay = Math.min(3600, 30L << Math.min(count, 7));
        premium.jdbc.update("UPDATE billing_subscriptions SET failures=?, next_check_at=? WHERE token_hash=?",
                count, PremiumService.timestamp(Instant.now().plusSeconds(delay)), hash);
        log.warn("Billing reconciliation failed; retry #{} in {}s (purchase data omitted)", count, delay);
    }

    /** Hourly refund backstop in case a voided-purchase notification was missed. */
    @Scheduled(fixedDelayString = "${app.billing.voided-delay-ms:3600000}", initialDelay = 60000)
    public void voided() {
        if (!billing.enabled() || !lease("google-voided", 600)) return;
        boolean ok = false;
        try {
            Instant last = premium.jdbc.query("SELECT last_success_at FROM billing_jobs WHERE name='google-voided'",
                    (rs, i) -> rs.getTimestamp(1)).stream().findFirst().map(t -> t == null ? null : t.toInstant()).orElse(null);
            Instant since = last == null ? Instant.now().minusSeconds(30L * 86400) : last.minusSeconds(86400);
            int applied = billing.applyVoided(since);
            if (applied > 0) log.info("Applied {} voided purchase(s)", applied);
            ok = true;
        } catch (Exception ex) {
            log.warn("Voided purchases check failed; will retry");
        } finally {
            release("google-voided", ok);
        }
    }
}
