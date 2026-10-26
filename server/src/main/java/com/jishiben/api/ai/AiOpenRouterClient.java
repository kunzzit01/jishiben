package com.jishiben.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * The only place that talks to OpenRouter. The key lives exclusively in the server environment:
 * absent key = 503 (never a crash), upstream failures travel back as 502/504 with a status code
 * only, and neither the key nor the image bytes are ever logged or echoed.
 */
@Component
public class AiOpenRouterClient {

    private static final Logger log = LoggerFactory.getLogger(AiOpenRouterClient.class);
    private static final String FENCE = "```";

    private static final String PROMPT = """
            你是一个记账助手。请识别这张照片（可能是消费小票/收据，也可能是工资单、转账/收款截图等收入凭证），提取以下信息，只返回JSON，不要输出任何其他文字、不要用markdown代码块包裹：
            {
              "amount": 总金额的数字（不含货币符号，识别不到则为null）,
              "merchant": 商家或收款/付款方名称（识别不到则为null）,
              "date": "凭证上的日期，格式YYYY-MM-DD，识别不到则用null",
              "type": "判断这张图片记录的是一笔支出还是收入，只能是 expense 或 income 两个值之一，看不出来就用expense",
              "suggestedCategory": "如果type是expense，从这些分类里选一个最合适的中文名称：餐饮、购物、日用、交通、蔬菜、水果、零食、运动、娱乐、通讯、服饰、美容、住房、居家、数码、汽车、医疗、书籍、其他；如果type是income，从这些分类里选一个最合适的中文名称：工资、奖金、兼职、理财、红包、其他收入"
            }""";

    /** Step two of the voice path: turns the transcript into accounting fields. */
    private static final String VOICE_PROMPT = """
            你是一个中文个人记账助手。
            用户会说一句或几句自然语言，例如：
            “今天午饭花了35块，在麦当劳”
            “昨天收到工资5000”
            “8月30号买衣服花了199块”

            请从用户说的话中提取记账信息，只返回JSON，不要输出任何其他文字，不要使用markdown代码块：
            {
              "amount": 数字，不含货币符号，识别不到则为null,
              "merchant": 商家、付款方或收款方，识别不到则为null,
              "date": 日期，格式YYYY-MM-DD；如果用户没有说日期则使用今天的日期；无法判断则为null,
              "type": 只能是 expense 或 income；没有明确说明时默认expense,
              "suggestedCategory": 如果type是expense，从这些分类里选择最合适的一个：餐饮、购物、日用、交通、蔬菜、水果、零食、运动、娱乐、通讯、服饰、美容、住房、居家、数码、汽车、医疗、书籍、其他；如果type是income，从这些分类里选择最合适的一个：工资、奖金、兼职、理财、红包、其他收入,
              "note": 简短备注；如果merchant存在，可以优先使用商家名；否则根据原话生成简短备注；没有则null
            }""";

    private final String apiKey;
    private final String model;
    private final String sttModel;
    private final ObjectMapper objectMapper;
    private final RestClient client;
    private final int timeoutMs;
    /**
     * 单次调用的输出上限。
     * 免费视觉模型（如 nvidia/nemotron-3.5-super-vl:free）都是推理型：会先消耗上千个
     * reasoning token 才输出正文。上游默认预算太小会导致 content 为空、JSON 解析失败，
     * 表现为「配了 key 也用不了」。这里给足默认值并允许用环境变量覆盖。
     */
    private final int maxTokens;

    public AiOpenRouterClient(
            ObjectMapper objectMapper,
            @Value("${app.ai.openrouter.api-key:}") String apiKey,
            @Value("${app.ai.openrouter.model:anthropic/claude-sonnet-4.5}") String model,
            @Value("${app.ai.openrouter.base-url:https://openrouter.ai/api/v1}") String baseUrl,
            @Value("${app.ai.openrouter.connect-timeout-ms:5000}") int connectTimeoutMs,
            @Value("${app.ai.receipt-scan.timeout-ms:30000}") int timeoutMs,
            @Value("${app.ai.voice-parse.stt-model:qwen/qwen3-asr-flash-2026-02-10}") String sttModel,
            @Value("${app.ai.openrouter.max-tokens:2048}") int maxTokens) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.model = model == null || model.isBlank() ? "anthropic/claude-sonnet-4.5" : model.trim();
        this.sttModel = sttModel == null || sttModel.isBlank()
                ? "qwen/qwen3-asr-flash-2026-02-10"
                : sttModel.trim();
        this.objectMapper = objectMapper;
        this.timeoutMs = timeoutMs;
        this.maxTokens = maxTokens > 0 ? maxTokens : 2048;
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.client = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    public boolean isConfigured() {
        return !apiKey.isEmpty();
    }

    /**
     * Sends one receipt image and maps the model answer onto the app contract.
     *
     * @param mimeType  sniffed MIME type, used only to build the data URL
     * @param base64    compact base64 of that image (already validated and size-capped)
     * @param imageBytes decoded length, logged instead of any image content
     */
    public AiReceiptDtos.ReceiptScanResponse scan(String mimeType, String base64, int imageBytes) {
        if (!isConfigured()) {
            throw AiApiException.notConfigured();
        }
        // Length only: the key and the image bytes must never reach a log line.
        log.info("AI receipt scan: model={} mime={} bytes={}", model, mimeType, imageBytes);

        Map<String, Object> body = Map.of(
                "model", model,
                "temperature", 0,
                "max_tokens", maxTokens,
                "messages", List.of(Map.of(
                        "role", "user",
                        "content", List.of(
                                Map.of("type", "text", "text", PROMPT),
                                Map.of("type", "image_url", "image_url",
                                        Map.of("url", "data:" + mimeType + ";base64," + base64))))));
        return parse(post("/chat/completions", body, "Receipt scanning"));
    }

    /**
     * One authenticated provider call. The upstream error body is dropped on purpose, so only a
     * status code or an exception class name can ever reach a log line or the client.
     */
    private String post(String path, Map<String, Object> body, String label) {
        try {
            return client.post()
                    .uri(path)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientResponseException ex) {
            int upstreamStatus = ex.getStatusCode().value();
            log.warn("{} rejected by the provider with status {}", label, upstreamStatus);
            throw AiApiException.upstream(
                    label + " provider rejected the request (status " + upstreamStatus + ")");
        } catch (ResourceAccessException ex) {
            if (isTimeout(ex)) {
                log.warn("{} timed out after {} ms", label, timeoutMs);
                throw AiApiException.upstreamTimeout(label + " provider did not answer in time");
            }
            log.warn("{} transport failure: {}", label, ex.getClass().getSimpleName());
            throw AiApiException.upstream(label + " provider is unreachable");
        } catch (RestClientException ex) {
            log.warn("{} call failed: {}", label, ex.getClass().getSimpleName());
            throw AiApiException.upstream(label + " provider is unavailable");
        }
    }

    /**
     * The whole voice path in one server call: speech to text, then the accounting parse. The app
     * sends audio and gets accounting fields back, so neither the key nor the provider name ever
     * reaches the device.
     *
     * @param format     allow-listed audio container (m4a/wav/...), forwarded to the provider as-is
     * @param base64     compact base64 of that recording (already validated and size-capped)
     * @param audioBytes decoded length, logged instead of any audio content
     */
    public AiVoiceDtos.VoiceParseResponse parseVoice(String format, String base64, int audioBytes) {
        if (!isConfigured()) {
            throw AiApiException.notConfigured("Voice parsing");
        }
        // Lengths and model slugs only: the key, the audio and the transcript must stay out of logs.
        log.info("AI voice parse: sttModel={} model={} format={} bytes={}", sttModel, model, format, audioBytes);
        String transcript = transcribe(base64, format);
        log.info("AI voice parse: transcribed {} chars", transcript.length());

        String prompt = VOICE_PROMPT + "\n\n今天的日期是：" + LocalDate.now() + "\n\n用户语音转写内容：\n" + transcript;
        Map<String, Object> body = Map.of(
                "model", model,
                "temperature", 0,
                "max_tokens", maxTokens,
                "messages", List.of(Map.of("role", "user", "content", prompt)));
        return parseVoiceAccounting(post("/chat/completions", body, "Voice parsing"), transcript);
    }

    /** Step one: the provider's transcription endpoint returns plain text, nothing else. */
    private String transcribe(String base64, String format) {
        Map<String, Object> body = Map.of(
                "model", sttModel,
                "input_audio", Map.of("data", base64, "format", format),
                "language", "zh",
                "temperature", 0);
        String response = post("/audio/transcriptions", body, "Voice transcription");
        if (response == null || response.isBlank()) {
            throw AiApiException.upstream("Voice transcription provider returned an empty response");
        }
        try {
            String text = objectMapper.readTree(response).path("text").asText("").trim();
            if (text.isEmpty()) {
                throw AiApiException.upstream("Voice transcription provider returned no text");
            }
            return text;
        } catch (AiApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw AiApiException.upstream("Voice transcription provider returned an unreadable payload");
        }
    }

    private AiVoiceDtos.VoiceParseResponse parseVoiceAccounting(String response, String transcript) {
        if (response == null || response.isBlank()) {
            throw AiApiException.upstream("Voice parsing provider returned an empty response");
        }
        try {
            JsonNode root = objectMapper.readTree(response);
            String text = contentOf(root.path("choices").path(0).path("message").path("content"));
            String cleaned = text.replace(FENCE + "json", "").replace(FENCE, "").trim();
            int start = cleaned.indexOf('{');
            int end = cleaned.lastIndexOf('}');
            if (start < 0 || end <= start) {
                throw AiApiException.upstream("Voice parsing provider did not return a JSON object");
            }
            JsonNode parsed = objectMapper.readTree(cleaned.substring(start, end + 1));
            String merchant = textOrNull(parsed.path("merchant"));
            String note = textOrNull(parsed.path("note"));
            return new AiVoiceDtos.VoiceParseResponse(
                    decimal(parsed.path("amount")),
                    merchant,
                    date(parsed.path("date")),
                    "income".equals(textOrNull(parsed.path("type"))) ? "income" : "expense",
                    textOrNull(parsed.path("suggestedCategory")),
                    note != null ? note : merchant,
                    transcript);
        } catch (AiApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw AiApiException.upstream("Voice parsing provider returned an unreadable payload");
        }
    }

    private static boolean isTimeout(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof HttpTimeoutException || cause instanceof TimeoutException) {
                return true;
            }
            if (cause == cause.getCause()) {
                break;
            }
        }
        return false;
    }

    private AiReceiptDtos.ReceiptScanResponse parse(String response) {
        if (response == null || response.isBlank()) {
            throw AiApiException.upstream("Receipt scanning provider returned an empty response");
        }
        try {
            JsonNode root = objectMapper.readTree(response);
            String text = contentOf(root.path("choices").path(0).path("message").path("content"));
            String cleaned = text.replace(FENCE + "json", "").replace(FENCE, "").trim();
            int start = cleaned.indexOf('{');
            int end = cleaned.lastIndexOf('}');
            if (start < 0 || end <= start) {
                throw AiApiException.upstream("Receipt scanning provider did not return a JSON object");
            }
            JsonNode parsed = objectMapper.readTree(cleaned.substring(start, end + 1));
            return new AiReceiptDtos.ReceiptScanResponse(
                    decimal(parsed.path("amount")),
                    textOrNull(parsed.path("merchant")),
                    date(parsed.path("date")),
                    "income".equals(textOrNull(parsed.path("type"))) ? "income" : "expense",
                    textOrNull(parsed.path("suggestedCategory")));
        } catch (AiApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw AiApiException.upstream("Receipt scanning provider returned an unreadable payload");
        }
    }

    private static String contentOf(JsonNode content) {
        if (content.isTextual()) {
            return content.asText();
        }
        if (content.isArray()) {
            StringBuilder text = new StringBuilder();
            content.forEach(part -> {
                if (part.isTextual()) {
                    text.append(part.asText());
                } else if (part.hasNonNull("text")) {
                    text.append(part.get("text").asText());
                }
            });
            return text.toString();
        }
        return "";
    }

    /** Number or numeric string; decimalValue() keeps the exact digits (no double round trip). */
    private static BigDecimal decimal(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        if (node.isNumber()) {
            return node.decimalValue();
        }
        String raw = node.asText("").replace(",", "").replaceAll("[^0-9.-]", "").trim();
        if (raw.isEmpty()) {
            return null;
        }
        try {
            return new BigDecimal(raw);
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static LocalDate date(JsonNode node) {
        String raw = textOrNull(node);
        if (raw == null) {
            return null;
        }
        try {
            return LocalDate.parse(raw);
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    private static String textOrNull(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        String text = node.asText("").trim();
        return text.isEmpty() || "null".equalsIgnoreCase(text) ? null : text;
    }
}
