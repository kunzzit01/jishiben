package com.jishiben.api.ai;

import java.math.BigDecimal;
import java.time.LocalDate;

/** Wire contract for POST /api/ai/receipt-scan. Every recognised field is null when unknown. */
public final class AiReceiptDtos {

    private AiReceiptDtos() {
    }

    /**
     * imageBase64 accepts a raw base64 string or a data URL ({@code data:image/png;base64,...}).
     * The MIME type is sniffed from the decoded bytes, never trusted from the client alone.
     */
    public record ReceiptScanRequest(String imageBase64) {
    }

    /** Mirrors the app's ScannedReceipt: fields the device may be unable to read come back null. */
    public record ReceiptScanResponse(
            BigDecimal amount,
            String merchant,
            LocalDate date,
            String type,
            String suggestedCategory) {
    }
}
