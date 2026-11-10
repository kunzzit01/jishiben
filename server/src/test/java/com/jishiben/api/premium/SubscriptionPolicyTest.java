package com.jishiben.api.premium;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class SubscriptionPolicyTest {
    final Instant now = Instant.parse("2026-01-31T10:00:00Z");
    @Test void accessRequiresConfirmedPaymentAndAnUnexpiredTerm() {
        for (String state : List.of("PENDING", "ON_HOLD", "PAUSED", "EXPIRED", "REVOKED", "REJECTED", "PENDING_PURCHASE_CANCELED"))
            assertThat(SubscriptionPolicy.entitled(state, now.plusSeconds(3600), now)).as(state).isFalse();
        for (String state : List.of("ACTIVE", "CANCELED", "IN_GRACE_PERIOD")) {
            assertThat(SubscriptionPolicy.entitled(state, now.plusSeconds(1), now)).as(state).isTrue();
            assertThat(SubscriptionPolicy.entitled(state, now, now)).as(state).isFalse();
            assertThat(SubscriptionPolicy.entitled(state, null, now)).isFalse();
        }
    }
    @Test void ordinaryCancellationKeepsThePaidExpiryAndStopsRenewal() {
        var expiry = now.plusSeconds(3600);
        var canceled = SubscriptionPolicy.simulate("CANCEL", "ACTIVE", "monthly", expiry, true, now);
        assertThat(canceled.expiry()).isEqualTo(expiry);
        assertThat(canceled.autoRenew()).isFalse();
        assertThat(SubscriptionPolicy.entitled(canceled.state(), canceled.expiry(), now)).isTrue();
    }
    @Test void refundAndRevocationAreSeparateEvents() {
        var expiry = now.plusSeconds(3600);
        var refund = SubscriptionPolicy.simulate("REFUND_ONLY", "ACTIVE", "monthly", expiry, true, now);
        assertThat(SubscriptionPolicy.entitled(refund.state(), refund.expiry(), now)).isTrue();
        var revoked = SubscriptionPolicy.simulate("REVOKE", "ACTIVE", "monthly", expiry, true, now);
        assertThat(SubscriptionPolicy.entitled(revoked.state(), revoked.expiry(), now)).isFalse();
    }
    @Test void planPeriodsUseCalendarMonthsAndYears() {
        assertThat(SubscriptionPolicy.nextExpiry("monthly", now)).isEqualTo(Instant.parse("2026-02-28T10:00:00Z"));
        assertThat(SubscriptionPolicy.nextExpiry("yearly", now)).isEqualTo(Instant.parse("2027-01-31T10:00:00Z"));
    }
    @Test void invalidTransitionsCannotRegrantOrRenewAnUnpaidPurchase() {
        assertThatThrownBy(() -> SubscriptionPolicy.simulate("RENEW", "PENDING", "monthly", null, false, now)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> SubscriptionPolicy.simulate("APPROVE", "ACTIVE", "monthly", now.plusSeconds(60), true, now)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> SubscriptionPolicy.simulate("RENEW", "CANCELED", "monthly", now.plusSeconds(60), false, now)).isInstanceOf(RuntimeException.class);
    }
}
