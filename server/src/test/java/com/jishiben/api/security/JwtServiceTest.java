package com.jishiben.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    private final JwtService jwt = new JwtService(SECRET, "jishiben-api", Duration.ofHours(1),
            Duration.ofDays(30));

    @Test
    void roundTripsTheIdentityAndTheTokenVersion() {
        AuthPrincipal principal = new AuthPrincipal(7L, "a@b.com", "USER", 3);

        JwtService.TokenPair pair = jwt.issue(principal);
        AuthPrincipal parsed = jwt.principal(jwt.parseAccess(pair.accessToken()));

        assertThat(parsed.id()).isEqualTo(7L);
        assertThat(parsed.email()).isEqualTo("a@b.com");
        assertThat(parsed.tokenVersion()).isEqualTo(3);
        assertThat(pair.expiresInSeconds()).isEqualTo(3600);
    }

    @Test
    void refreshTokenCannotBeUsedAsAnAccessToken() {
        String refresh = jwt.issue(new AuthPrincipal(1L, "a@b.com", "USER", 0)).refreshToken();

        assertThatThrownBy(() -> jwt.parseAccess(refresh)).isInstanceOf(JwtException.class);
    }

    @Test
    void tamperedTokenIsRejected() {
        String token = jwt.issue(new AuthPrincipal(1L, "a@b.com", "USER", 0)).accessToken();
        String tampered = token.substring(0, token.length() - 2) + "xy";

        assertThatThrownBy(() -> jwt.parseAccess(tampered)).isInstanceOf(JwtException.class);
    }

    @Test
    void expiredTokenIsReportedAsExpired() {
        JwtService shortLived = new JwtService(SECRET, "jishiben-api", Duration.ofSeconds(-5),
                Duration.ofDays(1));
        String token = shortLived.issue(new AuthPrincipal(1L, "a@b.com", "USER", 0)).accessToken();

        assertThatThrownBy(() -> shortLived.parseAccess(token)).isInstanceOf(ExpiredJwtException.class);
    }

    @Test
    void weakOrMissingSecretFailsClosed() {
        assertThatThrownBy(() -> new JwtService("", "issuer", Duration.ofHours(1), Duration.ofDays(1)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least 32 bytes");
        assertThatThrownBy(() -> new JwtService("tooshort", "issuer", Duration.ofHours(1), Duration.ofDays(1)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void anotherIssuerIsRejected() {
        JwtService other = new JwtService(SECRET, "someone-else", Duration.ofHours(1), Duration.ofDays(1));
        String token = other.issue(new AuthPrincipal(1L, "a@b.com", "USER", 0)).accessToken();

        assertThatThrownBy(() -> jwt.parseAccess(token)).isInstanceOf(JwtException.class);
    }
}
