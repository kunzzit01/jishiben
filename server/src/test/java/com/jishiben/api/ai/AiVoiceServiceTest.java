package com.jishiben.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class AiVoiceServiceTest {

    private static final int MAX_BYTES = 64;

    private final AiOpenRouterClient client = mock(AiOpenRouterClient.class);
    private final AiVoiceService service = new AiVoiceService(client, MAX_BYTES);

    private static String b64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }

    private static AiVoiceDtos.VoiceParseResponse parsed() {
        return new AiVoiceDtos.VoiceParseResponse(new BigDecimal("35"), "麦当劳",
                LocalDate.of(2025, 3, 1), "expense", "餐饮", "麦当劳午饭", "今天午饭花了35块");
    }

    private static AiVoiceDtos.VoiceParseRequest request(String audioBase64, String format) {
        return new AiVoiceDtos.VoiceParseRequest(audioBase64, format);
    }

    @Test
    void aRecordingIsForwardedWithItsFormatAndDecodedLength() {
        byte[] audio = new byte[16];
        when(client.parseVoice(anyString(), anyString(), anyInt())).thenReturn(parsed());

        AiVoiceDtos.VoiceParseResponse response = service.parse(request(b64(audio), "m4a"));

        // The whole voice contract travels back untouched: the app keeps consuming VoiceAccountingResult.
        assertThat(response.amount()).isEqualByComparingTo("35");
        assertThat(response.merchant()).isEqualTo("麦当劳");
        assertThat(response.date()).isEqualTo(LocalDate.of(2025, 3, 1));
        assertThat(response.type()).isEqualTo("expense");
        assertThat(response.suggestedCategory()).isEqualTo("餐饮");
        assertThat(response.note()).isEqualTo("麦当劳午饭");
        assertThat(response.transcript()).isEqualTo("今天午饭花了35块");
        verify(client).parseVoice(eq("m4a"), eq(b64(audio)), eq(audio.length));
    }

    @Test
    void theFormatIsNormalisedBeforeItIsForwarded() {
        when(client.parseVoice(anyString(), anyString(), anyInt())).thenReturn(parsed());

        service.parse(request(b64(new byte[] {1, 2, 3}), " M4A "));

        verify(client).parseVoice(eq("m4a"), anyString(), anyInt());
    }

    @Test
    void whitespaceInsideTheBase64IsIgnored() {
        String encoded = b64(new byte[] {1, 2, 3, 4});
        String spaced = encoded.substring(0, 4) + "\n " + encoded.substring(4);
        when(client.parseVoice(anyString(), anyString(), anyInt())).thenReturn(parsed());

        service.parse(request(spaced, "wav"));

        verify(client).parseVoice(eq("wav"), eq(encoded), eq(4));
    }

    @Test
    void aMissingRecordingIsAValidationFailure() {
        assertThatThrownBy(() -> service.parse(request("  ", "m4a")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        assertThatThrownBy(() -> service.parse(request(null, "m4a")))
                .isInstanceOf(AiApiException.class);
        assertThatThrownBy(() -> service.parse(null))
                .isInstanceOf(AiApiException.class);
        verifyNoInteractions(client);
    }

    @Test
    void aMissingOrUnsupportedFormatIsAValidationFailure() {
        String audio = b64(new byte[] {1, 2, 3});

        assertThatThrownBy(() -> service.parse(request(audio, null)))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        assertThatThrownBy(() -> service.parse(request(audio, "  ")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        // An executable (or any other container the transcriber cannot read) is refused outright.
        assertThatThrownBy(() -> service.parse(request(audio, "exe")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        verifyNoInteractions(client);
    }

    @Test
    void invalidBase64IsAValidationFailure() {
        assertThatThrownBy(() -> service.parse(request("not-base64-at-all!!", "m4a")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        verifyNoInteractions(client);
    }

    @Test
    void anOversizedBodyIsRejectedBeforeDecoding() {
        String tooBig = "A".repeat(MAX_BYTES * 4);

        assertThatThrownBy(() -> service.parse(request(tooBig, "m4a")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("PAYLOAD_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE);
        verify(client, never()).parseVoice(anyString(), anyString(), anyInt());
    }

    @Test
    void anOversizedDecodedRecordingIsRejected() {
        // 65 decoded bytes from a 88-char body: under the length pre-check, over the byte ceiling.
        String encoded = b64(new byte[65]);

        assertThatThrownBy(() -> service.parse(request(encoded, "m4a")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("PAYLOAD_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE);
        verify(client, never()).parseVoice(anyString(), anyString(), anyInt());
    }
}
