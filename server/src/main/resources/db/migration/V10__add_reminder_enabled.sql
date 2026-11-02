-- ============================================================
-- V10: assets.reminder_enabled —— 账户还款提醒开关
-- TINYINT(1) / NULL / DEFAULT 0：老行由 ALTER 直接补成 0，允许 NULL 只是为兼容手工写入。
-- 应用侧永不写 NULL（AssetService 用 Boolean.TRUE.equals 归一化为 false），
-- 非信用卡账户同样存 false：本列只表示"提醒是否开启"，可用性由 type 决定。
-- ============================================================

ALTER TABLE assets
    ADD COLUMN reminder_enabled TINYINT(1) NULL DEFAULT 0
        COMMENT '是否开启还款提醒：0 关闭 / 1 开启（NULL 视为 0）'
        AFTER interest_rate;
