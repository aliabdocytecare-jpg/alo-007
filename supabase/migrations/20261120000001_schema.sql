-- AloDoc initial schema — Product Bible v1.0 (Supabase PostgreSQL)
create extension if not exists pgcrypto;

create table patients (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  full_name text not null,
  dob date,
  gender text check (gender in ('MALE','FEMALE')),
  nationality text,
  email text,
  preferred_lang text default 'en',
  created_at timestamptz not null default now()
);

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null check (role in ('nurse','coordinator','doctor','admin')),
  full_name text not null,
  phone text,
  specialty text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table specialties (
  id uuid primary key default gen_random_uuid(),
  name_en text unique not null,
  name_ar text,
  is_active boolean not null default true
);

create table services (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_en text not null,
  name_ar text,
  is_active boolean not null default true,
  coming_soon boolean not null default false
);

create sequence case_number_seq start 1;
create or replace function next_case_number() returns text language sql as $$
  select 'ALO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('case_number_seq')::text, 5, '0');
$$;

create table cases (
  id uuid primary key default gen_random_uuid(),
  case_number text unique not null default next_case_number(),
  patient_id uuid not null constraint cases_patient_id_fkey references patients(id),
  service_type text not null check (service_type in ('CONSULTATION','GMO','SERVICE')),
  service_subtype text,
  specialty text,
  purpose text,
  reason text,
  history jsonb not null default '{}',
  status text not null default 'SUBMITTED',
  owner_id uuid constraint cases_owner_id_fkey references staff_users(id),
  owner_role text,
  sla_due_at timestamptz,
  sla_alerted boolean not null default false,
  next_action text,
  parent_case_id uuid constraint cases_parent_case_id_fkey references cases(id),
  payment_confirmed boolean not null default false,
  payment_note text,
  document_request_note text,
  intake_completed boolean not null default false,
  follow_up_recommended boolean not null default false,
  follow_up_note text,
  escalated boolean not null default false,
  cancel_reason text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cases_patient_idx on cases(patient_id);
create index cases_status_idx on cases(status);
create index cases_sla_idx on cases(sla_due_at);

create table case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null constraint case_assignments_case_id_fkey references cases(id),
  staff_id uuid not null constraint case_assignments_staff_id_fkey references staff_users(id),
  role text not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  unique (case_id, staff_id)
);
create index case_assignments_staff_idx on case_assignments(staff_id);

create table case_timeline (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null constraint case_timeline_case_id_fkey references cases(id),
  from_status text,
  to_status text,
  actor_id uuid,
  actor_role text,
  note text,
  patient_visible boolean not null default true,
  message_en text,
  message_ar text,
  created_at timestamptz not null default now()
);
create index case_timeline_case_idx on case_timeline(case_id, created_at);

create table documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null constraint documents_case_id_fkey references cases(id),
  uploader_id uuid,
  uploader_role text,
  category text default 'Other',
  file_name text not null,
  file_type text,
  file_size bigint,
  storage_path text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index documents_case_idx on documents(case_id);

create table consultations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid unique not null constraint consultations_case_id_fkey references cases(id),
  doctor_id uuid constraint consultations_doctor_id_fkey references staff_users(id),
  consultation_type text check (consultation_type in ('ONLINE','IN_PERSON')),
  scheduled_at timestamptz,
  clinic_name text,
  clinic_address text,
  meet_url text,
  notes_draft jsonb not null default '{}',
  notes_updated_at timestamptz,
  final_report text,
  submitted_at timestamptz,
  released_at timestamptz,
  released_by uuid,
  reminder_sent boolean not null default false,
  follow_up_recommended boolean not null default false,
  follow_up_timeframe text,
  follow_up_type text,
  follow_up_reason text
);

create table vitals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null constraint vitals_case_id_fkey references cases(id),
  nurse_id uuid,
  blood_pressure text,
  heart_rate int,
  temperature numeric,
  weight numeric,
  height numeric,
  spo2 int,
  nursing_notes text,
  created_at timestamptz not null default now()
);

create table magic_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  case_id uuid not null constraint magic_link_tokens_case_id_fkey references cases(id),
  specialist_name text,
  specialist_phone text,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  opened_at timestamptz,
  draft_saved_at timestamptz,
  submitted_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz
);
create index magic_link_case_idx on magic_link_tokens(case_id);

create table international_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid unique not null constraint international_reviews_case_id_fkey references cases(id),
  findings text,
  recommendation text,
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED')),
  submitted_at timestamptz,
  released_at timestamptz,
  released_by uuid,
  updated_at timestamptz not null default now()
);

create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null constraint prescriptions_case_id_fkey references cases(id),
  doctor_id uuid,
  drug_name text not null,
  dosage text,
  frequency text,
  duration text,
  route text,
  special_instructions text,
  source text not null check (source in ('FORMULARY','FREE_TEXT')),
  formulary_id uuid,
  created_at timestamptz not null default now()
);

create table drug_formulary (
  id uuid primary key default gen_random_uuid(),
  generic_name text not null,
  brand_name text,
  common_dosages text[] not null default '{}',
  route text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('patient','staff','specialist')),
  recipient_id uuid,
  case_id uuid,
  event_type text not null,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on notifications(recipient_type, recipient_id, is_read);

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  recipient_type text,
  recipient_id uuid,
  case_id uuid,
  channel text not null,
  template_id text,
  delivery_status text not null default 'sent',
  failure_reason text,
  retry_count int not null default 0,
  detail jsonb,
  sent_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  action text not null,
  resource_type text,
  resource_id uuid,
  detail jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log(created_at desc);

create table sla_config (
  status text primary key,
  target_minutes int not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table system_settings (
  key text primary key,
  value text not null
);

-- updated_at triggers
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger cases_updated before update on cases for each row execute function set_updated_at();
create trigger formulary_updated before update on drug_formulary for each row execute function set_updated_at();

-- Private storage bucket for case documents (F-CASE-05)
insert into storage.buckets (id, name, public)
values ('case-documents','case-documents', false)
on conflict (id) do nothing;

-- RLS: deny all direct client access. Express (service role) is the only gate. (P2, BR-003..006)
alter table patients enable row level security;
alter table staff_users enable row level security;
alter table specialties enable row level security;
alter table services enable row level security;
alter table cases enable row level security;
alter table case_assignments enable row level security;
alter table case_timeline enable row level security;
alter table documents enable row level security;
alter table consultations enable row level security;
alter table vitals enable row level security;
alter table magic_link_tokens enable row level security;
alter table international_reviews enable row level security;
alter table prescriptions enable row level security;
alter table drug_formulary enable row level security;
alter table notifications enable row level security;
alter table notification_log enable row level security;
alter table audit_log enable row level security;
alter table sla_config enable row level security;
alter table system_settings enable row level security;