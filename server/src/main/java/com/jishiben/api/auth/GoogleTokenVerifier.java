package com.jishiben.api.auth;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import java.util.Collections;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Google ID Token 的唯一校验入口。
 *
 * 只做「证明这个人是 Google 账号 X」：验签、iss、exp、aud 全部交给 GoogleIdTokenVerifier，
 * 业务逻辑不许绕过它，也不许相信客户端自报的邮箱/姓名/sub。
 * 证书缓存由 Google 库内部维护，不要自己重复实现。
 */
@Component
public class GoogleTokenVerifier {

    private static final Logger log = LoggerFactory.getLogger(GoogleTokenVerifier.class);

    /** 校验通过的身份：只保留服务端需要的字段。 */
    public record GoogleIdentity(String sub, String email, boolean emailVerified, String name) {
    }

    private final GoogleIdTokenVerifier verifier;

    public GoogleTokenVerifier(@Value("${app.google.web-client-id:}") String webClientId) {
        String id = webClientId == null ? "" : webClientId.trim();
        if (id.isEmpty()) {
            // 未配置时保持为 null：登录接口返回 GOOGLE_NOT_CONFIGURED，邮箱登录不受影响
            this.verifier = null;
            log.warn("GOOGLE_WEB_CLIENT_ID 未配置：Google 登录不可用（邮箱登录不受影响）");
        } else {
            this.verifier = new GoogleIdTokenVerifier.Builder(new NetHttpTransport(), GsonFactory.getDefaultInstance())
                    .setAudience(List.of(id))
                    .build();
        }
    }

    public GoogleIdentity verify(String idToken) {
        if (verifier == null) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.GOOGLE_NOT_CONFIGURED,
                    "Google sign-in is not configured on this server");
        }
        GoogleIdToken parsed;
        try {
            parsed = verifier.verify(idToken);
        } catch (IllegalArgumentException e) {
            // 结构不合法（乱码/截断）：这是「Token 无效」，不是上游故障 —— 必须回 401 而不是 502
            throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.GOOGLE_TOKEN_INVALID,
                    "Google ID token is malformed");
        } catch (Exception e) {
            // 上游不可达（证书/JWKS 拉取失败）与「Token 不合法」必须区分，客户端才能决定重试还是重登
            throw new ApiException(HttpStatus.BAD_GATEWAY, ErrorCode.UPSTREAM_ERROR,
                    "Could not verify Google token right now: " + e.getClass().getSimpleName());
        }
        if (parsed == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.GOOGLE_TOKEN_INVALID,
                    "Google ID token is invalid, expired, or issued for another audience");
        }
        GoogleIdToken.Payload payload = parsed.getPayload();
        String sub = payload.getSubject();
        String email = payload.getEmail();
        boolean emailVerified = Boolean.TRUE.equals(payload.getEmailVerified());
        if (sub == null || sub.isBlank()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.GOOGLE_TOKEN_INVALID,
                    "Google ID token has no subject");
        }
        String name = (String) payload.get("name");
        return new GoogleIdentity(sub, email == null ? "" : email.trim(), emailVerified, name);
    }
}
