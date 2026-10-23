package com.jishiben.api.health;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Liveness endpoint only. Deliberately does not touch the database: it must answer even while
 * MySQL is recovering, and the readiness signal is /actuator/health.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    private final String applicationName;
    private final Instant startedAt = Instant.now();

    public HealthController(@Value("${spring.application.name:jishiben-api}") String applicationName) {
        this.applicationName = applicationName;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "ok");
        body.put("app", applicationName);
        body.put("startedAt", startedAt.toString());
        body.put("uptimeSeconds", (System.currentTimeMillis() - startedAt.toEpochMilli()) / 1000);
        return body;
    }
}
