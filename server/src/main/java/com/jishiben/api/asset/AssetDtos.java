package com.jishiben.api.asset;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;

public final class AssetDtos {

    private AssetDtos() {
    }

    public record UpsertRequest(
            @NotBlank @Size(max = 64) String clientUid,
            @NotBlank String ledgerUid,
            @NotBlank @Size(max = 100) String name,
            @NotBlank @Size(max = 64) String icon,
            @NotBlank @Size(max = 7) String color,
            @NotBlank String type,
            @NotBlank @Size(min = 3, max = 3) String currency,
            BigDecimal initialBalance,
            BigDecimal creditLimit,
            Integer statementDay,
            Integer dueDay,
            BigDecimal interestRate,
            Boolean defaultAsset,
            Integer sortOrder,
            Boolean archived) {
    }

    public record PatchRequest(
            String ledgerUid,
            @Size(max = 100) String name,
            @Size(max = 64) String icon,
            @Size(max = 7) String color,
            String type,
            @Size(min = 3, max = 3) String currency,
            BigDecimal initialBalance,
            BigDecimal creditLimit,
            Integer statementDay,
            Integer dueDay,
            BigDecimal interestRate,
            Boolean defaultAsset,
            Integer sortOrder,
            Boolean archived) {
    }

    /** Amounts are BigDecimal so no client ever sees a 0.30000000000000004. */
    public record Response(
            String clientUid,
            String ledgerUid,
            String name,
            String icon,
            String color,
            String type,
            String currency,
            BigDecimal initialBalance,
            BigDecimal creditLimit,
            Integer statementDay,
            Integer dueDay,
            BigDecimal interestRate,
            boolean defaultAsset,
            int sortOrder,
            boolean archived,
            Instant archivedAt,
            Instant createdAt,
            Instant updatedAt) {
    }
}
