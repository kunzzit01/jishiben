package com.jishiben.api.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class MoneyTest {

    @Test
    void scalesToTheColumnScaleWithHalfUp() {
        assertThat(Money.scale(new BigDecimal("1.005"))).isEqualTo(new BigDecimal("1.0050"));
        assertThat(Money.scale(new BigDecimal("12.34567"))).isEqualTo(new BigDecimal("12.3457"));
    }

    @Test
    void keepsNullNull() {
        assertThat(Money.scale(null)).isNull();
        assertThat(Money.optionalAmount(null, "fee")).isNull();
    }

    @Test
    void rejectsNegativeAndOversizedAmounts() {
        assertThatThrownBy(() -> Money.requireAmount(new BigDecimal("-0.01"), "amount"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("negative");
        assertThatThrownBy(() -> Money.requireAmount(new BigDecimal("1000000000001"), "amount"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("too large");
    }

    @Test
    void additionStaysExactForDecimalMoney() {
        // The classic float trap: 0.1 + 0.2 must be 0.3000, not 0.30000000000000004.
        assertThat(Money.plus(new BigDecimal("0.1"), new BigDecimal("0.2")))
                .isEqualTo(new BigDecimal("0.3000"));
        assertThat(Money.plus(null, new BigDecimal("5"))).isEqualTo(new BigDecimal("5.0000"));
    }

    @Test
    void ratioNeverDividesByZero() {
        assertThat(Money.ratioPercent(new BigDecimal("1"), BigDecimal.ZERO)).isNull();
        assertThat(Money.ratioPercent(new BigDecimal("30"), new BigDecimal("100")))
                .isEqualTo(new BigDecimal("30.00"));
    }

    @Test
    void amountScaleIsFourAndRateScaleIsEight() {
        assertThat(Money.SCALE).isEqualTo(4);
        assertThat(Money.RATE_SCALE).isEqualTo(8);
        assertThat(Money.scaleRate(new BigDecimal("0.2155"))).isEqualTo(new BigDecimal("0.21550000"));
    }
}
