package com.jishiben.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Money must reach the client as a plain decimal number, never in scientific notation. */
class MoneyJsonTest {

    @Test
    void bigDecimalsSerializeAsPlainNumbers() throws Exception {
        Jackson2ObjectMapperBuilderCustomizer customizer = new JacksonConfig().moneySerializationCustomizer();
        var builder = new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder();
        customizer.customize(builder);
        ObjectMapper mapper = builder.build();

        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new MoneyController())
                .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper))
                .build();

        MvcResult result = mockMvc.perform(get("/money")).andExpect(status().isOk()).andReturn();

        String body = result.getResponse().getContentAsString();
        assertThat(body).contains("\"big\":1000000000000");
        assertThat(body).contains("\"small\":19.9900");
        assertThat(body).doesNotContain("E+").doesNotContain("E1");
    }

    @RestController
    static class MoneyController {

        @GetMapping("/money")
        Money money() {
            return new Money(new BigDecimal("1000000000000"), new BigDecimal("19.9900"));
        }
    }

    record Money(BigDecimal big, BigDecimal small) {
    }
}
