package com.jishiben.api.premium;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/premium/google")
public class GoogleBillingController {
    private static final String GUEST = "X-Premium-Guest-Token";
    private final GoogleBillingService billing;

    public GoogleBillingController(GoogleBillingService billing) { this.billing = billing; }

    @PostMapping("/verify")
    public PremiumDtos.Status verify(@RequestHeader(value = GUEST, required = false) String guest,
                                     @Valid @RequestBody PremiumDtos.Verify request) {
        return billing.verify(guest, request.purchaseToken(), false, request.claim());
    }

    @PostMapping("/restore")
    public PremiumDtos.Status restore(@RequestHeader(value = GUEST, required = false) String guest,
                                      @Valid @RequestBody PremiumDtos.Verify request) {
        return billing.verify(guest, request.purchaseToken(), true, request.claim());
    }

    /** Pub/Sub push endpoint; authenticated by Google OIDC inside the service, not by app JWT. */
    @PostMapping("/notifications")
    public void notification(@RequestHeader(value = "Authorization", required = false) String authorization,
                             @RequestBody JsonNode envelope) {
        billing.notification(authorization, envelope);
    }
}
