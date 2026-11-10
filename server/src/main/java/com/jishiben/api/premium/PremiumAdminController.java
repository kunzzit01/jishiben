package com.jishiben.api.premium;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Every operation re-checks the administrator on the server (Google-established session + pinned sub). */
@RestController
@RequestMapping("/api/admin/premium")
public class PremiumAdminController {
    private final PremiumService premium;

    public PremiumAdminController(PremiumService premium) { this.premium = premium; }

    @GetMapping
    public PremiumDtos.Console console() { return premium.console(); }

    @PutMapping("/settings")
    public PremiumDtos.Console settings(@RequestBody PremiumDtos.Settings settings) {
        return premium.updateSettings(settings);
    }

    @PostMapping("/{id}/events")
    public PremiumDtos.Console event(@PathVariable String id, @Valid @RequestBody PremiumDtos.Event event) {
        return premium.simulate(id, event);
    }
}
