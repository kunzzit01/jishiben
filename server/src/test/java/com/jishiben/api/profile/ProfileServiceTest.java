package com.jishiben.api.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.ledger.LedgerRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ProfileServiceTest {

    @Mock
    private ProfileRepository profiles;
    @Mock
    private LedgerRepository ledgers;

    private ProfileService service() {
        return new ProfileService(profiles, ledgers);
    }

    private void stubExistingProfile() {
        Profile profile = new Profile();
        profile.setOwnerId(1L);
        when(profiles.findByOwnerId(1L)).thenReturn(Optional.of(profile));
        when(profiles.save(any(Profile.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    /** Every value of the app's own DateFormat union must be storable, YYYY-MM-DD included. */
    @Test
    void everyDateFormatTheAppOffersIsAccepted() {
        for (String format : new String[] {"YYYY/MM/DD", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"}) {
            stubExistingProfile();
            ProfileDtos.Response response = service().update(1L, new ProfileDtos.UpdateRequest(
                    null, null, format, null, null, null, null));
            assertThat(response.dateFormat()).isEqualTo(format);
        }
    }

    @Test
    void lowercaseDateFormatIsNormalisedToUpper() {
        stubExistingProfile();
        ProfileDtos.Response response = service().update(1L, new ProfileDtos.UpdateRequest(
                null, null, "yyyy-mm-dd", null, null, null, null));
        assertThat(response.dateFormat()).isEqualTo("YYYY-MM-DD");
    }

    @Test
    void anUnknownDateFormatIsStillRejected() {
        Profile profile = new Profile();
        profile.setOwnerId(1L);
        when(profiles.findByOwnerId(1L)).thenReturn(Optional.of(profile));
        assertThatThrownBy(() -> service().update(1L, new ProfileDtos.UpdateRequest(
                null, null, "DD.MM.YYYY", null, null, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("dateFormat must be one of");
    }
}
