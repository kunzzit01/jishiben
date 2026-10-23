-- ============================================================
-- V7: payment_plans —— 计划付款（月度固定支出/收入）
-- 现有实现只存在 App 本地 AsyncStorage，云端没有对应表，换设备即丢（FEATURES 4.1 缺口）。
-- 本表把它落到服务端；字段与 src/types/index.ts 的 PaymentPlan 对齐。
-- cycle 保留 weekly/monthly/yearly（引擎原本支持，UI 目前只暴露 monthly）。
-- ============================================================

CREATE TABLE payment_plans (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id             BIGINT UNSIGNED NOT NULL,
    client_uid          VARCHAR(64)     NOT NULL,
    ledger_id           BIGINT UNSIGNED NOT NULL,
    category_id         BIGINT UNSIGNED NULL     COMMENT '可为空：计划付款不强制分类',
    asset_id            BIGINT UNSIGNED NULL     COMMENT '扣账账户',
    name                VARCHAR(100)    NOT NULL,
    amount              DECIMAL(19,4)   NOT NULL,
    type                VARCHAR(16)     NOT NULL COMMENT 'expense|income',
    cycle               VARCHAR(16)     NOT NULL COMMENT 'weekly|monthly|yearly',
    day_of_week         TINYINT UNSIGNED NULL    COMMENT 'cycle=weekly：1-7',
    day_of_month        TINYINT UNSIGNED NULL    COMMENT 'cycle=monthly：1-31',
    month_of_year       TINYINT UNSIGNED NULL    COMMENT 'cycle=yearly：1-12',
    day                 TINYINT UNSIGNED NULL    COMMENT 'cycle=yearly：1-31',
    start_date          DATE            NOT NULL,
    end_date            DATE            NULL,
    auto_deduct         TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '到期自动生成流水',
    last_processed_date DATE            NULL     COMMENT '补账游标；上限 24 期（paymentPlans.ts:11）',
    active              TINYINT(1)      NOT NULL DEFAULT 1,
    sort_order          INT             NOT NULL DEFAULT 0,
    archived_at         DATETIME        NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_payment_plans_user_client_uid (user_id, client_uid),
    KEY idx_payment_plans_user_id (user_id),
    KEY idx_payment_plans_user_active (user_id, active, start_date),
    KEY idx_payment_plans_ledger_id (ledger_id),
    KEY idx_payment_plans_category_id (category_id),
    KEY idx_payment_plans_asset_id (asset_id),
    CONSTRAINT fk_payment_plans_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_payment_plans_ledger FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_payment_plans_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
    CONSTRAINT fk_payment_plans_asset FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE SET NULL,
    CONSTRAINT chk_payment_plans_type CHECK (type IN ('expense', 'income')),
    CONSTRAINT chk_payment_plans_cycle CHECK (cycle IN ('weekly', 'monthly', 'yearly')),
    CONSTRAINT chk_payment_plans_amount CHECK (amount >= 0),
    CONSTRAINT chk_payment_plans_range CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT chk_payment_plans_day_of_week CHECK (day_of_week IS NULL OR day_of_week BETWEEN 1 AND 7),
    CONSTRAINT chk_payment_plans_day_of_month CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
    CONSTRAINT chk_payment_plans_month_of_year CHECK (month_of_year IS NULL OR month_of_year BETWEEN 1 AND 12)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '计划付款（月度固定支出/收入计划）';
