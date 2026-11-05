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
    // Google 登录：配置缺失 / Token 不合法 / 需要先验证原账号再绑定 / 已绑定 / sub 被占用
    GOOGLE_NOT_CONFIGURED,
    GOOGLE_TOKEN_INVALID,
    GOOGLE_LINK_REQUIRED,
    GOOGLE_ALREADY_LINKED,
    GOOGLE_SUB_TAKEN,
    NOT_IMPLEMENTED,
    INTERNAL_ERROR
}
