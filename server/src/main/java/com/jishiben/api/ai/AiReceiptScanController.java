package com.jishiben.api.ai;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Server-side proxy for receipt scanning. The device never learns which provider is used and never
 * holds a key; a missing server key answers 503 AI_NOT_CONFIGURED so the app degrades instead of
 * crashing.
 */
@RestController
@RequestMapping("/api/ai")
public class AiReceiptScanController {

    private final AiReceiptService service;

    public AiReceiptScanController(AiReceiptService service) {
        this.service = service;
    }

    /** Bearer-protected like every other business endpoint (SecurityConfig: anyRequest().authenticated()). */
    @PostMapping("/receipt-scan")
    public AiReceiptDtos.ReceiptScanResponse receiptScan(
            @RequestBody(required = false) AiReceiptDtos.ReceiptScanRequest request) {
        return service.scan(request);
    }
}
