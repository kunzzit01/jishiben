package com.jishiben.api.health;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * Standalone MockMvc on purpose: no Spring context, no datasource, so the test suite stays runnable
 * on a machine without MySQL.
 */
class HealthControllerTest {

    private final MockMvc mockMvc = MockMvcBuilders
            .standaloneSetup(new HealthController("jishiben-api"))
            .build();

    @Test
    void healthReturnsOkWithoutDatabase() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.app").value("jishiben-api"));
    }
}
