-- Google 登录：一个 users 行最多绑定一个 Google sub。
-- 用 utf8mb4_bin（区分大小写）而不是库默认的 ci 排序规则：sub 是大小写敏感的不透明标识符，
-- 用 ci 比较会把两个不同的 sub 判成冲突，属于静默错配。
ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
CREATE UNIQUE INDEX ux_users_google_sub ON users (google_sub);
