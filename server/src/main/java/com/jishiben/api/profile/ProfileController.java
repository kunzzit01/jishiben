package com.jishiben.api.profile;

import com.jishiben.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/profile")
public class ProfileController {

    private final ProfileService profiles;

    public ProfileController(ProfileService profiles) {
        this.profiles = profiles;
    }

    @GetMapping
    public ProfileDtos.Response get() {
        return profiles.get(CurrentUser.id());
    }

    @PatchMapping
    public ProfileDtos.Response update(@Valid @RequestBody ProfileDtos.UpdateRequest request) {
        return profiles.update(CurrentUser.id(), request);
    }
}
