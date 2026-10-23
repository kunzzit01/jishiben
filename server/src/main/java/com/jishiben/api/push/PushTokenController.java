package com.jishiben.api.push;

import com.jishiben.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/push-tokens")
public class PushTokenController {

    private final PushTokenService tokens;

    public PushTokenController(PushTokenService tokens) {
        this.tokens = tokens;
    }

    @GetMapping
    public List<PushDtos.Response> list() {
        return tokens.list(CurrentUser.id());
    }

    @PostMapping
    public PushDtos.Response register(@Valid @RequestBody PushDtos.RegisterRequest request) {
        return tokens.register(CurrentUser.id(), request);
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unregister(@Valid @RequestBody PushDtos.UnregisterRequest request) {
        tokens.unregister(CurrentUser.id(), request);
    }
}
