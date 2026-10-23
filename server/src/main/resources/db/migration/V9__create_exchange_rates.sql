-- ============================================================
-- V9: exchange_rates —— 汇率缓存（服务端抓 open.er-api.com，24h 刷新）
-- Supabase 版以 base 作主键、rates 为 jsonb。这里 base 改为唯一键（保留自增主键约定），
-- rates 用 MySQL JSON 存原始响应体，保留向前兼容（新币种无需改表）。
-- 需要参与计算的汇率请用 transactions.exchange_rate（DECIMAL(19,8)），
-- 不要把 JSON 里的数字当定点数用。
-- ============================================================

CREATE TABLE exchange_rates (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    base       CHAR(3)         NOT NULL COMMENT '基准币种，如 MYR',
    rates      JSON            NOT NULL COMMENT '{"USD":0.21,"SGD":0.28,...}；Supabase jsonb -> MySQL JSON',
    fetched_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '抓取时间，24h 过期判定依据',
    created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_exchange_rates_base (base),
    KEY idx_exchange_rates_fetched_at (fetched_at),
    CONSTRAINT chk_exchange_rates_base CHECK (CHAR_LENGTH(base) = 3)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '汇率缓存（公开数据）';
