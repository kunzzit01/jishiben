package com.jishiben.api.report;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class ReportDtos {

    private ReportDtos() {
    }

    /**
     * Totals are grouped by currency and never merged: mixing MYR and USD into one number would be a
     * fabricated exchange rate. Transfers are excluded from income/expense because they only move money.
     */
    public record Summary(
            LocalDate from,
            LocalDate to,
            String currencyFilter,
            List<CurrencySummary> currencies) {
    }

    public record CurrencySummary(
            String currency,
            BigDecimal income,
            BigDecimal expense,
            BigDecimal net,
            long transactionCount,
            List<CategoryTotal> categories) {
    }

    public record CategoryTotal(String categoryUid, String name, BigDecimal amount, long count) {
    }

    public record AssetBalances(
            List<AssetBalance> assets,
            List<CurrencyTotal> totalsByCurrency) {
    }

    /** Same arithmetic as the app: initial + income - expense + transferIn - transferOut. */
    public record AssetBalance(
            String assetUid,
            String name,
            String type,
            String currency,
            boolean archived,
            BigDecimal initialBalance,
            BigDecimal income,
            BigDecimal expense,
            BigDecimal transferIn,
            BigDecimal transferOut,
            BigDecimal balance) {
    }

    public record CurrencyTotal(String currency, BigDecimal balance) {
    }
}
