package com.jishiben.api.premium;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/premium")
public class PremiumAdminController {
    private final PremiumService premium;
    public PremiumAdminController(PremiumService premium) { this.premium = premium; }
    @GetMapping public PremiumDtos.Console console() { return premium.console(); }
    @PutMapping("/settings") public PremiumDtos.Console settings(@RequestBody PremiumDtos.Settings settings) {
        return premium.updateSettings(settings);
    }
    @PostMapping("/{id}/events") public PremiumDtos.Console event(@PathVariable String id,
            @Valid @RequestBody PremiumDtos.Event event) { return premium.simulate(id, event); }
}
