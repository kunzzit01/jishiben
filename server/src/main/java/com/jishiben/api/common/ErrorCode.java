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
    /** 注册页用 Google：这个 Google 身份/邮箱已经有账号了，应引导去登录 */
    GOOGLE_ALREADY_REGISTERED,
    GOOGLE_ALREADY_LINKED,
    GOOGLE_SUB_TAKEN,
    NOT_IMPLEMENTED,
    INTERNAL_ERROR
}
