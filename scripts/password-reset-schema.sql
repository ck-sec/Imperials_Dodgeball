-- Additive recovery-only migration; run with migrate-password-reset.js after a backup.
-- Requires the existing users, refresh_tokens and login_attempts auth schema.
-- Never run the old full schema.sql migration: it rewrites membership approval.
-- A member has at most one outstanding token. Only its SHA-256 digest is stored.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry ON password_reset_tokens(expires_at);
