package com.jishiben.api.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * The single error envelope for every failure. Never contains stack traces, SQL, or secrets.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(
        String code,
        String message,
        int status,
        String path,
        Instant timestamp,
        List<String> details) {

    public static ApiError of(ErrorCode code, int status, String message, String path) {
        return new ApiError(code.name(), message, status, path, Instant.now(), null);
    }

    public static ApiError of(ErrorCode code, int status, String message, String path, List<String> details) {
        return new ApiError(code.name(), message, status, path, Instant.now(), details);
    }
}
