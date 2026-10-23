package com.jishiben.api.category;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public final class CategoryDtos {

    private CategoryDtos() {
    }

    public record GroupUpsertRequest(
            @NotBlank @Size(max = 64) String clientUid,
            @NotBlank @Size(max = 50) String name,
            @Size(max = 7) String color,
            @Size(max = 64) String icon,
            @NotBlank String type,
            Integer sortOrder,
            Boolean archived) {
    }

    public record GroupPatchRequest(
            @Size(max = 50) String name,
            @Size(max = 7) String color,
            @Size(max = 64) String icon,
            String type,
            Integer sortOrder,
            Boolean archived) {
    }

    public record GroupResponse(
            String clientUid,
            String name,
            String color,
            String icon,
            String type,
            int sortOrder,
            boolean archived,
            Instant createdAt,
            Instant updatedAt) {
    }

    public record UpsertRequest(
            @NotBlank @Size(max = 64) String clientUid,
            String groupUid,
            @NotBlank @Size(max = 50) String name,
            @NotBlank @Size(max = 64) String icon,
            @Size(max = 7) String color,
            @NotBlank String type,
            Integer sortOrder,
            Boolean archived) {
    }

    public record PatchRequest(
            String groupUid,
            @Size(max = 50) String name,
            @Size(max = 64) String icon,
            @Size(max = 7) String color,
            String type,
            Integer sortOrder,
            Boolean archived) {
    }

    public record Response(
            String clientUid,
            String groupUid,
            String name,
            String icon,
            String color,
            String type,
            int sortOrder,
            boolean archived,
            Instant createdAt,
            Instant updatedAt) {
    }
}
