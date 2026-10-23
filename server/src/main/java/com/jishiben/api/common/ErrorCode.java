package com.jishiben.api.common;

/**
 * Stable, machine-readable error codes. Clients switch on these instead of parsing messages.
 */
public enum ErrorCode {
    VALIDATION_FAILED,
    BAD_REQUEST,
    UNAUTHORIZED,
    INVALID_CREDENTIALS,
    TOKEN_INVALID,
    TOKEN_EXPIRED,
    TOKEN_REVOKED,
    FORBIDDEN,
    NOT_FOUND,
    CONFLICT,
    PAYLOAD_TOO_LARGE,
    AI_UNAVAILABLE,
    UPSTREAM_ERROR,
    NOT_IMPLEMENTED,
    INTERNAL_ERROR
}
