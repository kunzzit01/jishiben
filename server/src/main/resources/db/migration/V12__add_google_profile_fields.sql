-- Google 资料：名称与头像（只用于展示，账号身份仍然是 users.id / google_sub）
ALTER TABLE users
    ADD COLUMN google_name VARCHAR(120) NULL COMMENT 'Google 返回的完整姓名（保留中文/空格/顺序）',
    ADD COLUMN avatar_url VARCHAR(512) NULL COMMENT 'Google 头像 URL',
    ADD COLUMN display_name_custom BOOLEAN NOT NULL DEFAULT FALSE COMMENT '用户是否在 App 内自己改过昵称';
