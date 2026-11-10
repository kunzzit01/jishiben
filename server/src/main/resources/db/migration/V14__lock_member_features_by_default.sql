-- Owner decision 2026-11-10: member features are locked by default; the administrator can
-- still switch the lock off in the app. Only the column default changes here, so an existing
-- deployment keeps whatever the administrator has set.
ALTER TABLE billing_settings ALTER COLUMN gates_enabled SET DEFAULT TRUE;
