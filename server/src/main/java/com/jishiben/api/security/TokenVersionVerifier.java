package com.jishiben.api.security;

import com.jishiben.api.user.UserRepository;
import org.springframework.stereotype.Component;

/**
 * Reads users.token_version. A deleted account returns -1, which never equals a claim, so its
 * tokens stop working on the next request.
 */
@Component
public class TokenVersionVerifier implements TokenVersionSource {

    private final UserRepository users;

    public TokenVersionVerifier(UserRepository users) {
        this.users = users;
    }

    @Override
    public int currentVersion(long accountId) {
        return users.findTokenVersionById(accountId).orElse(-1);
    }
}
