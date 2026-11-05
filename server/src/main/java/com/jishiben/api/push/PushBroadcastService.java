package com.jishiben.api.push;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.security.CurrentUser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 管理员广播：把一条通知推给所有已注册的 Expo push token。
 * 只做三件事：鉴权（ADMIN 角色或配置的管理员邮箱）→ 读全部 token → 调 Expo Push API（每批 100 个）。
 * 不做重试队列、不落发送历史：这是排查/公告用的窄功能，失败原因原样回给调用方。
 */
@Service
public class PushBroadcastService {

    private static final Logger log = LoggerFactory.getLogger(PushBroadcastService.class);
    private static final String EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
    /** Expo Push API 单次最多 100 条 */
    private static final int CHUNK = 100;

    private final PushTokenRepository tokens;
    private final ObjectMapper json = new ObjectMapper();
    private final RestClient client;

    @Value("${app.push.admin-email:mingsoon249@gmail.com}")
    private String adminEmail;

    public PushBroadcastService(PushTokenRepository tokens) {
        this.tokens = tokens;
        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofSeconds(30));
        this.client = RestClient.builder().requestFactory(factory).build();
    }

    @Transactional(readOnly = true)
    public PushBroadcastDtos.SendResponse broadcast(String title, String body) {
        AuthPrincipal me = CurrentUser.principal();
        boolean allowed = me.isAdmin()
                || (me.email() != null && adminEmail != null && me.email().equalsIgnoreCase(adminEmail.trim()));
        if (!allowed) {
            throw ApiException.forbidden("Only the configured admin may broadcast");
        }

        List<PushToken> all = tokens.findAll();
        List<String> errors = new ArrayList<>();
        int sent = 0;
        int failed = 0;

        for (int from = 0; from < all.size(); from += CHUNK) {
            List<PushToken> chunk = all.subList(from, Math.min(all.size(), from + CHUNK));
            List<Map<String, Object>> messages = new ArrayList<>(chunk.size());
            for (PushToken t : chunk) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("to", t.getToken());
                m.put("title", title);
                m.put("body", body);
                m.put("sound", "default");
                messages.add(m);
            }
            try {
                String raw = client.post()
                        .uri(EXPO_PUSH_URL)
                        .contentType(MediaType.APPLICATION_JSON)
                        .accept(MediaType.APPLICATION_JSON)
                        .body(messages)
                        .retrieve()
                        .body(String.class);
                JsonNode data = raw == null ? null : json.readTree(raw).path("data");
                if (data != null && data.isArray()) {
                    int ok = 0;
                    int bad = 0;
                    for (JsonNode ticket : data) {
                        if ("ok".equals(ticket.path("status").asText())) {
                            ok++;
                        } else {
                            bad++;
                            if (errors.size() < 5) {
                                errors.add(ticket.path("message").asText("unknown error"));
                            }
                        }
                    }
                    sent += ok;
                    failed += bad + (chunk.size() - data.size());
                } else {
                    failed += chunk.size();
                    errors.add("empty response from Expo push service");
                }
            } catch (RestClientException | java.io.IOException e) {
                failed += chunk.size();
                errors.add(e.getClass().getSimpleName() + ": " + e.getMessage());
                log.warn("push broadcast chunk failed", e);
            }
        }

        return new PushBroadcastDtos.SendResponse(all.size(), sent, failed, errors);
    }
}