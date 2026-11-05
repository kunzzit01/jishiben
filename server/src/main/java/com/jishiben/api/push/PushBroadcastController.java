package com.jishiben.api.push;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 管理员广播入口：POST /api/admin/broadcast —— 一条通知发给所有已注册设备。 */
@RestController
@RequestMapping("/api/admin")
public class PushBroadcastController {

    private final PushBroadcastService broadcast;

    public PushBroadcastController(PushBroadcastService broadcast) {
        this.broadcast = broadcast;
    }

    @PostMapping("/broadcast")
    public PushBroadcastDtos.SendResponse send(@Valid @RequestBody PushBroadcastDtos.SendRequest request) {
        return broadcast.broadcast(request.title(), request.body());
    }
}