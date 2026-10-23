package com.jishiben.api.security;

/**
 * The authenticated identity, built only from a verified JWT. Nothing in this application ever
 * reads an account id from a request body or query parameter, so this record is the single source
 * of "who is asking".
 */
public record AuthPrincipal(long id, String email, String role, int tokenVersion) {

    public boolean isAdmin() {
        return "ADMIN".equals(role);
    }
}
