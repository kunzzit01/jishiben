package com.jishiben.api.receipt;

import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
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
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Comparator;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * 凭证图片的 HTTP 契约：上传要登录、读取可匿名、只收三种图片、超 5 MB 是 413、
 * 文件名非法是 400 —— 全部走同一个错误信封。
 */
@WebMvcTest(controllers = ReceiptController.class)
@Import({SecurityConfig.class, RestAuthenticationEntryPoint.class, RestAccessDeniedHandler.class,
        ReceiptControllerTest.FilterHarness.class})
class ReceiptControllerTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";
    private static final int TOKEN_VERSION = 1;
    private static final String PATH_PREFIX = "receipts/";
    private static final Path DIR = createTempDirectory();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private ObjectMapper objectMapper;

    @DynamicPropertySource
    static void receiptsDirectory(DynamicPropertyRegistry registry) {
        registry.add("app.receipts.dir", () -> DIR.toString());
    }

    @AfterAll
    static void removeStoredImages() throws IOException {
        if (!Files.exists(DIR)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(DIR)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // 临时目录清理失败不影响测试结论
                }
            });
        }
    }

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

    @Test
    void anUploadedJpegComesBackAsAPrefixedRelativePath() throws Exception {
        mockMvc.perform(multipart("/api/receipts")
                        .file(new MockMultipartFile("file", "IMG_0001.jpg", "image/jpeg", new byte[] {1, 2, 3}))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.path", matchesPattern(
                        "receipts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg")));
    }

    @Test
    void anUploadWithoutATokenIs401InTheSharedEnvelope() throws Exception {
        mockMvc.perform(multipart("/api/receipts")
                        .file(new MockMultipartFile("file", "IMG_0001.jpg", "image/jpeg", new byte[] {1})))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void aNonImageUploadIsRejected() throws Exception {
        mockMvc.perform(multipart("/api/receipts")
                        .file(new MockMultipartFile("file", "statement.pdf", "application/pdf", new byte[] {1}))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void anImageOverFiveMegabytesIsRejectedWith413() throws Exception {
        byte[] tooBig = new byte[(int) ReceiptController.MAX_IMAGE_BYTES + 1];

        mockMvc.perform(multipart("/api/receipts")
                        .file(new MockMultipartFile("file", "big.jpg", "image/jpeg", tooBig))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken()))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("PAYLOAD_TOO_LARGE"));
    }

    @Test
    void anUploadWithoutTheFilePartIsRejected() throws Exception {
        mockMvc.perform(multipart("/api/receipts")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void aStoredImageIsServedAnonymouslyWithImmutableCaching() throws Exception {
        byte[] image = {(byte) 0x89, 'P', 'N', 'G', 0, 1, 2, 3};
        MvcResult upload = mockMvc.perform(multipart("/api/receipts")
                        .file(new MockMultipartFile("file", "receipt.png", "image/png", image))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken()))
                .andExpect(status().isOk())
                .andReturn();
        String path = objectMapper.readTree(upload.getResponse().getContentAsString()).get("path").asText();
        String name = path.substring(PATH_PREFIX.length());

        // 不带 Authorization：RN 的 <Image> 没法加头，靠随机 UUID 文件名兜住
        mockMvc.perform(get("/api/receipts/{name}", name))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "image/png"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "public, max-age=31536000, immutable"))
                .andExpect(content().bytes(image));
    }

    @Test
    void anIllegalFileNameIs400() throws Exception {
        mockMvc.perform(get("/api/receipts/{name}", "a..b.jpg"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));

        mockMvc.perform(get("/api/receipts/{name}", "receipt image!.jpg"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    @Test
    void anUnknownButWellFormedNameIs404() throws Exception {
        mockMvc.perform(get("/api/receipts/{name}", "no-such-receipt.jpg"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    private String accessToken() {
        return jwtService.issue(new AuthPrincipal(1L, "mingsoon249@gmail.com", "USER", TOKEN_VERSION))
                .accessToken();
    }

    private static Path createTempDirectory() {
        try {
            return Files.createTempDirectory("jishiben-receipts-test");
        } catch (IOException ex) {
            throw new IllegalStateException("Could not create a temp directory for the receipt test", ex);
        }
    }
}
