package com.jishiben.api.auth;

import com.jishiben.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthDtos.TokenResponse register(@Valid @RequestBody AuthDtos.RegisterRequest request) {
        return auth.register(request);
    }

    @PostMapping("/login")
    public AuthDtos.TokenResponse login(@Valid @RequestBody AuthDtos.LoginRequest request) {
        return auth.login(request);
    }

    @PostMapping("/refresh")
    public AuthDtos.TokenResponse refresh(@Valid @RequestBody AuthDtos.RefreshRequest request) {
        return auth.refresh(request);
    }

    @PostMapping("/logout-all")
    public AuthDtos.TokenResponse logoutEverywhere() {
        return auth.logoutEverywhere(CurrentUser.id());
    }

    @PutMapping("/password")
    public AuthDtos.TokenResponse changePassword(@Valid @RequestBody AuthDtos.ChangePasswordRequest request) {
        return auth.changePassword(CurrentUser.id(), request);
    }

    @GetMapping("/me")
    public AuthDtos.UserResponse me() {
        return auth.me(CurrentUser.id());
    }

    @PatchMapping("/me")
    public AuthDtos.UserResponse updateMe(@Valid @RequestBody AuthDtos.UpdateMeRequest request) {
        return auth.updateMe(CurrentUser.id(), request);
    }
}
