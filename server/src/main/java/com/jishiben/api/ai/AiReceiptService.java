package com.jishiben.api.ai;

import java.util.Base64;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Guards the request shape before anything leaves the server: a hard decoded-byte ceiling, a
 * base64 decode that fails cleanly, and "images only" enforced by sniffing the actual bytes.
 */
@Service
public class AiReceiptService {

    private final AiOpenRouterClient client;
    private final int maxImageBytes;

    public AiReceiptService(AiOpenRouterClient client,
                            @Value("${app.ai.receipt-scan.max-image-bytes:8388608}") int maxImageBytes) {
        this.client = client;
        this.maxImageBytes = maxImageBytes;
    }

    public AiReceiptDtos.ReceiptScanResponse scan(AiReceiptDtos.ReceiptScanRequest request) {
        String raw = request == null || request.imageBase64() == null ? "" : request.imageBase64().trim();
        if (raw.isEmpty()) {
            throw AiApiException.validation("imageBase64 is required");
        }
        String declaredMime = null;
        if (raw.regionMatches(true, 0, "data:", 0, 5)) {
            int comma = raw.indexOf(',');
            if (comma < 0) {
                throw AiApiException.validation("imageBase64 data URL has no ',' separator");
            }
            declaredMime = raw.substring(5, comma).split(";")[0].trim().toLowerCase(Locale.ROOT);
            raw = raw.substring(comma + 1);
        }
        String compact = raw.replaceAll("\\s", "");
        // Reject before decoding: four base64 characters carry three bytes, plus two padding chars.
        if ((long) compact.length() > (long) maxImageBytes * 4 / 3 + 4) {
            throw AiApiException.payloadTooLarge("Receipt image must be at most " + maxImageBytes + " bytes");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(compact);
        } catch (IllegalArgumentException ex) {
            throw AiApiException.validation("imageBase64 is not valid base64");
        }
        if (bytes.length == 0) {
            throw AiApiException.validation("imageBase64 decoded to an empty image");
        }
        if (bytes.length > maxImageBytes) {
            throw AiApiException.payloadTooLarge("Receipt image must be at most " + maxImageBytes + " bytes");
        }
        return client.scan(imageMimeType(bytes, declaredMime), compact, bytes.length);
    }

    /**
     * Only image bytes are accepted. A declared data-URL type that is not image/* is refused outright;
     * otherwise the magic number wins, and the declared type is trusted only when sniffing finds
     * nothing (a rare format we have no signature for).
     */
    static String imageMimeType(byte[] bytes, String declaredMime) {
        if (declaredMime != null && !declaredMime.isEmpty() && !declaredMime.startsWith("image/")) {
            throw AiApiException.validation("Only image/* content is accepted (got " + declaredMime + ")");
        }
        String sniffed = sniff(bytes);
        if (sniffed != null) {
            return sniffed;
        }
        if (declaredMime != null && !declaredMime.isEmpty()) {
            return declaredMime;
        }
        throw AiApiException.validation(
                "imageBase64 must be a base64 encoded image (image/png, image/jpeg, image/webp, image/gif, image/heic)");
    }

    /** Magic-number sniffing: the client's claim is never taken on trust. */
    private static String sniff(byte[] b) {
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') {
            return "image/png";
        }
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') {
            return "image/gif";
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        if (b.length >= 12 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') {
            // ISO-BMFF container: HEIC/HEIF photos straight off an iPhone.
            return "image/heic";
        }
        return null;
    }
}
