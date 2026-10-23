package com.jishiben.api.premium;

import com.jishiben.api.common.ApiException;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Premium is a deliberate stub. The app only ever showed a greyed-out "coming soon" row, so there is
 * no entitlement logic, no in-app purchase, and no RevenueCat webhook. Both endpoints exist so the
 * client can keep its feature flag wiring; the purchase endpoint answers 501 instead of pretending.
 */
@RestController
@RequestMapping("/api/premium")
public class PremiumController {

    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of(
                "active", false,
                "implemented", false,
                "source", "STUB",
                "message", "Premium is not implemented yet; no entitlement is granted.");
    }

    @PostMapping("/purchase")
    public void purchase() {
        throw ApiException.notImplemented("Premium purchase is not implemented");
    }
}
