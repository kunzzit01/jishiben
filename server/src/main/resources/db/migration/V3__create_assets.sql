-- ============================================================
-- V3: assets —— 资产账户（现金/银行/信用卡/电子钱包/投资/其他）
-- 金额字段一律 DECIMAL(19,4)：现有 App 用 double 是已知缺陷（FEATURES 4.3），不继承。
-- archived_at 对齐现有 schema 的账户归档语义（归档后不可删、折叠显示）。
-- ============================================================

CREATE TABLE assets (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL,
    client_uid      VARCHAR(64)     NOT NULL COMMENT 'App 生成的账户 id',
    ledger_id       BIGINT UNSIGNED NOT NULL COMMENT '所属账本',
    name            VARCHAR(100)    NOT NULL,
    icon            VARCHAR(64)     NOT NULL,
    color           CHAR(7)         NOT NULL,
    type            VARCHAR(16)     NOT NULL COMMENT 'cash|bank|credit|ewallet|investment|other',
    currency        CHAR(3)         NOT NULL COMMENT '账户币种；多币种不自动换算，按币种分组统计',
    initial_balance DECIMAL(19,4)   NOT NULL DEFAULT 0.0000 COMMENT '起始余额（4 位小数保留到分以下，防精度丢失）',
    credit_limit    DECIMAL(19,4)   NULL     COMMENT '仅信用卡：额度',
    statement_day   TINYINT UNSIGNED NULL    COMMENT '仅信用卡：账单日 1-31',
    due_day         TINYINT UNSIGNED NULL    COMMENT '仅信用卡：还款日 1-31',
    interest_rate   DECIMAL(9,6)    NULL     COMMENT '仅信用卡：年化利率小数形式，0.185000 = 18.5%',
    is_default      TINYINT(1)      NOT NULL DEFAULT 0,
    sort_order      INT             NOT NULL DEFAULT 0,
    archived_at     DATETIME        NULL     COMMENT '归档时间；NULL = 活跃（对齐现有 assets.archived_at）',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_assets_user_client_uid (user_id, client_uid),
    KEY idx_assets_user_id (user_id),
    KEY idx_assets_user_ledger (user_id, ledger_id),
    KEY idx_assets_user_archived (user_id, archived_at),
    KEY idx_assets_ledger_id (ledger_id),
    CONSTRAINT fk_assets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_assets_ledger FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE RESTRICT,
    CONSTRAINT chk_assets_type CHECK (type IN ('cash', 'bank', 'credit', 'ewallet', 'investment', 'other')),
    CONSTRAINT chk_assets_statement_day CHECK (statement_day IS NULL OR statement_day BETWEEN 1 AND 31),
    CONSTRAINT chk_assets_due_day CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '资产账户';
