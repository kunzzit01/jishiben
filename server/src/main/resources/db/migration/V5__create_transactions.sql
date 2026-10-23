-- ============================================================
-- V5: transactions —— 流水（支出 / 收入 / 转账 / 汇兑）
-- 与 Supabase 版的三处刻意差异（都有理由，见 docs/DB-SCHEMA.md）：
--   1) 金额全部 DECIMAL(19,4)、汇率 DECIMAL(19,8) —— 不用 FLOAT/DOUBLE。
--   2) asset_id / from_asset_id / to_asset_id 从「弱引用」升级为真实外键
--      ON DELETE SET NULL：账户被删后历史流水保留，但不再指向不存在的账户。
--   3) 新增 currency 快照列：统计按币种分组是产品级硬规则（绝不跨币种相加），
--      而转账的转出/转入可能不同币种；靠 join assets 既慢，又会在账户删除后失真。
-- ============================================================

CREATE TABLE transactions (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id          BIGINT UNSIGNED NOT NULL,
    client_uid       VARCHAR(64)     NOT NULL COMMENT 'App 生成的流水 id；同步幂等键',
    ledger_id        BIGINT UNSIGNED NOT NULL,
    category_id      BIGINT UNSIGNED NULL     COMMENT '分类；空串（App 的默认值）入库时规范化为 NULL',
    asset_id         BIGINT UNSIGNED NULL     COMMENT '单账户交易',
    from_asset_id    BIGINT UNSIGNED NULL     COMMENT '转账/汇兑：转出账户',
    to_asset_id      BIGINT UNSIGNED NULL     COMMENT '转账/汇兑：转入账户',
    type             VARCHAR(16)     NOT NULL COMMENT 'expense|income|transfer',
    amount           DECIMAL(19,4)   NOT NULL COMMENT '交易金额（转出侧金额）',
    currency         CHAR(3)         NOT NULL COMMENT '金额所属币种快照（转出币种），统计分组依据',
    exchange_rate    DECIMAL(19,8)   NULL     COMMENT '用户手填汇率：converted_amount = amount * exchange_rate',
    converted_amount DECIMAL(19,4)   NULL     COMMENT '转入侧金额',
    fee              DECIMAL(19,4)   NULL     COMMENT '转账手续费（App 会另生成一笔 fee 支出）',
    occurred_on      DATE            NOT NULL COMMENT '业务日期；Supabase 用 text 存 YYYY-MM-DD，这里用原生 DATE',
    note             VARCHAR(500)    NOT NULL DEFAULT '',
    display_name     VARCHAR(100)    NULL     COMMENT '无分类时的显示标题（如计划付款"房租"）',
    receipt_path     VARCHAR(512)    NULL     COMMENT '小票存储相对路径；当前 App 只存本地 uri',
    created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_transactions_user_client_uid (user_id, client_uid),
    KEY idx_transactions_user_id (user_id),
    KEY idx_transactions_user_date (user_id, occurred_on DESC),
    KEY idx_transactions_user_ledger_date (user_id, ledger_id, occurred_on DESC),
    KEY idx_transactions_user_category (user_id, category_id, occurred_on),
    KEY idx_transactions_user_asset (user_id, asset_id, occurred_on),
    KEY idx_transactions_ledger_id (ledger_id),
    KEY idx_transactions_category_id (category_id),
    KEY idx_transactions_asset_id (asset_id),
    KEY idx_transactions_from_asset_id (from_asset_id),
    KEY idx_transactions_to_asset_id (to_asset_id),
    CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_transactions_ledger FOREIGN KEY (ledger_id) REFERENCES ledgers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
    CONSTRAINT fk_transactions_asset FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE SET NULL,
    CONSTRAINT fk_transactions_from_asset FOREIGN KEY (from_asset_id) REFERENCES assets (id) ON DELETE SET NULL,
    CONSTRAINT fk_transactions_to_asset FOREIGN KEY (to_asset_id) REFERENCES assets (id) ON DELETE SET NULL,
    CONSTRAINT chk_transactions_type CHECK (type IN ('expense', 'income', 'transfer')),
    CONSTRAINT chk_transactions_amount CHECK (amount >= 0),
    CONSTRAINT chk_transactions_fee CHECK (fee IS NULL OR fee >= 0)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '流水（支出/收入/转账/汇兑）';
