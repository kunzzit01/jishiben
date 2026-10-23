package com.jishiben.api.rates;

import com.fasterxml.jackson.databind.JsonNode;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Texts;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 24h cache in front of the upstream provider. Rates here are reference data for display only: any
 * rate that participates in arithmetic is stored on the transaction as DECIMAL(19,8).
 */
@Service
public class ExchangeRateService {

    private static final Logger log = LoggerFactory.getLogger(ExchangeRateService.class);

    private final ExchangeRateRepository rates;
    private final RateProvider provider;
    private final Duration ttl;

    public ExchangeRateService(ExchangeRateRepository rates, RateProvider provider,
                               @Value("${app.rates.ttl:PT24H}") Duration ttl) {
        this.rates = rates;
        this.provider = provider;
        this.ttl = ttl;
    }

    @Transactional
    public ExchangeRateDtos.Response get(String base, boolean refresh) {
        String clean = Texts.upperCurrency(base, "base");
        ExchangeRate cached = rates.findByBase(clean).orElse(null);
        if (!refresh && cached != null && isFresh(cached)) {
            return toResponse(cached, false);
        }
        try {
            JsonNode payload = provider.fetchRates(clean);
            ExchangeRate row = cached != null ? cached : new ExchangeRate();
            row.setBase(clean);
            row.setRates(payload);
            row.setFetchedAt(Instant.now());
            return toResponse(rates.save(row), false);
        } catch (ApiException ex) {
            if (cached != null) {
                log.warn("Serving cached rates for {} because the upstream call failed: {}", clean,
                        ex.getMessage());
                return toResponse(cached, true);
            }
            throw ex;
        }
    }

    private boolean isFresh(ExchangeRate row) {
        return row.getFetchedAt() != null && row.getFetchedAt().isAfter(Instant.now().minus(ttl));
    }

    private static ExchangeRateDtos.Response toResponse(ExchangeRate row, boolean stale) {
        return new ExchangeRateDtos.Response(row.getBase(), row.getRates(), row.getFetchedAt(), stale);
    }
}
