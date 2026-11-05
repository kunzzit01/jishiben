package com.jishiben.api.push;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/** 广播请求/响应：只给管理员用，把一条通知发给所有已注册设备。 */
public final class PushBroadcastDtos {

    private PushBroadcastDtos() {
    }

    public record SendRequest(
            @NotBlank @Size(max = 120) String title,
            @NotBlank @Size(max = 400) String body) {
    }

    public record SendResponse(int total, int sent, int failed, List<String> errors) {
    }
}