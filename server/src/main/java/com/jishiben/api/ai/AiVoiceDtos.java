package com.jishiben.api.ai;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Wire contract for POST /api/ai/voice-parse. The shape mirrors the app's VoiceAccountingResult so
 * the device keeps consuming exactly what it always did — only the transport changed.
 */
public final class AiVoiceDtos {

    private AiVoiceDtos() {
    }

    /**
     * audioBase64 is the raw base64 of the recording (no data URL); format is the container the app
     * recorded (m4a/wav/...), allow-listed by the service before it reaches the provider.
     */
    public record VoiceParseRequest(String audioBase64, String format) {
    }

    /** transcript is always present; every other field is null when the model could not read it. */
    public record VoiceParseResponse(
            BigDecimal amount,
            String merchant,
            LocalDate date,
            String type,
            String suggestedCategory,
            String note,
            String transcript) {
    }
}
