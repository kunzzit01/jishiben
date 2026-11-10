package com.jishiben.api.premium;

import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Deployment-level billing configuration. One deployment serves the app; whether the simulator
 * may be used is a deployment flag, and whether it is actually on is the administrator's switch
 * (billing_settings.sandbox_open, off by default). Simulated orders never touch Google Play rows.
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
    private final boolean guestSubscriptions;

    /** Test/legacy constructor: guest subscriptions allowed (exercises the guest identity paths). */
    public BillingProperties(String environment, boolean sandboxAllowed, boolean googleEnabled,
                             String adminEmail, String adminGoogleSub, int syncGraceDays) {
        this(environment, sandboxAllowed, googleEnabled, adminEmail, adminGoogleSub, syncGraceDays, true);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public BillingProperties(
            @Value("${app.billing.environment:production}") String environment,
            @Value("${app.billing.sandbox-allowed:false}") boolean sandboxAllowed,
            @Value("${app.billing.google-enabled:false}") boolean googleEnabled,
            @Value("${app.billing.admin-email:}") String adminEmail,
            @Value("${app.billing.admin-google-sub:}") String adminGoogleSub,
            @Value("${app.billing.sync-grace-days:7}") int syncGraceDays,
            @Value("${app.billing.guest-subscriptions:false}") boolean guestSubscriptions) {
        String env = environment == null ? "" : environment.trim().toLowerCase(Locale.ROOT);
        if (!STAGING.equals(env) && !PRODUCTION.equals(env)) {
            throw new IllegalStateException("app.billing.environment must be 'staging' or 'production'");
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
        this.guestSubscriptions = guestSubscriptions;
    }

    public String environment() { return environment; }
    public boolean production() { return PRODUCTION.equals(environment); }
    /** The administrator may switch the simulator on only when the deployment allows it. */
    public boolean sandboxAllowed() { return sandboxAllowed; }
    public boolean googleEnabled() { return googleEnabled; }
    public String adminEmail() { return adminEmail; }
    public String adminGoogleSub() { return adminGoogleSub; }
    public int syncGraceDays() { return syncGraceDays; }
    /** Owner decision 2026-11-10: off — subscribing requires a registered, signed-in account. */
    public boolean guestSubscriptions() { return guestSubscriptions; }
}
