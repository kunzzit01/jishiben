package com.jishiben.api.ai;

import org.springframework.http.HttpStatus;

/**
 * AI-endpoint failure carrying its own stable code. It exists because the AI codes
 * (AI_NOT_CONFIGURED / AI_UPSTREAM_ERROR / AI_UPSTREAM_TIMEOUT) are not part of the shared
 * {@link com.jishiben.api.common.ErrorCode} enum, and that enum is owned outside this package.
 * Rendered by {@link AiExceptionHandler} — never the raw upstream body, never the key.
 */
public class AiApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    private AiApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    /** 503: the operator has not set an AI key yet. Clients degrade to manual entry. */
    public static AiApiException notConfigured() {
        return notConfigured("Receipt scanning");
    }

    /** Same 503 for any AI feature, naming the one that is unavailable. */
    public static AiApiException notConfigured(String feature) {
        return new AiApiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_NOT_CONFIGURED",
                feature + " is not configured on this server");
    }

    /** 502: the provider answered with an error, or with something unreadable. */
    public static AiApiException upstream(String message) {
        return new AiApiException(HttpStatus.BAD_GATEWAY, "AI_UPSTREAM_ERROR", message);
    }

    /** 504: the provider did not answer inside the configured window. */
    public static AiApiException upstreamTimeout(String message) {
        return new AiApiException(HttpStatus.GATEWAY_TIMEOUT, "AI_UPSTREAM_TIMEOUT", message);
    }

    public static AiApiException validation(String message) {
        return new AiApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }

    public static AiApiException payloadTooLarge(String message) {
        return new AiApiException(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", message);
    }
}
