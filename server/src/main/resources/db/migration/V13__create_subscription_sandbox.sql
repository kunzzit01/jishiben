-- Separate billing identities allow guests to subscribe without an application account.
CREATE TABLE billing_subjects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    account_hash CHAR(64) NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    guest_hash CHAR(64) NULL,
    linked_to BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_billing_subject_public (public_id),
    UNIQUE KEY uk_billing_subject_account (account_hash),
    UNIQUE KEY uk_billing_subject_user (user_id),
    UNIQUE KEY uk_billing_subject_guest (guest_hash),
    KEY idx_billing_subject_link (linked_to),
    CONSTRAINT fk_billing_subject_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_billing_subject_link FOREIGN KEY (linked_to) REFERENCES billing_subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE billing_settings (
    id BIGINT UNSIGNED NOT NULL,
    enrollment_open BOOLEAN NOT NULL DEFAULT FALSE,
    sandbox_open BOOLEAN NOT NULL DEFAULT FALSE,
    gates_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO billing_settings (id) VALUES (1);

CREATE TABLE billing_subscriptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(16) NOT NULL,
    base_plan VARCHAR(16) NOT NULL,
    subscription_state VARCHAR(24) NOT NULL,
    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at DATETIME NULL,
    request_key VARCHAR(64) NOT NULL,
    token_hash CHAR(64) NULL,
    token_cipher TEXT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    last_checked_at DATETIME NULL,
    next_check_at DATETIME NULL,
    failures INT UNSIGNED NOT NULL DEFAULT 0,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_billing_subscription_public (public_id),
    UNIQUE KEY uk_billing_subscription_request (subject_id, provider, request_key),
    UNIQUE KEY uk_billing_subscription_token (token_hash),
    KEY idx_billing_subscription_subject (subject_id),
    KEY idx_billing_subscription_reconcile (provider, last_checked_at),
    CONSTRAINT fk_billing_subscription_subject FOREIGN KEY (subject_id) REFERENCES billing_subjects(id),
    CONSTRAINT chk_billing_subscription_provider CHECK (provider IN ('SANDBOX', 'GOOGLE_PLAY')),
    CONSTRAINT chk_billing_subscription_plan CHECK (base_plan IN ('monthly', 'yearly'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE billing_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_key VARCHAR(128) NOT NULL,
    subscription_id BIGINT UNSIGNED NULL,
    actor_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(40) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_billing_event_key (event_key),
    KEY idx_billing_event_subscription (subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
