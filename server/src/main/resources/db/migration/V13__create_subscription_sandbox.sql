-- Subscriptions. Each deployment (staging / production) has its own database, so simulated
-- (SANDBOX) rows never share a database with production Google Play purchases.

-- A billing subject owns subscriptions. Guests get a subject without an app account, a signed-in
-- account has exactly one subject. A guest subject the user chose to bind points at the account
-- subject through linked_to (always one level deep).
CREATE TABLE billing_subjects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    -- SHA-256 of public_id, sent to Google as obfuscatedAccountId (no personal data).
    account_hash CHAR(64) NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    -- SHA-256 of the guest bearer credential, NULL once bound or replaced.
    guest_hash CHAR(64) NULL,
    linked_to BIGINT UNSIGNED NULL,
    -- Set when the owning account was deleted, the subject stays de-identified for audit/restore.
    detached_at DATETIME NULL,
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

-- Administrator switches for this deployment (single row).
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

-- The billing administrator is pinned to a Google account subject (sub), never to an e-mail
-- string. The row is created on the first Google sign-in whose verified e-mail matches the
-- configured administrator e-mail, later sign-ins must present the same sub.
CREATE TABLE billing_admins (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    google_sub VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_billing_admin_sub (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE billing_subscriptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(16) NOT NULL,
    base_plan VARCHAR(16) NOT NULL,
    subscription_state VARCHAR(32) NOT NULL,
    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at DATETIME NULL,
    -- Last instant this row granted membership, drives the 7-day sync grace after expiry.
    entitled_until DATETIME NULL,
    request_key VARCHAR(64) NOT NULL,
    token_hash CHAR(64) NULL,
    token_cipher TEXT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    test_purchase BOOLEAN NOT NULL DEFAULT FALSE,
    refunded_at DATETIME NULL,
    refund_type VARCHAR(40) NULL,
    revoked_at DATETIME NULL,
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
    KEY idx_billing_subscription_reconcile (provider, next_check_at),
    CONSTRAINT fk_billing_subscription_subject FOREIGN KEY (subject_id) REFERENCES billing_subjects(id),
    CONSTRAINT chk_billing_subscription_provider CHECK (provider IN ('SANDBOX', 'GOOGLE_PLAY')),
    CONSTRAINT chk_billing_subscription_plan CHECK (base_plan IN ('monthly', 'yearly'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Verified Google purchases whose owner could not be resolved yet (e.g. a notification that
-- arrived before the app reported the purchase). Never acknowledged until attributed, Google
-- refunds unattributed purchases automatically after three days.
CREATE TABLE billing_orphans (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    token_hash CHAR(64) NOT NULL,
    token_cipher TEXT NOT NULL,
    account_hash VARCHAR(64) NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_billing_orphan_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Idempotency keys plus audit trail (who, what, state before and after).
CREATE TABLE billing_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_key VARCHAR(128) NOT NULL,
    subscription_id BIGINT UNSIGNED NULL,
    actor_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(40) NOT NULL,
    from_state VARCHAR(32) NULL,
    to_state VARCHAR(32) NULL,
    detail VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_billing_event_key (event_key),
    KEY idx_billing_event_subscription (subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Leases so only one API instance runs each background billing job at a time.
CREATE TABLE billing_jobs (
    name VARCHAR(40) NOT NULL,
    locked_until DATETIME NULL,
    owner VARCHAR(64) NULL,
    last_success_at DATETIME NULL,
    PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO billing_jobs (name) VALUES ('google-reconcile'), ('google-voided');
