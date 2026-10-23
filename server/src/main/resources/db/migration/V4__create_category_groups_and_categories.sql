-- ============================================================
-- V4: category_groups（收支大类）+ categories（分类）
-- 现有云表 categories.group_name 存的是大类「名字」而非外键。这里规范化为
-- group_id 外键 + ON DELETE SET NULL：删大类不再因约束报错（原 UUID 设计的顾虑），
-- 但分类与大批的引用关系可被数据库校验。同步层负责 name -> group_id 的解析。
-- ============================================================

CREATE TABLE category_groups (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NOT NULL,
    client_uid  VARCHAR(64)     NOT NULL COMMENT 'App 端以大类名作 id，故 client_uid 通常等于 name',
    name        VARCHAR(50)     NOT NULL,
    color       CHAR(7)         NULL,
    icon        VARCHAR(64)     NULL,
    type        VARCHAR(16)     NOT NULL COMMENT 'expense|income',
    sort_order  INT             NOT NULL DEFAULT 0,
    archived_at DATETIME        NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_category_groups_user_client_uid (user_id, client_uid),
    UNIQUE KEY uk_category_groups_user_name (user_id, name),
    KEY idx_category_groups_user_id (user_id),
    CONSTRAINT fk_category_groups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_category_groups_type CHECK (type IN ('expense', 'income'))
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '收支大类';

CREATE TABLE categories (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NOT NULL,
    client_uid  VARCHAR(64)     NOT NULL COMMENT 'App 生成的分类 id',
    group_id    BIGINT UNSIGNED NULL     COMMENT '所属大类，NULL = 未分组',
    name        VARCHAR(50)     NOT NULL,
    icon        VARCHAR(64)     NOT NULL,
    color       CHAR(7)         NULL,
    type        VARCHAR(16)     NOT NULL COMMENT 'expense|income',
    sort_order  INT             NOT NULL DEFAULT 0,
    archived_at DATETIME        NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_categories_user_client_uid (user_id, client_uid),
    KEY idx_categories_user_id (user_id),
    KEY idx_categories_user_group (user_id, group_id),
    KEY idx_categories_user_type (user_id, type, sort_order),
    KEY idx_categories_group_id (group_id),
    CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_categories_group FOREIGN KEY (group_id) REFERENCES category_groups (id) ON DELETE SET NULL,
    CONSTRAINT chk_categories_type CHECK (type IN ('expense', 'income'))
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '收支分类';
