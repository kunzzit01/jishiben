package com.jishiben.api.premium;

import com.jishiben.api.common.ApiException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;

/** The same entitlement policy is used for simulated and verified store subscriptions. */
public final class SubscriptionPolicy {
    public static final Set<String> FEATURES = Set.of("scan", "financialPlan", "addLedger", "exchange");
    public static final Set<String> STATES = Set.of("PENDING", "ACTIVE", "CANCELED", "IN_GRACE_PERIOD",
            "ON_HOLD", "PAUSED", "EXPIRED", "REVOKED", "REJECTED", "PENDING_PURCHASE_CANCELED");

    private SubscriptionPolicy() {}

    public static boolean entitled(String state, Instant expiry, Instant now) {
        return Set.of("ACTIVE", "CANCELED", "IN_GRACE_PERIOD").contains(state)
                && expiry != null && expiry.isAfter(now);
    }

    public static Instant nextExpiry(String plan, Instant from) {
        return switch (plan) {
            case "monthly" -> from.atZone(ZoneOffset.UTC).plusMonths(1).toInstant();
            case "yearly" -> from.atZone(ZoneOffset.UTC).plusYears(1).toInstant();
            default -> throw ApiException.validation("Unknown base plan");
        };
    }

    public record Change(String state, Instant expiry, boolean autoRenew) {}

    public static Change simulate(String event, String state, String plan, Instant expiry,
                                  boolean autoRenew, Instant now) {
        boolean valid = entitled(state, expiry, now);
        return switch (event) {
            case "APPROVE" -> {
                require("PENDING".equals(state));
                yield new Change("ACTIVE", nextExpiry(plan, now), true);
            }
            case "REJECT" -> {
                require("PENDING".equals(state));
                yield new Change("REJECTED", null, false);
            }
            case "RENEW" -> {
                require(valid && autoRenew && !"CANCELED".equals(state));
                yield new Change("ACTIVE", nextExpiry(plan, expiry), true);
            }
            case "CANCEL" -> {
                require(valid);
                yield new Change("CANCELED", expiry, false);
            }
            case "GRACE" -> {
                require(valid && autoRenew);
                yield new Change("IN_GRACE_PERIOD", now.plusSeconds(3 * 86400), true);
            }
            case "HOLD" -> {
                require(valid || "IN_GRACE_PERIOD".equals(state));
                yield new Change("ON_HOLD", expiry, true);
            }
            case "PAUSE" -> {
                require(valid);
                yield new Change("PAUSED", expiry, true);
            }
            case "RECOVER" -> {
                require(Set.of("ON_HOLD", "PAUSED").contains(state));
                yield new Change("ACTIVE", nextExpiry(plan, now), true);
            }
            case "EXPIRE" -> {
                require(!Set.of("PENDING", "REJECTED", "REVOKED").contains(state));
                yield new Change("EXPIRED", now, false);
            }
            case "REFUND_ONLY" -> {
                require(valid);
                yield new Change(state, expiry, autoRenew);
            }
            case "REVOKE" -> {
                require(!"PENDING".equals(state));
                yield new Change("REVOKED", now, false);
            }
            default -> throw ApiException.validation("Unknown sandbox event");
        };
    }

    private static void require(boolean allowed) {
        if (!allowed) throw ApiException.conflict("Event is not valid for the current subscription state");
    }
}
