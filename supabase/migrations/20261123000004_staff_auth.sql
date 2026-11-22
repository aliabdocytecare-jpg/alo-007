-- AloDoc Phase 1: Staff Identity, Tenancy & WhatsApp Auth (DEC-056)

-- 1. Alter staff_users for hospital staff (WhatsApp OTP authentication)
alter table staff_users add column if not exists hospital_id uuid references hospitals(id) on delete restrict;
alter table staff_users add column if not exists phone_e164 text;
alter table staff_users add column if not exists phone_verified_at timestamptz;
alter table staff_users add column if not exists preferred_lang text default 'en';

-- Backfill phone_e164 from existing phone numbers
update staff_users set phone_e164 = phone where phone is not null and phone_e164 is null;

-- Relax email and password_hash for hospital staff (who use OTP only)
alter table staff_users alter column email drop not null;
alter table staff_users alter column password_hash drop not null;

-- Drop old email unique constraint if exists and recreate as partial unique index
alter table staff_users drop constraint if exists staff_users_email_key;
create unique index if not exists staff_users_email_idx on staff_users(email) where email is not null;

-- Global partial unique index on phone_e164 across all staff
create unique index if not exists staff_users_phone_e164_idx on staff_users(phone_e164) where phone_e164 is not null;

-- Update role check constraint
alter table staff_users drop constraint if exists staff_users_role_check;
alter table staff_users add constraint staff_users_role_check check (
  role in ('nurse','coordinator','doctor','admin','hospital_admin','reception','lab','pharmacy')
);

-- Tenant role integrity: ALO staff must have hospital_id null, hospital staff must have hospital_id not null
alter table staff_users drop constraint if exists staff_users_tenant_check;
alter table staff_users add constraint staff_users_tenant_check check (
  (hospital_id is null and role in ('admin','coordinator','nurse','doctor')) or
  (hospital_id is not null and role in ('hospital_admin','doctor','reception','lab','pharmacy'))
);

-- 2. Alter notifications for hospital tenancy and role targeting
alter table notifications add column if not exists hospital_id uuid references hospitals(id) on delete cascade;
alter table notifications add column if not exists target_role text;
create index if not exists notifications_hosp_role_idx on notifications(hospital_id, target_role, is_read);

-- 3. Alter audit_log for hospital tenancy
alter table audit_log add column if not exists hospital_id uuid references hospitals(id) on delete cascade;
create index if not exists audit_log_hosp_idx on audit_log(hospital_id, created_at desc);

-- 4. Alter magic_link_tokens to support international opinion requests alongside cases
alter table magic_link_tokens alter column case_id drop not null;
alter table magic_link_tokens add column if not exists opinion_request_id uuid references international_opinion_requests(id) on delete cascade;
alter table magic_link_tokens drop constraint if exists chk_magic_link_subject;
alter table magic_link_tokens add constraint chk_magic_link_subject check (
  (case_id is not null and opinion_request_id is null) or
  (case_id is null and opinion_request_id is not null)
);
