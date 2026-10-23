package com.jishiben.api.push;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public final class PushDtos {

    private PushDtos() {
    }

    public record RegisterRequest(
            @NotBlank @Size(max = 191) String token,
            @Size(max = 16) String platform) {
    }

    public record UnregisterRequest(@NotBlank @Size(max = 191) String token) {
    }

    public record Response(String token, String platform, Instant lastSeenAt) {
    }
}
