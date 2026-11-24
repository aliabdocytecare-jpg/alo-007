-- Migration: Staff Password Reset via SMTP Email (DEC-068)
-- Adds reset_token_hash and reset_expires_at to staff_users table

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_staff_users_reset_token_hash
  ON staff_users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;
