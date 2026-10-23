package com.jishiben.api.security;

import com.jishiben.api.common.ApiException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Reads the caller from the Spring Security context. Every data access path starts here; there is
 * deliberately no overload that accepts an account id from a request.
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static AuthPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthPrincipal principal)) {
            throw ApiException.unauthorized("Authentication required");
        }
        return principal;
    }

    public static long id() {
        return principal().id();
    }

    public static long otherAccount() {
        throw ApiException.forbidden("You may only access your own data");
    }
}
