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

    /** Guest bearer credential (returned once at creation; the server stores only its digest). */
    public record Guest(@NotBlank @Size(min = 32, max = 128) String token) {}

    public record Application(@NotBlank @Pattern(regexp = "monthly|yearly") String basePlan,
                              @NotBlank @Size(max = 64) String requestKey) {}

    public record Event(@NotBlank @Size(max = 40) String event,
                        @NotBlank @Size(max = 64) String requestKey, int expectedRevision) {}

    /**
     * A Play purchase token to verify. {@code claim=true} is the user's explicit confirmation to move
     * a purchase that belongs to an unbound guest identity into the signed-in account.
     */
    public record Verify(@NotBlank @Size(max = 4096) String purchaseToken, boolean claim) {}

    public record Subscription(String id, String provider, String basePlan, String state,
                               Instant expiresAt, boolean autoRenew, int revision, boolean acknowledged,
                               boolean testPurchase, Instant refundedAt, String refundType) {}

    /**
     * {@code mode}: SANDBOX when the simulator is open in this (staging) deployment, GOOGLE_PLAY when
     * real Google Play billing is enabled, NONE otherwise. {@code subjectId} is null for an anonymous
     * caller that has no billing identity yet.
     */
    public record Status(boolean implemented, boolean active, boolean administrator, String subjectId,
                         String obfuscatedAccountId, String mode, String environment, boolean googleEnabled,
                         boolean enrollmentOpen, boolean sandboxAvailable, boolean gatesEnabled,
                         Instant serverTime, Instant expiresAt, Map<String, Boolean> capabilities,
                         List<Subscription> subscriptions) {}

    public record AdminSubscription(Subscription subscription, String subjectId, String identity) {}

    public record AdminEvent(Instant at, String type, String subscriptionId, String fromState, String toState,
                             Long actorId, String detail) {}

    public record Console(Settings settings, String environment, boolean sandboxAllowed, boolean googleEnabled,
                          List<AdminSubscription> subscriptions, List<AdminEvent> events, List<String> alerts) {}
}
