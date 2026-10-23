package com.jishiben.api.ai;

import com.jishiben.api.common.ApiError;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Renders {@link AiApiException} in the shared error envelope, but only for controllers in this
 * package. Highest precedence so the generic {@code Exception} handler in
 * {@link com.jishiben.api.common.GlobalExceptionHandler} cannot swallow these into a 500.
 */
@RestControllerAdvice(basePackages = "com.jishiben.api.ai")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AiExceptionHandler {

    @ExceptionHandler(AiApiException.class)
    public ResponseEntity<ApiError> handleAi(AiApiException ex, HttpServletRequest request) {
        HttpHeaders headers = new HttpHeaders();
        if (ex.status().value() == HttpStatus.UNAUTHORIZED.value()) {
            headers.set(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        }
        ApiError body = new ApiError(ex.code(), ex.getMessage(), ex.status().value(),
                request.getRequestURI(), Instant.now(), null);
        return new ResponseEntity<>(body, headers, ex.status());
    }
}
