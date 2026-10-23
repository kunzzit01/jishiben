-- ============================================================
-- V8: push_tokens —— 每台设备一个 Expo Push Token
-- 现有 Supabase 表用 token 作主键；这里保留 token 全局唯一约束，
-- 但仍按本项目硬性约定使用 BIGINT UNSIGNED 自增主键。
-- ============================================================

CREATE TABLE push_tokens (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id      BIGINT UNSIGNED NOT NULL,
    token        VARCHAR(191)    NOT NULL COMMENT 'ExpoPushToken[...]；191 长度保证 utf8mb4 索引安全',
    platform     VARCHAR(16)     NULL     COMMENT 'ios|android|web',
    last_seen_at DATETIME        NULL     COMMENT '最近一次注册时间，用于清理僵尸 token',
    created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_push_tokens_token (token),
    KEY idx_push_tokens_user_id (user_id),
    CONSTRAINT fk_push_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_push_tokens_platform CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web'))
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '推送设备 token（每设备一行）';
