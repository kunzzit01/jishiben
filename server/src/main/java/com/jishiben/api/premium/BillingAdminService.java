package com.jishiben.api.premium;

import com.jishiben.api.auth.GoogleSignInListener;
import com.jishiben.api.auth.GoogleTokenVerifier;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.user.User;
import com.jishiben.api.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

/**
 * Billing administrator = a session established by Google sign-in whose Google subject is pinned
 * in billing_admins (or configured explicitly). An e-mail string alone never grants access, and a
 * password session never does either, even on the same account: Google sign-in links accounts by
 * e-mail, so a password could belong to whoever registered that e-mail first.
 */
@Service
public class BillingAdminService implements GoogleSignInListener {
    private static final Logger log = LoggerFactory.getLogger(BillingAdminService.class);
    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final BillingProperties props;

    public BillingAdminService(JdbcTemplate jdbc, UserRepository users, BillingProperties props) {
        this.jdbc = jdbc;
        this.users = users;
        this.props = props;
    }

    /** Pins the administrator's Google subject the first time that verified Gmail signs in. */
    @Override
    public void onGoogleSignIn(User user, GoogleTokenVerifier.GoogleIdentity identity) {
        if (!props.adminGoogleSub().isBlank() || props.adminEmail().isBlank()) return;
        if (!identity.emailVerified() || identity.email() == null
                || !identity.email().equalsIgnoreCase(props.adminEmail())) return;
        Integer pinned = jdbc.queryForObject("SELECT COUNT(*) FROM billing_admins", Integer.class);
        if (pinned != null && pinned > 0) return;
        jdbc.update("INSERT INTO billing_admins (google_sub, email) VALUES (?, ?)", identity.sub(), identity.email().toLowerCase());
        log.info("Billing administrator pinned to the Google account of the configured administrator e-mail");
    }

    public boolean isAdministrator() {
        AuthPrincipal principal = principal();
        if (principal == null) return false;
        User user = users.findById(principal.id()).orElse(null);
        if (user == null) return false;
        // Explicit grant by the operator in the database (users.user_role='ADMIN'): any session of
        // that account, including password logins (owner decision 2026-11-10). The role is read from
        // the database on every call, never from the token, so revoking it takes effect immediately.
        if ("ADMIN".equals(user.getUserRole())) return true;
        if (!principal.googleSession() || user.getGoogleSub() == null) return false;
        String sub = user.getGoogleSub();
        if (!props.adminGoogleSub().isBlank()) return props.adminGoogleSub().equals(sub);
        Integer match = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_admins WHERE google_sub=? AND revoked_at IS NULL", Integer.class, sub);
        return match != null && match > 0;
    }

    public long requireAdmin() {
        if (!isAdministrator()) throw ApiException.forbidden("Billing administrator signed in with Google is required");
        return principal().id();
    }

    static AuthPrincipal principal() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof AuthPrincipal p ? p : null;
    }
}
