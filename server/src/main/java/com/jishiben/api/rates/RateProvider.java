package com.jishiben.api.rates;

import com.fasterxml.jackson.databind.JsonNode;

/** Upstream reference-rate source. Injected as an interface so the service stays unit-testable. */
public interface RateProvider {

    /** Rates keyed by ISO-4217 code, relative to {@code base}. Throws ApiException on any failure. */
    JsonNode fetchRates(String base);
}
