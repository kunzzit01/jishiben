package com.jishiben.api.premium;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class PremiumDtos {
    private PremiumDtos() {}
    public record Settings(boolean enrollmentOpen, boolean sandboxOpen, boolean gatesEnabled) {}
    public record Guest(@NotBlank @Size(min=72, max=72) String token) {}
    public record Application(@NotBlank @Pattern(regexp = "monthly|yearly") String basePlan,
                              @NotBlank @Size(max = 64) String requestKey) {}
    public record Event(@NotBlank @Size(max = 40) String event,
                        @NotBlank @Size(max = 64) String requestKey, int expectedRevision) {}
    public record Verify(@NotBlank @Size(max = 4096) String purchaseToken) {}
    public record Subscription(String id, String provider, String basePlan, String state,
                               Instant expiresAt, boolean autoRenew, int revision, boolean acknowledged) {}
    public record Status(boolean implemented, boolean active, boolean administrator, String subjectId,
                         String obfuscatedAccountId, String mode, boolean enrollmentOpen,
                         boolean sandboxAvailable, boolean gatesEnabled, Instant serverTime,
                         Instant expiresAt, Map<String, Boolean> capabilities, List<Subscription> subscriptions) {}
    public record AdminSubscription(Subscription subscription, String subjectId, String identity) {}
    public record Console(Settings settings, boolean sandboxAllowed, List<AdminSubscription> subscriptions) {}
}
