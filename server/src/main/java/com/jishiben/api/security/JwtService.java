package com.jishiben.api.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Self-hosted HS256 JWTs. The signing key comes from the environment only and fails closed when it
 * is missing or shorter than 32 bytes.
 */
@Component
public class JwtService {

    public static final String CLAIM_UID = "uid";
    public static final String CLAIM_EMAIL = "eml";
    public static final String CLAIM_ROLE = "rol";
    public static final String CLAIM_VERSION = "ver";
    public static final String CLAIM_TYPE = "typ";
    public static final String TYPE_ACCESS = "access";
    public static final String TYPE_REFRESH = "refresh";

    private final SecretKey key;
    private final String issuer;
    private final Duration accessTtl;
    private final Duration refreshTtl;

    public JwtService(@Value("${app.jwt.secret:}") String secret,
                      @Value("${app.jwt.issuer:jishiben-api}") String issuer,
                      @Value("${app.jwt.access-token-ttl:PT24H}") Duration accessTtl,
                      @Value("${app.jwt.refresh-token-ttl:P30D}") Duration refreshTtl) {
        if (secret == null || secret.isBlank()
                || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException(
                    "app.jwt.secret (JWT_SECRET) must be configured with at least 32 bytes for HS256; "
                            + "refusing to start with a weak or missing signing key");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.issuer = issuer;
        this.accessTtl = accessTtl;
        this.refreshTtl = refreshTtl;
    }

    public record TokenPair(String accessToken, String refreshToken, long expiresInSeconds) {
    }

    public TokenPair issue(AuthPrincipal principal) {
        Instant now = Instant.now();
        return new TokenPair(
                build(principal, TYPE_ACCESS, now, accessTtl),
                build(principal, TYPE_REFRESH, now, refreshTtl),
                accessTtl.toSeconds());
    }

    private String build(AuthPrincipal principal, String type, Instant now, Duration ttl) {
        return Jwts.builder()
                .issuer(issuer)
                .subject(Long.toString(principal.id()))
                .claim(CLAIM_UID, principal.id())
                .claim(CLAIM_EMAIL, principal.email())
                .claim(CLAIM_ROLE, principal.role())
                .claim(CLAIM_VERSION, principal.tokenVersion())
                .claim(CLAIM_TYPE, type)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    public Claims parseAccess(String token) {
        return parse(token, TYPE_ACCESS);
    }

    public Claims parseRefresh(String token) {
        return parse(token, TYPE_REFRESH);
    }

    private Claims parse(String token, String expectedType) {
        Claims claims = Jwts.parser()
                .verifyWith(key)
                .requireIssuer(issuer)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        String type = claims.get(CLAIM_TYPE, String.class);
        if (!expectedType.equals(type)) {
            throw new JwtException("Unexpected token type: " + type);
        }
        return claims;
    }

    public AuthPrincipal principal(Claims claims) {
        Number id = claims.get(CLAIM_UID, Number.class);
        if (id == null) {
            throw new JwtException("Token is missing the user id claim");
        }
        Integer version = claims.get(CLAIM_VERSION, Integer.class);
        String role = claims.get(CLAIM_ROLE, String.class);
        String email = claims.get(CLAIM_EMAIL, String.class);
        return new AuthPrincipal(id.longValue(), email, role == null ? "USER" : role,
                version == null ? 0 : version);
    }
}
