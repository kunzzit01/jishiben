package com.jishiben.api.ai;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jishiben.api.config.SecurityConfig;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.security.JwtAuthenticationFilter;
import com.jishiben.api.security.JwtService;
import com.jishiben.api.security.RestAccessDeniedHandler;
import com.jishiben.api.security.RestAuthenticationEntryPoint;
import com.jishiben.api.security.TokenVersionSource;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Same harness as the receipt-scan controller test, on purpose: /api/ai/voice-parse must sit behind
 * the identical JWT gate and answer with the shared error envelope and the same AI codes.
 */
@WebMvcTest(controllers = AiVoiceParseController.class)
@Import({AiVoiceService.class, SecurityConfig.class, RestAuthenticationEntryPoint.class,
        RestAccessDeniedHandler.class, AiVoiceParseControllerTest.FilterHarness.class})
@TestPropertySource(properties = "app.ai.voice-parse.max-audio-bytes=1024")
class AiVoiceParseControllerTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";
    private static final int TOKEN_VERSION = 1;
    private static final int MAX_BYTES = 1024;
    private static final String AUDIO = Base64.getEncoder().encodeToString(new byte[16]);

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @MockBean
    private AiOpenRouterClient client;

    @TestConfiguration
    static class FilterHarness {

        @Bean
        JwtService jwtService() {
            return new JwtService(SECRET, "jishiben-api", Duration.ofHours(1), Duration.ofDays(1));
        }

        @Bean
        TokenVersionSource tokenVersionSource() {
            return accountId -> TOKEN_VERSION;
        }

        @Bean
        JwtAuthenticationFilter jwtAuthenticationFilter(JwtService jwtService,
                                                        TokenVersionSource tokenVersions,
                                                        ObjectMapper objectMapper) {
            return new JwtAuthenticationFilter(jwtService, tokenVersions, objectMapper);
        }
    }

    private String accessToken() {
        return jwtService.issue(new AuthPrincipal(1L, "mingsoon249@gmail.com", "USER", TOKEN_VERSION))
                .accessToken();
    }

    private static String body(String audioBase64, String format) {
        return "{\"audioBase64\":\"" + audioBase64 + "\",\"format\":\"" + format + "\"}";
    }

    @Test
    void aRequestWithoutATokenIs401InTheSharedEnvelope() throws Exception {
        mockMvc.perform(post("/api/ai/voice-parse")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(AUDIO, "m4a")))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.status").value(401));
    }

    @Test
    void aRequestWithAnInvalidTokenIs401() throws Exception {
        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer not-a-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(AUDIO, "m4a")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aSpokenSentenceComesBackAsTheAppContract() throws Exception {
        when(client.parseVoice(anyString(), anyString(), anyInt()))
                .thenReturn(new AiVoiceDtos.VoiceParseResponse(new BigDecimal("35"), "麦当劳",
                        LocalDate.of(2025, 3, 1), "expense", "餐饮", "麦当劳午饭", "今天午饭花了35块，在麦当劳"));

        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(AUDIO, "m4a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.amount").value(35))
                .andExpect(jsonPath("$.merchant").value("麦当劳"))
                .andExpect(jsonPath("$.date").value("2025-03-01"))
                .andExpect(jsonPath("$.type").value("expense"))
                .andExpect(jsonPath("$.suggestedCategory").value("餐饮"))
                .andExpect(jsonPath("$.note").value("麦当劳午饭"))
                .andExpect(jsonPath("$.transcript").value("今天午饭花了35块，在麦当劳"));
    }

    @Test
    void aServerWithoutAnAiKeyAnswers503WithItsOwnCode() throws Exception {
        when(client.parseVoice(anyString(), anyString(), anyInt()))
                .thenThrow(AiApiException.notConfigured("Voice parsing"));

        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(AUDIO, "m4a")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("AI_NOT_CONFIGURED"))
                .andExpect(jsonPath("$.status").value(503));
    }

    @Test
    void anUpstreamFailureAnswers502() throws Exception {
        when(client.parseVoice(anyString(), anyString(), anyInt()))
                .thenThrow(AiApiException.upstream("Voice transcription provider rejected the request (status 401)"));

        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(AUDIO, "m4a")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("AI_UPSTREAM_ERROR"));
    }

    @Test
    void aSlowUpstreamAnswers504() throws Exception {
        when(client.parseVoice(anyString(), anyString(), anyInt()))
                .thenThrow(AiApiException.upstreamTimeout("Voice transcription provider did not answer in time"));

        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(AUDIO, "m4a")))
                .andExpect(status().isGatewayTimeout())
                .andExpect(jsonPath("$.code").value("AI_UPSTREAM_TIMEOUT"));
    }

    @Test
    void aRecordingOverTheCeilingAnswers413() throws Exception {
        String tooBig = "A".repeat(MAX_BYTES * 2);

        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(tooBig, "m4a")))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("PAYLOAD_TOO_LARGE"));
    }

    @Test
    void anUnsupportedFormatAnswers400() throws Exception {
        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(AUDIO, "exe")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void anEmptyBodyAnswers400() throws Exception {
        mockMvc.perform(post("/api/ai/voice-parse")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
}
