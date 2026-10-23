package com.jishiben.api.rates;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/exchange-rates")
public class ExchangeRateController {

    private final ExchangeRateService rates;

    public ExchangeRateController(ExchangeRateService rates) {
        this.rates = rates;
    }

    @GetMapping
    public ExchangeRateDtos.Response get(@RequestParam String base,
                                         @RequestParam(defaultValue = "false") boolean refresh) {
        return rates.get(base, refresh);
    }
}
