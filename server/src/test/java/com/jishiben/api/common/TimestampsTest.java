package com.jishiben.api.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class TimestampsTest {

    /** The schema stores DATETIME (second precision); truncating here keeps echoed == stored. */
    @Test
    void nowDropsSubSecondPrecision() {
        Instant now = Timestamps.now();

        assertThat(now.getNano()).isZero();
        assertThat(Duration.between(now, Instant.now())).isLessThan(Duration.ofSeconds(2));
    }
}
