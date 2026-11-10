package com.jishiben.api.premium;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
@EnableScheduling
public class BillingReconciler {
    private static final Logger log = LoggerFactory.getLogger(BillingReconciler.class);
    private final PremiumService premium;
    private final GoogleBillingService billing;
    public BillingReconciler(PremiumService premium, GoogleBillingService billing) { this.premium = premium; this.billing = billing; }
    @Scheduled(fixedDelayString="${app.billing.reconcile-delay-ms:60000}", initialDelay=15000)
    public void run() {
        if (!"GOOGLE_PLAY".equals(premium.mode)) return;
        List<String> tokens = premium.jdbc.query("SELECT token_hash FROM billing_subscriptions WHERE provider='GOOGLE_PLAY' "
                + "AND (expires_at IS NULL OR expires_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 59 DAY)) "
                + "AND (next_check_at IS NULL OR next_check_at <= UTC_TIMESTAMP()) "
                + "ORDER BY acknowledged ASC,next_check_at ASC LIMIT 20", (rs,i) -> rs.getString(1));
        for (String hash : tokens) {
            try { billing.reconcile(hash); }
            catch (Exception ex) {
                Integer failures = premium.jdbc.queryForObject("SELECT failures FROM billing_subscriptions WHERE token_hash=?", Integer.class, hash);
                int count = Math.min(12, failures == null ? 1 : failures + 1);
                long delay = Math.min(900, 5L << count);
                premium.jdbc.update("UPDATE billing_subscriptions SET failures=?,next_check_at=? WHERE token_hash=?",
                        count, PremiumService.timestamp(java.time.Instant.now().plusSeconds(delay)), hash);
                log.warn("Billing reconciliation failed; bounded retry scheduled (purchase data omitted)");
            }
        }
    }
}
