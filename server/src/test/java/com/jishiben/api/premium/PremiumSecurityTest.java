package com.jishiben.api.premium;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.config.SecurityConfig;
import com.jishiben.api.security.*;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers={PremiumController.class,PremiumAdminController.class,GoogleBillingController.class})
@Import({SecurityConfig.class,RestAuthenticationEntryPoint.class,RestAccessDeniedHandler.class,PremiumSecurityTest.Harness.class})
class PremiumSecurityTest {
    @Autowired MockMvc mvc;
    @MockBean PremiumService premium;
    @MockBean GoogleBillingService google;
    @TestConfiguration static class Harness {
        @Bean JwtService jwtService() { return new JwtService("0123456789abcdef0123456789abcdef","test",Duration.ofHours(1),Duration.ofDays(1)); }
        @Bean TokenVersionSource versions() { return id -> 0; }
        @Bean JwtAuthenticationFilter filter(JwtService jwt,TokenVersionSource versions,ObjectMapper mapper) { return new JwtAuthenticationFilter(jwt,versions,mapper); }
    }
    @Test void guestAccessDoesNotOpenAccountOrAdministrativeEndpoints() throws Exception {
        mvc.perform(get("/api/admin/premium")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/premium/claim").contentType(MediaType.APPLICATION_JSON).content("{\"token\":\""+"x".repeat(72)+"\"}")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/transactions").header("X-Premium-Guest-Token","x".repeat(72))).andExpect(status().isUnauthorized());
    }
    @Test void pubSubUsesItsOwnVerifierRatherThanTheApplicationJwtParser() throws Exception {
        doThrow(ApiException.unauthorized("Invalid push identity")).when(google).notification(anyString(),any());
        mvc.perform(post("/api/premium/google/notifications").servletPath("/api/premium/google/notifications")
                .header("Authorization","Bearer google-oidc-token").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.message").value("Invalid push identity"));
        verify(google).notification(eq("Bearer google-oidc-token"),any());
    }
    @Test void scansRemainOpenBeforeEnforcementIsEnabled() throws Exception {
        when(premium.settings()).thenReturn(new PremiumDtos.Settings(false,false,false));
        mvc.perform(get("/api/premium/access/scan")).andExpect(status().isNoContent());
    }
    @Test void gatedScanCannotBeUsedWithoutABillingIdentity() throws Exception {
        when(premium.settings()).thenReturn(new PremiumDtos.Settings(true,true,true));
        when(premium.status(isNull())).thenThrow(ApiException.unauthorized("Billing identity required"));
        mvc.perform(get("/api/premium/access/scan")).andExpect(status().isUnauthorized());
    }
}
