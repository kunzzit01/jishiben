package com.jishiben.api.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jishiben.api.common.ApiException;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PushTokenServiceTest {

    private static final String TOKEN = "ExponentPushToken[abcdefghijk]";

    @Mock
    private PushTokenRepository tokens;

    private PushTokenService service() {
        return new PushTokenService(tokens);
    }

    @Test
    void reRegisteringADeviceMovesTheTokenToTheCurrentAccount() {
        PushToken existing = new PushToken();
        existing.setOwnerId(2L);
        existing.setToken(TOKEN);
        when(tokens.findByToken(TOKEN)).thenReturn(Optional.of(existing));
        when(tokens.save(any(PushToken.class))).thenAnswer(invocation -> invocation.getArgument(0));

        PushDtos.Response response = service().register(1L, new PushDtos.RegisterRequest(TOKEN, "ios"));

        assertThat(response.token()).isEqualTo(TOKEN);
        assertThat(response.platform()).isEqualTo("ios");
        assertThat(existing.getOwnerId()).isEqualTo(1L);
        assertThat(existing.getLastSeenAt()).isNotNull();
    }

    @Test
    void rejectsSomethingThatIsNotAnExpoToken() {
        assertThatThrownBy(() -> service().register(1L, new PushDtos.RegisterRequest("not-a-token", "ios")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Expo push token");
    }

    @Test
    void rejectsAnUnknownPlatform() {
        assertThatThrownBy(() -> service().register(1L, new PushDtos.RegisterRequest(TOKEN, "windows")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("platform");
    }

    @Test
    void unregisterIsScopedToTheCaller() {
        service().unregister(1L, new PushDtos.UnregisterRequest(TOKEN));

        verify(tokens).deleteByOwnerIdAndToken(1L, TOKEN);
    }
}
