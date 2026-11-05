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

    /** Google 登录：只收 ID Token；邮箱/姓名一律以服务端验证后的载荷为准。 */
    public record GoogleLoginRequest(@NotBlank @Size(max = 4096) String idToken,
            /** login（默认）或 signup：注册页用 Google 时，已存在的账号不能被当成「注册成功」直接登录 */
            @Size(max = 16) String mode) {
        /** 兼容只有 idToken 的调用方（登录意图） */
        public GoogleLoginRequest(String idToken) {
            this(idToken, null);
        }
    }

    /** 同邮箱已有密码账号时的绑定：必须同时证明本 App 密码 + 再验一次 Google Token。 */
    public record GoogleLinkRequest(
            @NotBlank @Size(max = 4096) String idToken,
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
            Instant createdAt,
            /** 是否已绑定 Google（UI 用它显示 已绑定/未绑定 + 决定「解绑」是否可点） */
            boolean googleLinked) {
    }

    public record TokenResponse(
            String tokenType,
            String accessToken,
            String refreshToken,
            long expiresIn,
            UserResponse user) {
    }
}
