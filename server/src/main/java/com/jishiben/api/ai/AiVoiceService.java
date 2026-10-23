package com.jishiben.api.ai;

import java.util.Base64;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Guards the voice-parse request shape before any audio leaves the server: an allow-listed container
 * format, a hard decoded-byte ceiling (10 MB by default) and a base64 decode that fails cleanly.
 */
@Service
public class AiVoiceService {

    /** Containers the provider's transcription endpoint accepts for a short recording. */
    private static final Set<String> FORMATS =
            new TreeSet<>(Set.of("m4a", "wav", "mp3", "aac", "amr", "caf", "flac", "ogg", "opus", "webm", "mp4", "mpga", "mpeg"));

    private final AiOpenRouterClient client;
    private final int maxAudioBytes;

    public AiVoiceService(AiOpenRouterClient client,
                          @Value("${app.ai.voice-parse.max-audio-bytes:10485760}") int maxAudioBytes) {
        this.client = client;
        this.maxAudioBytes = maxAudioBytes;
    }

    public AiVoiceDtos.VoiceParseResponse parse(AiVoiceDtos.VoiceParseRequest request) {
        String format = request == null || request.format() == null
                ? "" : request.format().trim().toLowerCase(Locale.ROOT);
        if (format.isEmpty()) {
            throw AiApiException.validation("format is required");
        }
        if (!FORMATS.contains(format)) {
            throw AiApiException.validation(
                    "format must be one of " + String.join(", ", FORMATS) + " (got " + format + ")");
        }
        String raw = request.audioBase64() == null ? "" : request.audioBase64().trim();
        if (raw.isEmpty()) {
            throw AiApiException.validation("audioBase64 is required");
        }
        String compact = raw.replaceAll("\\s", "");
        // Reject before decoding: four base64 characters carry three bytes, plus two padding chars.
        if ((long) compact.length() > (long) maxAudioBytes * 4 / 3 + 4) {
            throw AiApiException.payloadTooLarge("Voice recording must be at most " + maxAudioBytes + " bytes");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(compact);
        } catch (IllegalArgumentException ex) {
            throw AiApiException.validation("audioBase64 is not valid base64");
        }
        if (bytes.length == 0) {
            throw AiApiException.validation("audioBase64 decoded to an empty recording");
        }
        if (bytes.length > maxAudioBytes) {
            throw AiApiException.payloadTooLarge("Voice recording must be at most " + maxAudioBytes + " bytes");
        }
        return client.parseVoice(format, compact, bytes.length);
    }
}
