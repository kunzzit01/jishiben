-- ============================================================
-- V1: users —— 自建 JWT 的账户主体
-- 替代 Supabase auth.users（本次不迁移数据，MySQL 空库起步）。
-- 全局约定：InnoDB / utf8mb4 / utf8mb4_0900_ai_ci / BIGINT UNSIGNED 自增主键
--          / created_at + updated_at 审计列。
-- ============================================================

CREATE TABLE users (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email             VARCHAR(255)    NOT NULL COMMENT '登录邮箱，全局唯一（0900_ai_ci 不区分大小写）',
    password_hash     VARCHAR(100)    NULL     COMMENT 'BCrypt(60) 或 Argon2 哈希，绝不存明文',
    display_name      VARCHAR(100)    NULL,
    user_role         VARCHAR(20)     NOT NULL DEFAULT 'USER' COMMENT '角色；ROLE 在 MySQL 8 是保留字，故加前缀',
    email_verified_at DATETIME        NULL     COMMENT '邮箱验证时间，NULL = 未验证',
    token_version     INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'JWT 失效版本号：改密/登出全部设备时 +1，旧 token 立即失效',
    last_login_at     DATETIME        NULL,
    created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_users_email (email),
    CONSTRAINT chk_users_role CHECK (user_role IN ('USER', 'ADMIN'))
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '账户（自建 JWT 认证主体）';
