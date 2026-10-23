package com.jishiben.api.push;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Checks;
import com.jishiben.api.common.Texts;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One row per device. The Expo token is globally unique: when the same handset signs into another
 * account, the token is re-owned instead of duplicated, otherwise notifications fan out to the wrong
 * person.
 */
@Service
public class PushTokenService {

    private static final Pattern EXPO_TOKEN = Pattern.compile("^Expo(nent)?PushToken\\[[^\\[\\]]+]$");
    private static final Set<String> PLATFORMS = Set.of("ios", "android", "web");

    private final PushTokenRepository tokens;

    public PushTokenService(PushTokenRepository tokens) {
        this.tokens = tokens;
    }

    @Transactional
    public PushDtos.Response register(long ownerId, PushDtos.RegisterRequest request) {
        String token = Texts.requireNonBlank(request.token(), "token");
        if (!EXPO_TOKEN.matcher(token).matches()) {
            throw ApiException.validation("token must be an Expo push token, e.g. ExponentPushToken[xxxxxxxx]");
        }
        String platform = Checks.optionalOneOf(request.platform(), PLATFORMS, "platform");
        PushToken row = tokens.findByToken(token).orElse(null);
        if (row == null) {
            row = new PushToken();
            row.setToken(token);
        }
        row.setOwnerId(ownerId);
        row.setPlatform(platform);
        row.setLastSeenAt(Instant.now());
        PushToken saved = tokens.save(row);
        return new PushDtos.Response(saved.getToken(), saved.getPlatform(), saved.getLastSeenAt());
    }

    /** Idempotent: unregistering a token you do not own is a no-op, not an error. */
    @Transactional
    public void unregister(long ownerId, PushDtos.UnregisterRequest request) {
        String token = Texts.requireNonBlank(request.token(), "token");
        tokens.deleteByOwnerIdAndToken(ownerId, token);
    }

    @Transactional(readOnly = true)
    public List<PushDtos.Response> list(long ownerId) {
        return tokens.findByOwnerIdOrderByLastSeenAtDescIdDesc(ownerId).stream()
                .map(row -> new PushDtos.Response(row.getToken(), row.getPlatform(), row.getLastSeenAt()))
                .toList();
    }
}
