-- ============================================================
-- V2: ledgers（账本）+ profiles（用户资料/显示设置）
-- 先建 ledgers，profiles.active_ledger_id 才能建外键（避免后续 ALTER 补约束）。
-- 表内 client_uid = App 端离线生成的字符串 id；对外同步用它做幂等键，
-- 内部关联一律用 BIGINT UNSIGNED 主键（Supabase 时代是以 text 主键互联）。
-- ============================================================

CREATE TABLE ledgers (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id      BIGINT UNSIGNED NOT NULL,
    client_uid   VARCHAR(64)     NOT NULL COMMENT 'App 生成的账本 id，离线创建也可保证多端一致',
    name         VARCHAR(100)    NOT NULL,
    icon         VARCHAR(64)     NOT NULL,
    color        CHAR(7)         NULL     COMMENT '#RRGGBB',
    sort_order   INT             NOT NULL DEFAULT 0 COMMENT '用户拖动排序后的次序',
    is_default   TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '默认账本不可删除（AppContext 506-520）',
    archived_at  DATETIME        NULL     COMMENT '软归档时间；NULL = 活跃',
    created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_ledgers_user_client_uid (user_id, client_uid),
    KEY idx_ledgers_user_id (user_id),
    CONSTRAINT fk_ledgers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '账本';

CREATE TABLE profiles (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id            BIGINT UNSIGNED NOT NULL,
    display_name       VARCHAR(100)    NULL,
    currency           CHAR(3)         NOT NULL DEFAULT 'MYR' COMMENT '全局兜底币种（账户级 currency 优先）',
    date_format        VARCHAR(20)     NOT NULL DEFAULT 'YYYY/MM/DD' COMMENT 'YYYY/MM/DD | DD/MM/YYYY | MM/DD/YYYY',
    week_starts_on     TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '0=周日 1=周一',
    decimal_places     TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '0/1/2 显示小数位',
    period_preference  JSON            NULL     COMMENT '统计周期偏好；Supabase 为 jsonb，MySQL 映射 JSON',
    active_ledger_id   BIGINT UNSIGNED NULL     COMMENT '当前账本；删账本时置 NULL',
    created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_profiles_user_id (user_id),
    KEY idx_profiles_active_ledger_id (active_ledger_id),
    CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_profiles_active_ledger FOREIGN KEY (active_ledger_id) REFERENCES ledgers (id) ON DELETE SET NULL,
    CONSTRAINT chk_profiles_week_starts_on CHECK (week_starts_on IN (0, 1)),
    CONSTRAINT chk_profiles_decimal_places CHECK (decimal_places IN (0, 1, 2))
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '用户资料与显示设置（每用户一行）';
