package com.jishiben.api.paymentplan;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public final class PaymentPlanDtos {

    private PaymentPlanDtos() {
    }

    public record UpsertRequest(
            @NotBlank @Size(max = 64) String clientUid,
            @NotBlank String ledgerUid,
            String categoryUid,
            String assetUid,
            @NotBlank @Size(max = 100) String name,
            @NotNull BigDecimal amount,
            @NotBlank String type,
            @NotBlank String cycle,
            Integer dayOfWeek,
            Integer dayOfMonth,
            Integer monthOfYear,
            Integer day,
            @NotNull LocalDate startDate,
            LocalDate endDate,
            Boolean autoDeduct,
            LocalDate lastProcessedDate,
            Boolean active,
            Integer sortOrder,
            Boolean archived) {
    }

    public record PatchRequest(
            String ledgerUid,
            String categoryUid,
            String assetUid,
            @Size(max = 100) String name,
            BigDecimal amount,
            String type,
            String cycle,
            Integer dayOfWeek,
            Integer dayOfMonth,
            Integer monthOfYear,
            Integer day,
            LocalDate startDate,
            LocalDate endDate,
            Boolean autoDeduct,
            LocalDate lastProcessedDate,
            Boolean active,
            Integer sortOrder,
            Boolean archived) {
    }

    public record Response(
            String clientUid,
            String ledgerUid,
            String categoryUid,
            String assetUid,
            String name,
            BigDecimal amount,
            String type,
            String cycle,
            Integer dayOfWeek,
            Integer dayOfMonth,
            Integer monthOfYear,
            Integer day,
            LocalDate startDate,
            LocalDate endDate,
            boolean autoDeduct,
            LocalDate lastProcessedDate,
            boolean active,
            int sortOrder,
            boolean archived,
            Instant createdAt,
            Instant updatedAt) {
    }
}
