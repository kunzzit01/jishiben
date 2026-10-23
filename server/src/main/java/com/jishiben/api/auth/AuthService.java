package com.jishiben.api.auth;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.common.Texts;
import com.jishiben.api.profile.ProfileService;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.security.JwtService;
import com.jishiben.api.user.User;
import com.jishiben.api.user.UserRepository;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import java.time.Instant;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Register, sign in, refresh, and the two operations that invalidate every existing token
 * (password change, log out everywhere) by bumping users.token_version.
 */
@Service
public class AuthService {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final ProfileService profiles;

    public AuthService(UserRepository users, PasswordEncoder passwordEncoder, JwtService jwtService,
                       ProfileService profiles) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.profiles = profiles;
    }

    @Transactional
    public AuthDtos.TokenResponse register(AuthDtos.RegisterRequest request) {
        String email = normaliseEmail(request.email());
        if (users.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("This email is already registered");
        }
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setDisplayName(Texts.trimToNull(request.displayName()));
        user.setUserRole("USER");
        User saved = users.save(user);
        // A profile row carries the account-level currency that blank budget currencies inherit.
        profiles.ensure(saved.getId());
        return tokens(saved);
    }

    @Transactional
    public AuthDtos.TokenResponse login(AuthDtos.LoginRequest request) {
        User user = users.findByEmailIgnoreCase(normaliseEmail(request.email())).orElse(null);
        // Same error for "unknown email" and "wrong password": no account enumeration.
        if (user == null || user.getPasswordHash() == null
                || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw ApiException.invalidCredentials();
        }
        user.setLastLoginAt(Instant.now());
        return tokens(users.save(user));
    }

    @Transactional(readOnly = true)
    public AuthDtos.TokenResponse refresh(AuthDtos.RefreshRequest request) {
        Claims claims;
        try {
            claims = jwtService.parseRefresh(request.refreshToken());
        } catch (ExpiredJwtException ex) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.TOKEN_EXPIRED,
                    "Refresh token has expired; sign in again");
        } catch (JwtException | IllegalArgumentException ex) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.TOKEN_INVALID,
                    "Refresh token is not valid");
        }
        AuthPrincipal claimed = jwtService.principal(claims);
        User user = users.findById(claimed.id())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.TOKEN_INVALID,
                        "Refresh token is not valid"));
        if (user.getTokenVersion() != claimed.tokenVersion()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.TOKEN_REVOKED,
                    "This session has been revoked; sign in again");
        }
        return tokens(user);
    }

    /** Signs out every device: the version bump makes all previously issued tokens useless. */
    @Transactional
    public AuthDtos.TokenResponse logoutEverywhere(long ownerId) {
        User user = requireUser(ownerId);
        user.setTokenVersion(user.getTokenVersion() + 1);
        return tokens(users.save(user));
    }

    @Transactional
    public AuthDtos.TokenResponse changePassword(long ownerId, AuthDtos.ChangePasswordRequest request) {
        User user = requireUser(ownerId);
        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw ApiException.badRequest("Current password is incorrect");
        }
        if (passwordEncoder.matches(request.newPassword(), user.getPasswordHash())) {
            throw ApiException.validation("New password must be different from the current password");
        }
        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        user.setTokenVersion(user.getTokenVersion() + 1);
        return tokens(users.save(user));
    }

    @Transactional
    public AuthDtos.UserResponse updateMe(long ownerId, AuthDtos.UpdateMeRequest request) {
        User user = requireUser(ownerId);
        if (request.displayName() != null) {
            user.setDisplayName(Texts.trimToNull(request.displayName()));
            user = users.save(user);
        }
        return toResponse(user);
    }

    @Transactional(readOnly = true)
    public AuthDtos.UserResponse me(long ownerId) {
        return toResponse(requireUser(ownerId));
    }

    private User requireUser(long ownerId) {
        return users.findById(ownerId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.TOKEN_REVOKED,
                        "This account no longer exists"));
    }

    private AuthDtos.TokenResponse tokens(User user) {
        AuthPrincipal principal = new AuthPrincipal(user.getId(), user.getEmail(), user.getUserRole(),
                user.getTokenVersion());
        JwtService.TokenPair pair = jwtService.issue(principal);
        return new AuthDtos.TokenResponse("Bearer", pair.accessToken(), pair.refreshToken(),
                pair.expiresInSeconds(), toResponse(user));
    }

    private AuthDtos.UserResponse toResponse(User user) {
        return new AuthDtos.UserResponse(user.getId(), user.getEmail(), user.getDisplayName(),
                user.getUserRole(), user.getEmailVerifiedAt() != null, user.getCreatedAt());
    }

    private static String normaliseEmail(String email) {
        return Texts.requireNonBlank(email, "email").toLowerCase(Locale.ROOT);
    }
}
