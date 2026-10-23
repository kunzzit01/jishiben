package com.jishiben.api.security;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jishiben.api.common.GlobalExceptionHandler;
import com.jishiben.api.common.PageResponse;
import com.jishiben.api.transaction.TransactionController;
import com.jishiben.api.transaction.TransactionDtos;
import com.jishiben.api.transaction.TransactionService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * The account a request acts on comes from the security context only. A userId planted in the JSON
 * body is invisible to the application because no DTO has such a field.
 */
@ExtendWith(MockitoExtension.class)
class IdentityFromTokenTest {

    @Mock
    private TransactionService transactions;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new TransactionController(transactions))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void aUserIdInTheBodyIsIgnoredInFavourOfTheToken() throws Exception {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(42L, "a@b.com", "USER", 0), null, List.of()));
        when(transactions.upsert(eq(42L), any())).thenReturn(response());

        mockMvc.perform(put("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "userId": 999,
                                  "clientUid": "tx-1",
                                  "ledgerUid": "led-1",
                                  "assetUid": "acc-1",
                                  "type": "expense",
                                  "amount": 12.50,
                                  "occurredOn": "2024-05-01"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientUid").value("tx-1"));

        verify(transactions).upsert(eq(42L), any());
    }

    @Test
    void readingWithoutATokenIsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/transactions"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void listUsesTheTokenIdentityAsWell() throws Exception {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(7L, "c@d.com", "USER", 0), null, List.of()));
        when(transactions.list(eq(7L), any(), any(), any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(new PageResponse<>(List.of(), 0, 50, 0, 0));

        mockMvc.perform(get("/api/transactions").param("page", "0").param("size", "50"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    private static TransactionDtos.Response response() {
        return new TransactionDtos.Response("tx-1", "led-1", null, "acc-1", null, null, "expense",
                new BigDecimal("12.5000"), "MYR", null, null, null, LocalDate.of(2024, 5, 1), "", null,
                null, Instant.parse("2024-05-01T00:00:00Z"), Instant.parse("2024-05-01T00:00:00Z"));
    }
}
