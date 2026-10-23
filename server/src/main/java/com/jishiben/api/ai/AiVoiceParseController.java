package com.jishiben.api.ai;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Server-side proxy for voice bookkeeping. The recording goes to the server, which runs speech to
 * text and then the accounting parse; the device never holds a key and never learns the provider.
 * A missing server key answers 503 AI_NOT_CONFIGURED so the app degrades to manual entry.
 */
@RestController
@RequestMapping("/api/ai")
public class AiVoiceParseController {

    private final AiVoiceService service;

    public AiVoiceParseController(AiVoiceService service) {
        this.service = service;
    }

    /** Bearer-protected like every other business endpoint (SecurityConfig: anyRequest().authenticated()). */
    @PostMapping("/voice-parse")
    public AiVoiceDtos.VoiceParseResponse voiceParse(
            @RequestBody(required = false) AiVoiceDtos.VoiceParseRequest request) {
        return service.parse(request);
    }
}
