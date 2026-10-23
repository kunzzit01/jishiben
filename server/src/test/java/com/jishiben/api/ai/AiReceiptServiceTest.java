package com.jishiben.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
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

class AiReceiptServiceTest {

    private static final int MAX_BYTES = 64;

    private final AiOpenRouterClient client = mock(AiOpenRouterClient.class);
    private final AiReceiptService service = new AiReceiptService(client, MAX_BYTES);

    private static byte[] pngBytes(int padding) {
        byte[] bytes = new byte[8 + padding];
        bytes[0] = (byte) 0x89;
        bytes[1] = 'P';
        bytes[2] = 'N';
        bytes[3] = 'G';
        bytes[4] = 0x0D;
        bytes[5] = 0x0A;
        bytes[6] = 0x1A;
        bytes[7] = 0x0A;
        return bytes;
    }

    private static String b64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }

    @Test
    void aPngIsForwardedWithTheSniffedMimeType() {
        byte[] image = pngBytes(0);
        when(client.scan(anyString(), anyString(), anyInt()))
                .thenReturn(new AiReceiptDtos.ReceiptScanResponse(new BigDecimal("12.30"), "便利店",
                        LocalDate.of(2025, 3, 1), "expense", "购物"));

        AiReceiptDtos.ReceiptScanResponse response =
                service.scan(new AiReceiptDtos.ReceiptScanRequest(b64(image)));

        assertThat(response.amount()).isEqualByComparingTo("12.30");
        assertThat(response.merchant()).isEqualTo("便利店");
        assertThat(response.date()).isEqualTo(LocalDate.of(2025, 3, 1));
        assertThat(response.type()).isEqualTo("expense");
        assertThat(response.suggestedCategory()).isEqualTo("购物");
        verify(client).scan(org.mockito.ArgumentMatchers.eq("image/png"),
                org.mockito.ArgumentMatchers.eq(b64(image)), org.mockito.ArgumentMatchers.eq(image.length));
    }

    @Test
    void aDataUrlIsAcceptedAndItsBase64IsStripped() {
        String jpeg = b64(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x01, 0x02});
        when(client.scan(anyString(), anyString(), anyInt()))
                .thenReturn(new AiReceiptDtos.ReceiptScanResponse(null, null, null, "expense", null));

        service.scan(new AiReceiptDtos.ReceiptScanRequest("data:image/jpeg;base64," + jpeg));

        verify(client).scan(org.mockito.ArgumentMatchers.eq("image/jpeg"),
                org.mockito.ArgumentMatchers.eq(jpeg), org.mockito.ArgumentMatchers.eq(5));
    }

    @Test
    void whitespaceInsideTheBase64IsIgnored() {
        String encoded = b64(pngBytes(0));
        String spaced = encoded.substring(0, 4) + "\n " + encoded.substring(4);
        when(client.scan(anyString(), anyString(), anyInt()))
                .thenReturn(new AiReceiptDtos.ReceiptScanResponse(null, null, null, "expense", null));

        service.scan(new AiReceiptDtos.ReceiptScanRequest(spaced));

        verify(client).scan(org.mockito.ArgumentMatchers.eq("image/png"),
                org.mockito.ArgumentMatchers.eq(encoded), org.mockito.ArgumentMatchers.eq(8));
    }

    @Test
    void aMissingImageIsAValidationFailure() {
        assertThatThrownBy(() -> service.scan(new AiReceiptDtos.ReceiptScanRequest("  ")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        assertThatThrownBy(() -> service.scan(new AiReceiptDtos.ReceiptScanRequest(null)))
                .isInstanceOf(AiApiException.class);
        assertThatThrownBy(() -> service.scan(null))
                .isInstanceOf(AiApiException.class);
        verifyNoInteractions(client);
    }

    @Test
    void invalidBase64IsAValidationFailure() {
        assertThatThrownBy(() -> service.scan(new AiReceiptDtos.ReceiptScanRequest("not-base64-at-all!!")))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        verifyNoInteractions(client);
    }

    @Test
    void nonImageBytesAreRefused() {
        String text = b64("hello this is not an image".getBytes());

        assertThatThrownBy(() -> service.scan(new AiReceiptDtos.ReceiptScanRequest(text)))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        verifyNoInteractions(client);
    }

    @Test
    void aDeclaredNonImageMimeIsRefusedEvenWhenTheBytesSniffAsAnImage() {
        String dataUrl = "data:text/plain;base64," + b64(pngBytes(0));

        assertThatThrownBy(() -> service.scan(new AiReceiptDtos.ReceiptScanRequest(dataUrl)))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("VALIDATION_FAILED", HttpStatus.BAD_REQUEST);
        verifyNoInteractions(client);
    }

    @Test
    void anOversizedBodyIsRejectedBeforeDecoding() {
        String tooBig = "A".repeat(MAX_BYTES * 4);

        assertThatThrownBy(() -> service.scan(new AiReceiptDtos.ReceiptScanRequest(tooBig)))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("PAYLOAD_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE);
        verify(client, never()).scan(anyString(), anyString(), anyInt());
    }

    @Test
    void anOversizedDecodedImageIsRejected() {
        // 65 decoded bytes from a 68-char body: under the length pre-check, over the byte ceiling.
        String encoded = b64(new byte[65]);

        assertThatThrownBy(() -> service.scan(new AiReceiptDtos.ReceiptScanRequest(encoded)))
                .isInstanceOf(AiApiException.class)
                .extracting("code", "status")
                .containsExactly("PAYLOAD_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE);
        verify(client, never()).scan(anyString(), anyString(), anyInt());
    }
}
