package com.jishiben.api.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(min = 8, max = 72) String password,
            @Size(max = 100) String displayName) {
    }

    public record LoginRequest(
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(max = 72) String password) {
    }

    public record RefreshRequest(@NotBlank String refreshToken) {
    }

    public record ChangePasswordRequest(
            @NotBlank @Size(max = 72) String currentPassword,
            @NotBlank @Size(min = 8, max = 72) String newPassword) {
    }

    public record UpdateMeRequest(@Size(max = 100) String displayName) {
    }

    /** Never carries the password hash, the token version, or any credentials. */
    public record UserResponse(
            long id,
            String email,
            String displayName,
            String role,
            boolean emailVerified,
            Instant createdAt) {
    }

    public record TokenResponse(
            String tokenType,
            String accessToken,
            String refreshToken,
            long expiresIn,
            UserResponse user) {
    }
}
