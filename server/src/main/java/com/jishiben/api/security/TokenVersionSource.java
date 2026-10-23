package com.jishiben.api.security;

/**
 * Supplies the account's current token version so a password change or a "log out everywhere"
 * invalidates every previously issued JWT immediately (no blacklist table needed).
 */
public interface TokenVersionSource {

    /** Current version, or a value that matches nothing when the account no longer exists. */
    int currentVersion(long accountId);
}
