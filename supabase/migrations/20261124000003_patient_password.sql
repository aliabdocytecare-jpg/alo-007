-- 20261124000003_patient_password.sql
-- DEC-078: Add password_hash column to patients table for direct password login & OTP reduction

ALTER TABLE patients ADD COLUMN IF NOT EXISTS password_hash text;
