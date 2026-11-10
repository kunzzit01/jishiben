package com.jishiben.api.security;

/**
 * The authenticated identity, built only from a verified JWT. Nothing in this application ever
 * reads an account id from a request body or query parameter, so this record is the single source
 * of "who is asking".
 *
 * <p>{@code authMethod} records how this session was established ({@link #METHOD_PASSWORD} or
 * {@link #METHOD_GOOGLE}). Privileges that must not follow a shared password, such as billing
 * administration, require a Google-established session.
 */
public record AuthPrincipal(long id, String email, String role, int tokenVersion, String authMethod) {

    public static final String METHOD_PASSWORD = "pwd";
    public static final String METHOD_GOOGLE = "google";

    public AuthPrincipal(long id, String email, String role, int tokenVersion) {
        this(id, email, role, tokenVersion, METHOD_PASSWORD);
    }

    public AuthPrincipal {
        authMethod = METHOD_GOOGLE.equals(authMethod) ? METHOD_GOOGLE : METHOD_PASSWORD;
    }

    public boolean isAdmin() {
        return "ADMIN".equals(role);
    }

    public boolean googleSession() {
        return METHOD_GOOGLE.equals(authMethod);
    }
}
