package com.jishiben.api.profile;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public final class ProfileDtos {

    private ProfileDtos() {
    }

    /**
     * Every field is optional: PATCH semantics. Booleans/numbers are boxed so "absent" is
     * distinguishable from "explicitly zero", which matters for weekStartsOn and decimalPlaces.
     */
    public record UpdateRequest(
            @Size(max = 100) String displayName,
            @Size(min = 3, max = 3) String currency,
            @Size(max = 20) String dateFormat,
            @Min(0) @Max(1) Integer weekStartsOn,
            @Min(0) @Max(2) Integer decimalPlaces,
            JsonNode periodPreference,
            String activeLedgerUid) {
    }

    public record Response(
            String displayName,
            String currency,
            String dateFormat,
            int weekStartsOn,
            int decimalPlaces,
            JsonNode periodPreference,
            String activeLedgerUid,
            Instant updatedAt) {
    }
}
