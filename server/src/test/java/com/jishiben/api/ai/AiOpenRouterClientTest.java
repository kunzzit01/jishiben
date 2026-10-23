package com.jishiben.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Talks to a stub HTTP server instead of OpenRouter: the point is the mapping of upstream answers
 * onto 502/504 and the guarantee that neither the key nor the image bytes can leak into a message.
 */
class AiOpenRouterClientTest {

    private static final String FENCE = "```";
    private static final String TEST_KEY = "sk-or-v1-test-key-that-must-never-leak";
    private static final byte[] IMAGE = new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};

    private HttpServer server;
    private final AtomicReference<String> seenPath = new AtomicReference<>();
    private final AtomicReference<String> seenAuthorization = new AtomicReference<>();

    private AiOpenRouterClient client(String apiKey, int upstreamStatus, String upstreamBody, int delayMs,
                                     int readTimeoutMs) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        // Both provider paths answer the same way: which one was hit is what the tests assert on.
        com.sun.net.httpserver.HttpHandler handler = exchange -> {
            seenPath.set(exchange.getRequestURI().getPath());
            seenAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            exchange.getRequestBody().readAllBytes();
            if (delayMs > 0) {
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
            respond(exchange, upstreamStatus, upstreamBody);
        };
        server.createContext("/chat/completions", handler);
        server.createContext("/audio/transcriptions", handler);
        server.start();
        return new AiOpenRouterClient(new ObjectMapper(), apiKey, "anthropic/claude-sonnet-4.5",
                "http://127.0.0.1:" + server.getAddress().getPort(), 2000, readTimeoutMs, "qwen/voice-stt");
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        } else {
            exchange.close();
        }
    }

    private static String upstreamAnswer(String modelText) throws IOException {
        Map<String, Object> body = Map.of(
                "choices", java.util.List.of(Map.of("message", Map.of("content", modelText))));
        return new ObjectMapper().writeValueAsString(body);
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void anUnconfiguredServerAnswers503WithItsOwnCode() {
        AiOpenRouterClient unconfigured = new AiOpenRouterClient(new ObjectMapper(), "  ", "m",
                "https://openrouter.ai/api/v1", 1000, 1000, "qwen/voice-stt");

        assertThat(unconfigured.isConfigured()).isFalse();
        assertThatThrownBy(() -> unconfigured.scan("image/png", "AQ==", 1))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("AI_NOT_CONFIGURED", org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE);
        // The voice endpoint degrades exactly the same way: 503 before any audio leaves the server.
        assertThatThrownBy(() -> unconfigured.parseVoice("m4a", "AQ==", 1))
                .isInstanceOf(AiApiException.class)
                .hasMessageContaining("Voice parsing")
                .extracting("code", "status")
                .containsExactly("AI_NOT_CONFIGURED", org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE);
    }

    @Test
    void aModelAnswerIsParsedIntoTheAppContract() throws Exception {
        String modelText = FENCE + "json\n{\"amount\": 12.34, \"merchant\": \"星巴克\", \"date\": \"2025-03-01\","
                + " \"type\": \"income\", \"suggestedCategory\": \"兼职\"}\n" + FENCE;
        AiOpenRouterClient configured = client(TEST_KEY, 200, upstreamAnswer(modelText), 0, 5000);

        AiReceiptDtos.ReceiptScanResponse response =
                configured.scan("image/png", java.util.Base64.getEncoder().encodeToString(IMAGE), IMAGE.length);

        assertThat(response.amount()).isEqualByComparingTo("12.34");
        assertThat(response.merchant()).isEqualTo("星巴克");
        assertThat(response.date()).isEqualTo(java.time.LocalDate.of(2025, 3, 1));
        assertThat(response.type()).isEqualTo("income");
        assertThat(response.suggestedCategory()).isEqualTo("兼职");
        // The request really went to the provider's chat-completions path, carrying the bearer key.
        assertThat(seenPath.get()).isEqualTo("/chat/completions");
        assertThat(seenAuthorization.get()).isEqualTo("Bearer " + TEST_KEY);
    }

    @Test
    void anUnknownFieldComesBackAsNullInsteadOfBreakingTheContract() throws Exception {
        AiOpenRouterClient configured = client(TEST_KEY, 200,
                upstreamAnswer("{\"amount\": null, \"merchant\": \"\", \"date\": \"not-a-date\"}"), 0, 5000);

        AiReceiptDtos.ReceiptScanResponse response = configured.scan("image/png", "AQ==", 1);

        assertThat(response.amount()).isNull();
        assertThat(response.merchant()).isNull();
        assertThat(response.date()).isNull();
        assertThat(response.type()).isEqualTo("expense");
        assertThat(response.suggestedCategory()).isNull();
    }

    @Test
    void anUpstreamErrorBecomes502WithoutEchoingTheKey() throws Exception {
        AiOpenRouterClient configured = client(TEST_KEY, 401,
                "{\"error\":{\"message\":\"No auth credentials found for " + TEST_KEY + "\"}}", 0, 5000);

        assertThatThrownBy(() -> configured.scan("image/png", "AQ==", 1))
                .isInstanceOf(AiApiException.class)
                .hasMessageNotContaining(TEST_KEY)
                .hasMessageNotContaining("AQ==")
                .hasMessageContaining("401")
                .extracting("code", "status")
                .containsExactly("AI_UPSTREAM_ERROR", org.springframework.http.HttpStatus.BAD_GATEWAY);
    }

    @Test
    void anUnreadableUpstreamPayloadBecomes502() throws Exception {
        AiOpenRouterClient configured = client(TEST_KEY, 200,
                "{\"choices\":[{\"message\":{\"content\":\"sorry, I cannot read this\"}}]}", 0, 5000);

        assertThatThrownBy(() -> configured.scan("image/png", "AQ==", 1))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("AI_UPSTREAM_ERROR", org.springframework.http.HttpStatus.BAD_GATEWAY);
    }

    @Test
    void aSlowProviderBecomes504() throws Exception {
        AiOpenRouterClient slow = client(TEST_KEY, 200, "{}", 1500, 300);

        assertThatThrownBy(() -> slow.scan("image/png", "AQ==", 1))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("AI_UPSTREAM_TIMEOUT", org.springframework.http.HttpStatus.GATEWAY_TIMEOUT);
    }

    @Test
    void voiceParseTranscribesThenParsesInTwoUpstreamCalls() throws Exception {
        List<String> paths = Collections.synchronizedList(new ArrayList<>());
        AtomicReference<String> sttAuthorization = new AtomicReference<>();
        AtomicReference<String> sttModel = new AtomicReference<>();
        AtomicReference<String> chatBody = new AtomicReference<>();

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/audio/transcriptions", exchange -> {
            paths.add(exchange.getRequestURI().getPath());
            sttAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            sttModel.set(jsonField(exchange, "model"));
            respond(exchange, 200, "{\"text\":\"今天午饭花了35块，在麦当劳\"}");
        });
        server.createContext("/chat/completions", exchange -> {
            paths.add(exchange.getRequestURI().getPath());
            chatBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, upstreamAnswer("{\"amount\": 35, \"merchant\": \"麦当劳\", \"date\": \"2025-03-01\","
                    + " \"type\": \"expense\", \"suggestedCategory\": \"餐饮\", \"note\": \"麦当劳午饭\"}"));
        });
        server.start();
        AiOpenRouterClient configured = new AiOpenRouterClient(new ObjectMapper(), TEST_KEY,
                "anthropic/claude-sonnet-4.5", "http://127.0.0.1:" + server.getAddress().getPort(),
                2000, 5000, "qwen/voice-stt");

        AiVoiceDtos.VoiceParseResponse response = configured.parseVoice("m4a", "AQ==", 1);

        assertThat(response.amount()).isEqualByComparingTo("35");
        assertThat(response.merchant()).isEqualTo("麦当劳");
        assertThat(response.date()).isEqualTo(java.time.LocalDate.of(2025, 3, 1));
        assertThat(response.type()).isEqualTo("expense");
        assertThat(response.suggestedCategory()).isEqualTo("餐饮");
        assertThat(response.note()).isEqualTo("麦当劳午饭");
        assertThat(response.transcript()).isEqualTo("今天午饭花了35块，在麦当劳");
        // Step one is the transcription endpoint, step two is chat-completions carrying that transcript.
        assertThat(paths).containsExactly("/audio/transcriptions", "/chat/completions");
        assertThat(sttAuthorization.get()).isEqualTo("Bearer " + TEST_KEY);
        assertThat(sttModel.get()).isEqualTo("qwen/voice-stt");
        assertThat(chatBody.get()).contains("今天午饭花了35块，在麦当劳");
    }

    @Test
    void aTranscriptionWithoutTextBecomes502() throws Exception {
        AiOpenRouterClient configured = client(TEST_KEY, 200, upstreamAnswer("no speech here"), 0, 5000);

        assertThatThrownBy(() -> configured.parseVoice("m4a", "AQ==", 1))
                .isInstanceOf(AiApiException.class)
                .hasMessageNotContaining(TEST_KEY)
                .extracting("code", "status")
                .containsExactly("AI_UPSTREAM_ERROR", org.springframework.http.HttpStatus.BAD_GATEWAY);
    }

    @Test
    void aFailedTranscriptionBecomes502WithoutEchoingTheAudio() throws Exception {
        String audio = "YXVkaW8tYnl0ZXMtdGhhdC1tdXN0LW5vdC1sZWFr";
        AiOpenRouterClient configured = client(TEST_KEY, 401,
                "{\"error\":{\"message\":\"bad audio " + audio + " / key " + TEST_KEY + "\"}}", 0, 5000);

        assertThatThrownBy(() -> configured.parseVoice("m4a", audio, 1))
                .isInstanceOf(AiApiException.class)
                .hasMessageNotContaining(TEST_KEY)
                .hasMessageNotContaining(audio)
                .hasMessageContaining("401")
                .extracting("code", "status")
                .containsExactly("AI_UPSTREAM_ERROR", org.springframework.http.HttpStatus.BAD_GATEWAY);
    }

    @Test
    void aSlowTranscriptionBecomes504() throws Exception {
        AiOpenRouterClient slow = client(TEST_KEY, 200, "{\"text\":\"hi\"}", 1500, 300);

        assertThatThrownBy(() -> slow.parseVoice("m4a", "AQ==", 1))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("AI_UPSTREAM_TIMEOUT", org.springframework.http.HttpStatus.GATEWAY_TIMEOUT);
    }

    /** Reads one top-level string field out of the JSON request body (never used to echo anything). */
    private static String jsonField(HttpExchange exchange, String field) throws IOException {
        byte[] body = exchange.getRequestBody().readAllBytes();
        return new ObjectMapper().readTree(body).path(field).asText("");
    }
}
