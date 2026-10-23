package com.jishiben.api.budget;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;

public final class BudgetDtos {

    private BudgetDtos() {
    }

    /**
     * categoryUid carries the app's magic value: 'total' (or absent) means the overall budget,
     * '' means the same thing, and anything else is a real category id. currency blank means
     * "whatever the account-level currency is right now", frozen at write time.
     */
    public record UpsertRequest(
            @Size(max = 64) String clientUid,
            String categoryUid,
            @NotNull BigDecimal amount,
            @Size(min = 3, max = 3) String currency) {
    }

    public record Response(
            String clientUid,
            String scope,
            String categoryUid,
            String currency,
            BigDecimal amount,
            Instant createdAt,
            Instant updatedAt) {
    }
}
