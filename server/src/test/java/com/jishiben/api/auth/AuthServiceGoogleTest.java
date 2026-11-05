package com.jishiben.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.profile.ProfileService;
import com.jishiben.api.security.JwtService;
import com.jishiben.api.user.User;
import com.jishiben.api.user.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Google 登录的服务端行为：只测「谁能进来 / 谁必须先去绑定」这类规则，
 * 真实 Token 校验交给 Google 库，这里用替身（不依赖外网）。
 */
class AuthServiceGoogleTest {

    private UserRepository users;
    private GoogleTokenVerifier verifier;
    private ProfileService profiles;
    private JwtService jwt;
    private PasswordEncoder encoder;
    private AuthService service;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
        verifier = mock(GoogleTokenVerifier.class);
        profiles = mock(ProfileService.class);
        jwt = mock(JwtService.class);
        encoder = new BCryptPasswordEncoder();
        service = new AuthService(users, encoder, jwt, profiles, verifier);
    }

    private GoogleTokenVerifier.GoogleIdentity identity(String sub, String email) {
        return new GoogleTokenVerifier.GoogleIdentity(sub, email, true, "顺 铭", "https://example.test/a.png");
    }

    @Test
    void newGoogleUserCreatesAccountWithoutPassword() {
        when(verifier.verify("t")).thenReturn(identity("sub-1", "new@x.com"));
        when(users.findByGoogleSub("sub-1")).thenReturn(Optional.empty());
        when(users.existsByEmailIgnoreCase("new@x.com")).thenReturn(false);
        // save() 之后代码会读 id/email/role：用带 id 的替身代表「已落库的用户」
        User saved = mock(User.class);
        when(saved.getId()).thenReturn(1L);
        when(saved.getEmail()).thenReturn("new@x.com");
        when(saved.getUserRole()).thenReturn("USER");
        when(saved.getTokenVersion()).thenReturn(0);
        when(users.save(any(User.class))).thenReturn(saved);
        when(jwt.issue(any())).thenReturn(new JwtService.TokenPair("access", "refresh", 86400L));

        AuthDtos.TokenResponse res = service.loginWithGoogle(new AuthDtos.GoogleLoginRequest("t"));

        assertThat(res).isNotNull();
        assertThat(res.user().email()).isEqualTo("new@x.com");
    }

    @Test
    void existingEmailIsAutoLinkedAndLoggedIn() {
        when(verifier.verify("t")).thenReturn(identity("sub-9", "old@x.com"));
        when(users.findByGoogleSub("sub-9")).thenReturn(Optional.empty());

        User existing = mock(User.class);
        when(existing.getId()).thenReturn(7L);
        when(existing.getEmail()).thenReturn("old@x.com");
        when(existing.getUserRole()).thenReturn("USER");
        when(existing.getTokenVersion()).thenReturn(0);
        when(existing.getGoogleSub()).thenReturn(null);
        when(users.findByEmailIgnoreCase("old@x.com")).thenReturn(Optional.of(existing));
        when(users.save(any(User.class))).thenReturn(existing);
        when(jwt.issue(any())).thenReturn(new JwtService.TokenPair("access", "refresh", 86400L));

        AuthDtos.TokenResponse res = service.loginWithGoogle(new AuthDtos.GoogleLoginRequest("t"));

        assertThat(res).isNotNull();
        // 产品决定：把 google_sub 绑到已有账号上，而不是发一个 GOOGLE_LINK_REQUIRED
        verify(existing).setGoogleSub("sub-9");
    }
    @Test
    void signupWithExistingAccountIsRejected() {
        when(verifier.verify("t")).thenReturn(identity("sub-11", "taken@x.com"));
        User bound = mock(User.class);
        when(users.findByGoogleSub("sub-11")).thenReturn(Optional.of(bound));

        assertThatThrownBy(() -> service.loginWithGoogle(new AuthDtos.GoogleLoginRequest("t", "signup")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).code())
                        .isEqualTo(ErrorCode.GOOGLE_ALREADY_REGISTERED));
    }
    @Test
    void unverifiedEmailIsRejected() {
        when(verifier.verify("t"))
                .thenReturn(new GoogleTokenVerifier.GoogleIdentity("sub-3", "x@x.com", false, null, null));

        assertThatThrownBy(() -> service.loginWithGoogle(new AuthDtos.GoogleLoginRequest("t")))
                .isInstanceOf(ApiException.class);
    }
}
