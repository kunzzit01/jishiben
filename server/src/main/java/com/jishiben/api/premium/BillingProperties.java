package com.jishiben.api.premium;

import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Deployment-level billing configuration. Staging and production are separate deployments with
 * separate databases; production refuses to start with the simulator allowed.
 */
@Component
public class BillingProperties {
    public static final String STAGING = "staging";
    public static final String PRODUCTION = "production";

    private final String environment;
    private final boolean sandboxAllowed;
    private final boolean googleEnabled;
    private final String adminEmail;
    private final String adminGoogleSub;
    private final int syncGraceDays;

    public BillingProperties(
            @Value("${app.billing.environment:production}") String environment,
            @Value("${app.billing.sandbox-allowed:false}") boolean sandboxAllowed,
            @Value("${app.billing.google-enabled:false}") boolean googleEnabled,
            @Value("${app.billing.admin-email:}") String adminEmail,
            @Value("${app.billing.admin-google-sub:}") String adminGoogleSub,
            @Value("${app.billing.sync-grace-days:7}") int syncGraceDays) {
        String env = environment == null ? "" : environment.trim().toLowerCase(Locale.ROOT);
        if (!STAGING.equals(env) && !PRODUCTION.equals(env)) {
            throw new IllegalStateException("app.billing.environment must be 'staging' or 'production'");
        }
        if (PRODUCTION.equals(env) && sandboxAllowed) {
            throw new IllegalStateException("Simulated billing (BILLING_SANDBOX_ALLOWED) is not allowed in production");
        }
        if (syncGraceDays < 0 || syncGraceDays > 30) {
            throw new IllegalStateException("app.billing.sync-grace-days must be between 0 and 30");
        }
        this.environment = env;
        this.sandboxAllowed = sandboxAllowed;
        this.googleEnabled = googleEnabled;
        this.adminEmail = adminEmail == null ? "" : adminEmail.trim();
        this.adminGoogleSub = adminGoogleSub == null ? "" : adminGoogleSub.trim();
        this.syncGraceDays = syncGraceDays;
    }

    public String environment() { return environment; }
    public boolean production() { return PRODUCTION.equals(environment); }
    /** The simulator can only ever run in a staging deployment that explicitly allows it. */
    public boolean sandboxAllowed() { return !production() && sandboxAllowed; }
    public boolean googleEnabled() { return googleEnabled; }
    public String adminEmail() { return adminEmail; }
    public String adminGoogleSub() { return adminGoogleSub; }
    public int syncGraceDays() { return syncGraceDays; }
}
