package com.jishiben.api.premium;

import com.jishiben.api.common.ApiException;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/premium")
public class PremiumController {
    private final PremiumService premium;
    public PremiumController(PremiumService premium) { this.premium = premium; }
    @PostMapping("/guest") public PremiumDtos.Guest guest() { return premium.createGuest(); }
    @GetMapping("/status") public PremiumDtos.Status status(
            @RequestHeader(value="X-Premium-Guest-Token", required=false) String token) { return premium.status(token); }
    @PostMapping("/claim") public void claim(@Valid @RequestBody PremiumDtos.Guest request) { premium.claimGuest(request.token()); }
    @PostMapping("/sandbox/apply") public PremiumDtos.Status apply(
            @RequestHeader(value="X-Premium-Guest-Token", required=false) String token,
            @Valid @RequestBody PremiumDtos.Application request) { return premium.apply(token, request); }
    @PostMapping("/sandbox/{id}/cancel") public PremiumDtos.Status cancel(
            @RequestHeader(value="X-Premium-Guest-Token", required=false) String token, @PathVariable String id,
            @Valid @RequestBody PremiumDtos.Event request) { return premium.cancelSandbox(token, id, request); }
    @GetMapping("/access/scan")
    @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void scanAccess(@RequestHeader(value="X-Premium-Guest-Token", required=false) String token) {
        if (premium.settings().gatesEnabled() && !premium.status(token).capabilities().get("scan"))
            throw ApiException.forbidden("PREMIUM_REQUIRED:scan");
    }
    @PostMapping("/purchase") public void legacyPurchase() {
        throw ApiException.badRequest("Use the configured provider; client claims do not grant membership");
    }
}
