-- Migration: 20261124000001_staff_email_verification.sql
-- Adds email verification status, token hashing, and timestamp columns for staff accounts (DEC-067).

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activation_token_hash text,
  ADD COLUMN IF NOT EXISTS activation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Backfill existing staff accounts (like ALO Super Admin) as verified
UPDATE staff_users
SET email_verified = true, email_verified_at = now()
WHERE email_verified = false AND password_hash != 'PENDING_ACTIVATION';
