package com.jishiben.api.rates;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

public final class ExchangeRateDtos {

    private ExchangeRateDtos() {
    }

    /** stale=true means the upstream call failed and a cached payload older than the TTL was served. */
    public record Response(String base, JsonNode rates, Instant fetchedAt, boolean stale) {
    }
}
