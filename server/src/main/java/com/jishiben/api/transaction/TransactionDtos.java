package com.jishiben.api.transaction;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public final class TransactionDtos {

    private TransactionDtos() {
    }

    /**
     * Every account/category reference is the client's own string id (never a database id), and an
     * empty string is accepted for "none" because that is what the app sends.
     */
    public record UpsertRequest(
            @NotBlank @Size(max = 64) String clientUid,
            @NotBlank String ledgerUid,
            String categoryUid,
            String assetUid,
            String fromAssetUid,
            String toAssetUid,
            @NotBlank String type,
            @NotNull BigDecimal amount,
            @Size(min = 3, max = 3) String currency,
            BigDecimal exchangeRate,
            BigDecimal convertedAmount,
            BigDecimal fee,
            @NotNull LocalDate occurredOn,
            @Size(max = 500) String note,
            @Size(max = 100) String displayName,
            @Size(max = 512) String receiptPath) {
    }

    public record PatchRequest(
            String ledgerUid,
            String categoryUid,
            String assetUid,
            String fromAssetUid,
            String toAssetUid,
            String type,
            BigDecimal amount,
            @Size(min = 3, max = 3) String currency,
            BigDecimal exchangeRate,
            BigDecimal convertedAmount,
            BigDecimal fee,
            LocalDate occurredOn,
            @Size(max = 500) String note,
            @Size(max = 100) String displayName,
            @Size(max = 512) String receiptPath) {
    }

    public record Response(
            String clientUid,
            String ledgerUid,
            String categoryUid,
            String assetUid,
            String fromAssetUid,
            String toAssetUid,
            String type,
            BigDecimal amount,
            String currency,
            BigDecimal exchangeRate,
            BigDecimal convertedAmount,
            BigDecimal fee,
            LocalDate occurredOn,
            String note,
            String displayName,
            String receiptPath,
            Instant createdAt,
            Instant updatedAt) {
    }
}
