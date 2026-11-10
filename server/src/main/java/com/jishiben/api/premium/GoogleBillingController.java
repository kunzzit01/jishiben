package com.jishiben.api.premium;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/premium/google")
public class GoogleBillingController {
    private final GoogleBillingService billing;
    public GoogleBillingController(GoogleBillingService billing) { this.billing = billing; }
    @PostMapping("/verify") public PremiumDtos.Status verify(@RequestHeader(value="X-Premium-Guest-Token", required=false) String guest,
            @Valid @RequestBody PremiumDtos.Verify request) {
        return billing.verify(guest, request.purchaseToken(), false);
    }
    @PostMapping("/restore") public PremiumDtos.Status restore(@RequestHeader(value="X-Premium-Guest-Token", required=false) String guest,
            @Valid @RequestBody PremiumDtos.Verify request) {
        return billing.verify(guest, request.purchaseToken(), true);
    }
    @PostMapping("/notifications") public void notification(@RequestHeader(value="Authorization", required=false) String authorization,
            @RequestBody JsonNode envelope) { billing.notification(authorization, envelope); }
}
