package com.jishiben.api.ledger;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public final class LedgerDtos {

    private LedgerDtos() {
    }

    /** Full row for an idempotent upsert keyed on clientUid. */
    public record UpsertRequest(
            @NotBlank @Size(max = 64) String clientUid,
            @NotBlank @Size(max = 100) String name,
            @NotBlank @Size(max = 64) String icon,
            @Size(max = 7) String color,
            Integer sortOrder,
            Boolean defaultLedger,
            Boolean archived) {
    }

    public record PatchRequest(
            @Size(max = 100) String name,
            @Size(max = 64) String icon,
            @Size(max = 7) String color,
            Integer sortOrder,
            Boolean defaultLedger,
            Boolean archived) {
    }

    public record Response(
            String clientUid,
            String name,
            String icon,
            String color,
            int sortOrder,
            boolean defaultLedger,
            boolean archived,
            Instant archivedAt,
            Instant createdAt,
            Instant updatedAt) {
    }

    public record DeleteResult(
            String clientUid,
            boolean deleted,
            long deletedTransactions,
            long deletedPaymentPlans,
            long deletedAssets) {
    }
}
