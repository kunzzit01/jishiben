package com.jishiben.api.auth;

import com.google.api.client.json.gson.GsonFactory;
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
    private final GoogleTokenVerifier googleVerifier;

    public AuthService(UserRepository users, PasswordEncoder passwordEncoder, JwtService jwtService,
                       ProfileService profiles, GoogleTokenVerifier googleVerifier) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.profiles = profiles;
        this.googleVerifier = googleVerifier;
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

    /**
     * Google 登录：已验证邮箱才创建账号；同邮箱已有密码账号时**不**直接登录，返回 GOOGLE_LINK_REQUIRED。
     * 身份只认 Google 服务端验证过的载荷，客户端提交的邮箱 / 姓名 / sub 一律不采信。
     */
    @Transactional
    public AuthDtos.TokenResponse loginWithGoogle(AuthDtos.GoogleLoginRequest request) {
        GoogleTokenVerifier.GoogleIdentity identity = googleVerifier.verify(request.idToken());
        boolean signupMode = "signup".equalsIgnoreCase(request.mode());
        if (!identity.emailVerified() || identity.email() == null || identity.email().isBlank()) {
            throw ApiException.badRequest("Google account has no verified email");
        }

        // 1) 已绑定：按 sub 直接登录（邮箱后续变化也不影响）
        User bound = users.findByGoogleSub(identity.sub()).orElse(null);
        if (bound != null) {
            if (signupMode) {
                throw new ApiException(HttpStatus.CONFLICT, ErrorCode.GOOGLE_ALREADY_REGISTERED,
                        "This Google account is already registered; sign in instead");
            }
            bound.setLastLoginAt(Instant.now());
            applyGoogleProfile(bound, identity);
            return tokens(users.save(bound));
        }

        // 2) 同邮箱已有账号：产品决定（2026-11-05）—— Google 已验证该邮箱即视为账号所有权，
        //    自动把 google_sub 绑到这个账号并直接登录（原来是返回 GOOGLE_LINK_REQUIRED 让用户先验密码）。
        //    风险已由负责人确认：任何能登录该 Gmail 的人都能进入该记账账号；原密码登录照旧可用。
        User byEmail = users.findByEmailIgnoreCase(identity.email()).orElse(null);
        if (byEmail != null) {
            if (signupMode) {
                throw new ApiException(HttpStatus.CONFLICT, ErrorCode.GOOGLE_ALREADY_REGISTERED,
                        "This email is already registered; sign in instead");
            }
            if (byEmail.getGoogleSub() != null) {
                // 邮箱相同但已绑定到另一个 Google 身份：不能覆盖，明确拒绝
                throw new ApiException(HttpStatus.CONFLICT, ErrorCode.GOOGLE_SUB_TAKEN,
                        "This account is already linked to a different Google identity");
            }
            byEmail.setGoogleSub(identity.sub());
            byEmail.setLastLoginAt(Instant.now());
            if (byEmail.getEmailVerifiedAt() == null) {
                byEmail.setEmailVerifiedAt(Instant.now());
            }
            applyGoogleProfile(byEmail, identity);
            return tokens(users.save(byEmail));
        }

        // 3) 新账号：password_hash 保持 NULL（不造假密码），同一个事务里建 profile
        User user = new User();
        user.setEmail(normaliseEmail(identity.email()));
        user.setPasswordHash(null);
        // 新账号：displayName 先用 Google 完整姓名（保留中文/空格/顺序），缺失退化为邮箱 @ 前段
        user.setGoogleName(Texts.trimToNull(identity.name()));
        user.setAvatarUrl(Texts.trimToNull(identity.picture()));
        user.setDisplayName(Texts.trimToNull(identity.name()) != null
                ? Texts.trimToNull(identity.name())
                : emailLocalPart(identity.email()));
        user.setUserRole("USER");
        user.setGoogleSub(identity.sub());
        user.setEmailVerifiedAt(Instant.now());
        User saved = users.save(user);
        profiles.ensure(saved.getId());
        return tokens(saved);
    }

    /**
     * 把 Google 绑定到「当前已登录的」账号：需要本 App 密码再证一次身份 + 再验一次 Google Token。
     * 索要的是本 App 密码，绝不向用户要 Google 密码。
     */
    @Transactional
    public AuthDtos.TokenResponse linkGoogle(long ownerId, AuthDtos.GoogleLinkRequest request) {
        GoogleTokenVerifier.GoogleIdentity identity = googleVerifier.verify(request.idToken());
        User user = requireUser(ownerId);
        if (user.getPasswordHash() == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw ApiException.badRequest("Current password is incorrect");
        }
        if (user.getGoogleSub() != null) {
            throw new ApiException(HttpStatus.CONFLICT, ErrorCode.GOOGLE_ALREADY_LINKED,
                    "This account already has a Google identity linked");
        }
        if (identity.email() == null || !identity.email().equalsIgnoreCase(user.getEmail())) {
            throw ApiException.badRequest("Google account email does not match this account");
        }
        User other = users.findByGoogleSub(identity.sub()).orElse(null);
        if (other != null && other.getId() != user.getId()) {
            throw new ApiException(HttpStatus.CONFLICT, ErrorCode.GOOGLE_SUB_TAKEN,
                    "This Google account is already linked to another user");
        }
        user.setGoogleSub(identity.sub());
        user.setLastLoginAt(Instant.now());
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
            // 用户明确改过昵称：以后 Google 登录不再覆盖它
            user.setDisplayNameCustom(true);
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

    /**
     * 解绑 Google：只清 google_sub，不动账号本身。
     * 没有密码的账号（Google-only）不允许解绑 —— 否则会把自己锁在门外。
     */
    @Transactional
    public AuthDtos.UserResponse unlinkGoogle(long ownerId) {
        User user = requireUser(ownerId);
        if (user.getGoogleSub() == null) {
            return toResponse(user);
        }
        if (user.getPasswordHash() == null) {
            throw ApiException.badRequest("This account signs in with Google only; set a password before unlinking");
        }
        user.setGoogleSub(null);
        return toResponse(users.save(user));
    }

    /**
     * 用 Google 资料补齐/刷新账号：只写展示字段，账号身份始终是 users.id + google_sub。
     * 用户在 App 内自己改过昵称（displayNameCustom）就不覆盖 displayName。
     */
    private void applyGoogleProfile(User user, GoogleTokenVerifier.GoogleIdentity identity) {
        String googleName = Texts.trimToNull(identity.name());
        String picture = Texts.trimToNull(identity.picture());
        if (googleName != null) {
            user.setGoogleName(googleName);
        }
        if (picture != null) {
            user.setAvatarUrl(picture);
        }
        boolean blank = user.getDisplayName() == null || user.getDisplayName().isBlank();
        if (!user.isDisplayNameCustom() && (blank || googleName != null)) {
            if (googleName != null) {
                user.setDisplayName(googleName);
            } else if (blank) {
                user.setDisplayName(emailLocalPart(user.getEmail()));
            }
        }
    }

    /** 展示名优先级：用户自定义昵称 → Google 名称 → 既有 displayName → 邮箱 @ 前段 */
    private static String resolveDisplayName(User user) {
        if (user.isDisplayNameCustom() && hasText(user.getDisplayName())) {
            return user.getDisplayName();
        }
        if (hasText(user.getGoogleName())) {
            return user.getGoogleName();
        }
        if (hasText(user.getDisplayName())) {
            return user.getDisplayName();
        }
        return emailLocalPart(user.getEmail());
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static String emailLocalPart(String email) {
        if (email == null) {
            return "";
        }
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : email;
    }

    private AuthDtos.TokenResponse tokens(User user) {
        AuthPrincipal principal = new AuthPrincipal(user.getId(), user.getEmail(), user.getUserRole(),
                user.getTokenVersion());
        JwtService.TokenPair pair = jwtService.issue(principal);
        return new AuthDtos.TokenResponse("Bearer", pair.accessToken(), pair.refreshToken(),
                pair.expiresInSeconds(), toResponse(user));
    }

    private AuthDtos.UserResponse toResponse(User user) {
        return new AuthDtos.UserResponse(user.getId(), user.getEmail(), resolveDisplayName(user),
                user.getUserRole(), user.getEmailVerifiedAt() != null, user.getCreatedAt(),
                user.getGoogleSub() != null, user.getAvatarUrl());
    }

    private static String normaliseEmail(String email) {
        return Texts.requireNonBlank(email, "email").toLowerCase(Locale.ROOT);
    }
}
