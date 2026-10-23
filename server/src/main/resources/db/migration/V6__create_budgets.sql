-- ============================================================
-- V6: budgets —— 预算
-- Supabase 用 id = categoryId + '|' + currency 造确定性主键，并用 categoryId='total'
-- 这个魔法字符串表示总预算。MySQL 版改为显式 scope 列 + 可空外键：
--   scope='total'    -> category_id 必须为 NULL
--   scope='category' -> category_id 必须有值（真外键，分类删则预算删）
-- 唯一性用生成列消除 NULL 不参与唯一约束的问题（否则可插多条总预算）。
-- 【MYSQL 8.0 实测修正 2025-10-22】生成列必须是 VIRTUAL，不能是 STORED：
--   category_key 以 category_id 为基列，而 fk_budgets_category 声明了 ON DELETE CASCADE。
--   MySQL 明确禁止「存储生成列的基列」上带 CASCADE / SET NULL 引用动作，STORED 时建表直接
--   报 ERROR 1215 (HY000) Cannot add foreign key constraint（在真实 8.0.43 上实测复现）。
--   改为 VIRTUAL 后 CASCADE 语义与唯一性不变（唯一索引在虚拟列上同样生效），
--   实测：VIRTUAL + CASCADE 可建表，且两条 category_id NULL 的总预算会撞唯一键。
-- ============================================================

CREATE TABLE budgets (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id      BIGINT UNSIGNED NOT NULL,
    client_uid   VARCHAR(64)     NOT NULL COMMENT 'App 生成的预算键（categoryId|currency）',
    scope        VARCHAR(16)     NOT NULL DEFAULT 'category' COMMENT 'total = 总预算；category = 分类预算',
    category_id  BIGINT UNSIGNED NULL,
    category_key BIGINT UNSIGNED GENERATED ALWAYS AS (IFNULL(category_id, 0)) VIRTUAL
                 COMMENT '唯一键用：把 NULL 归一为 0，使总预算也只能存在一条',
    currency     CHAR(3)         NOT NULL COMMENT '币种；App 的空值（跟随全局）在写入时固化为当时全局币种',
    amount       DECIMAL(19,4)   NOT NULL COMMENT '预算额度',
    created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_budgets_user_client_uid (user_id, client_uid),
    UNIQUE KEY uk_budgets_user_scope_category_currency (user_id, scope, category_key, currency),
    KEY idx_budgets_user_id (user_id),
    KEY idx_budgets_category_id (category_id),
    CONSTRAINT fk_budgets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_budgets_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE,
    CONSTRAINT chk_budgets_scope CHECK (
        (scope = 'total' AND category_id IS NULL)
        OR (scope = 'category' AND category_id IS NOT NULL)
    ),
    CONSTRAINT chk_budgets_amount CHECK (amount >= 0)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '预算（总数 / 分类，按币种各一条）';
