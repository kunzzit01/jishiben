package com.jishiben.api.premium;

import com.jishiben.api.common.ApiException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/premium")
public class PremiumController {
    private static final String GUEST = "X-Premium-Guest-Token";
    private final PremiumService premium;

    public PremiumController(PremiumService premium) { this.premium = premium; }

    /** Creates a guest billing identity on demand (never on app launch). Rate-limited at nginx. */
    @PostMapping("/guest")
    public PremiumDtos.Guest guest() { return premium.createGuest(); }

    /** Works without any identity: anonymous callers get the switches but no subscriptions. */
    @GetMapping("/status")
    public PremiumDtos.Status status(@RequestHeader(value = GUEST, required = false) String token) {
        return premium.status(token);
    }

    @PostMapping("/claim")
    public PremiumDtos.Status claim(@Valid @RequestBody PremiumDtos.Guest request) {
        return premium.claimGuest(request.token());
    }

    @PostMapping("/sandbox/apply")
    public PremiumDtos.Status apply(@RequestHeader(value = GUEST, required = false) String token,
                                    @Valid @RequestBody PremiumDtos.Application request) {
        return premium.apply(token, request);
    }

    @PostMapping("/sandbox/{id}/cancel")
    public PremiumDtos.Status cancel(@RequestHeader(value = GUEST, required = false) String token, @PathVariable String id,
                                     @Valid @RequestBody PremiumDtos.Event request) {
        return premium.cancelSandbox(token, id, request);
    }

    /** nginx auth_request for /ocr/: 204 when receipt scanning is allowed for this caller. */
    @GetMapping("/access/scan")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void scanAccess(@RequestHeader(value = GUEST, required = false) String token) {
        if (!premium.scanAllowed(token)) throw PremiumService.premiumRequired("scan");
    }

    @PostMapping("/purchase")
    public void legacyPurchase() {
        throw ApiException.badRequest("Client claims never grant membership; use the configured store flow");
    }
}
