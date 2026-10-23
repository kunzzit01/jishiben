package com.jishiben.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.profile.ProfileService;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.security.JwtService;
import com.jishiben.api.user.User;
import com.jishiben.api.user.UserRepository;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    private final PasswordEncoder encoder = new BCryptPasswordEncoder(4);
    private final JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef", "jishiben-api",
            Duration.ofHours(1), Duration.ofDays(30));

    @Mock
    private UserRepository users;
    @Mock
    private ProfileService profiles;

    private AuthService service() {
        return new AuthService(users, encoder, jwt, profiles);
    }

    @Test
    void registerHashesThePasswordAndNormalisesTheEmail() {
        when(users.existsByEmailIgnoreCase("a@b.com")).thenReturn(false);
        when(users.save(any(User.class))).thenAnswer(invocation -> {
            User saved = invocation.getArgument(0);
            saved.setId(11L);
            return saved;
        });

        AuthDtos.TokenResponse response = service().register(
                new AuthDtos.RegisterRequest("  A@B.com ", "s3cret-pass", "Alex"));

        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(users).save(captor.capture());
        User saved = captor.getValue();
        assertThat(saved.getEmail()).isEqualTo("a@b.com");
        assertThat(saved.getPasswordHash()).isNotEqualTo("s3cret-pass").startsWith("$2");
        assertThat(encoder.matches("s3cret-pass", saved.getPasswordHash())).isTrue();
        assertThat(saved.getTokenVersion()).isZero();
        verify(profiles).ensure(11L);
        assertThat(response.user().id()).isEqualTo(11L);
        assertThat(response.accessToken()).isNotBlank();
        assertThat(jwt.principal(jwt.parseAccess(response.accessToken())).id()).isEqualTo(11L);
    }

    @Test
    void registerRefusesAnExistingEmail() {
        when(users.existsByEmailIgnoreCase("a@b.com")).thenReturn(true);

        assertThatThrownBy(() -> service().register(new AuthDtos.RegisterRequest("a@b.com", "s3cret-pass", null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("already registered");
    }

    @Test
    void loginGivesTheSameErrorForUnknownEmailAndWrongPassword() {
        User user = user(5L, "a@b.com", "right-password", 0);
        when(users.findByEmailIgnoreCase("a@b.com")).thenReturn(Optional.of(user));
        when(users.findByEmailIgnoreCase("nobody@b.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service().login(new AuthDtos.LoginRequest("nobody@b.com", "x")))
                .isInstanceOf(ApiException.class)
                .extracting("code").isEqualTo(ErrorCode.INVALID_CREDENTIALS);
        assertThatThrownBy(() -> service().login(new AuthDtos.LoginRequest("a@b.com", "wrong")))
                .isInstanceOf(ApiException.class)
                .extracting("code").isEqualTo(ErrorCode.INVALID_CREDENTIALS);
    }

    @Test
    void loginSucceedsAndIssuesTokensCarryingTheCurrentVersion() {
        User user = user(5L, "a@b.com", "right-password", 2);
        when(users.findByEmailIgnoreCase("a@b.com")).thenReturn(Optional.of(user));
        when(users.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        AuthDtos.TokenResponse response = service().login(new AuthDtos.LoginRequest("a@b.com", "right-password"));

        assertThat(response.user().email()).isEqualTo("a@b.com");
        assertThat(jwt.principal(jwt.parseAccess(response.accessToken())).tokenVersion()).isEqualTo(2);
    }

    @Test
    void refreshRejectsATokenOlderThanTheStoredVersion() {
        AuthPrincipal stale = new AuthPrincipal(5L, "a@b.com", "USER", 0);
        String refresh = jwt.issue(stale).refreshToken();
        when(users.findById(5L)).thenReturn(Optional.of(user(5L, "a@b.com", "pw", 1)));

        assertThatThrownBy(() -> service().refresh(new AuthDtos.RefreshRequest(refresh)))
                .isInstanceOf(ApiException.class)
                .extracting("code").isEqualTo(ErrorCode.TOKEN_REVOKED);
    }

    @Test
    void changingThePasswordBumpsTheVersionAndInvalidatesOldTokens() {
        User user = user(5L, "a@b.com", "old-password", 0);
        when(users.findById(5L)).thenReturn(Optional.of(user));
        when(users.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        AuthDtos.TokenResponse response = service().changePassword(5L,
                new AuthDtos.ChangePasswordRequest("old-password", "new-password-1"));

        assertThat(user.getTokenVersion()).isEqualTo(1);
        assertThat(encoder.matches("new-password-1", user.getPasswordHash())).isTrue();
        assertThat(jwt.principal(jwt.parseAccess(response.accessToken())).tokenVersion()).isEqualTo(1);
    }

    @Test
    void changingThePasswordRequiresTheCurrentOne() {
        when(users.findById(5L)).thenReturn(Optional.of(user(5L, "a@b.com", "old-password", 0)));

        assertThatThrownBy(() -> service().changePassword(5L,
                new AuthDtos.ChangePasswordRequest("not-it", "new-password-1")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Current password is incorrect");
    }

    private User user(long id, String email, String rawPassword, int tokenVersion) {
        User user = new User();
        user.setId(id);
        user.setEmail(email);
        user.setPasswordHash(encoder.encode(rawPassword));
        user.setUserRole("USER");
        user.setTokenVersion(tokenVersion);
        return user;
    }
}
