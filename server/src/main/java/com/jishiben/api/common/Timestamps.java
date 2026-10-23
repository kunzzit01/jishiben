package com.jishiben.api.common;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Audit timestamps at the precision the schema actually stores. Every audit column is a MySQL
 * DATETIME (second precision), which rounds a fractional {@link Instant} on write; truncating here
 * keeps the value a response echoes identical to the value that was stored, so replaying the same
 * clientUid cannot make createdAt look refreshed.
 */
public final class Timestamps {

    private Timestamps() {
    }

    public static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.SECONDS);
    }
}
