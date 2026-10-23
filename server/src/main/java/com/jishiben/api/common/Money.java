package com.jishiben.api.common;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Money helper. Every amount in this service is {@link BigDecimal}; floating point is never
 * involved, so no amount is ever routed through a binary representation.
 */
public final class Money {

    /** Column scale of every DECIMAL(19,4) amount. */
    public static final int SCALE = 4;

    /** Column scale of DECIMAL(19,8) exchange rates. */
    public static final int RATE_SCALE = 8;

    /**
     * Largest amount we accept, chosen so that the JSON number stays inside IEEE-754 doubles for
     * JavaScript clients (2^53 minor units) even after multiplying by 10^4: 10^12 is safe.
     */
    public static final BigDecimal MAX_AMOUNT = new BigDecimal("1000000000000");

    private Money() {
    }

    /** Null-safe rescale to the column scale; null stays null. */
    public static BigDecimal scale(BigDecimal value) {
        return value == null ? null : value.setScale(SCALE, RoundingMode.HALF_UP);
    }

    /** Null-safe rescale to the exchange-rate scale. */
    public static BigDecimal scaleRate(BigDecimal value) {
        return value == null ? null : value.setScale(RATE_SCALE, RoundingMode.HALF_UP);
    }

    public static BigDecimal requireAmount(BigDecimal value, String field) {
        if (value == null) {
            throw ApiException.validation(field + " is required");
        }
        if (value.signum() < 0) {
            throw ApiException.validation(field + " must not be negative");
        }
        if (value.abs().compareTo(MAX_AMOUNT) > 0) {
            throw ApiException.validation(field + " is too large");
        }
        return scale(value);
    }

    public static BigDecimal optionalAmount(BigDecimal value, String field) {
        if (value == null) {
            return null;
        }
        if (value.signum() < 0) {
            throw ApiException.validation(field + " must not be negative");
        }
        if (value.abs().compareTo(MAX_AMOUNT) > 0) {
            throw ApiException.validation(field + " is too large");
        }
        return scale(value);
    }

    /** Sum helper for reports: null-safe and every operand already carries its own currency bucket. */
    public static BigDecimal plus(BigDecimal left, BigDecimal right) {
        BigDecimal a = left == null ? BigDecimal.ZERO : left;
        BigDecimal b = right == null ? BigDecimal.ZERO : right;
        return a.add(b).setScale(SCALE, RoundingMode.HALF_UP);
    }

    /** Ratio-safe: never divides by zero, never returns NaN. */
    public static BigDecimal ratioPercent(BigDecimal part, BigDecimal whole) {
        if (whole == null || whole.signum() == 0) {
            return null;
        }
        return part.multiply(BigDecimal.valueOf(100)).divide(whole, 2, RoundingMode.HALF_UP);
    }
}
