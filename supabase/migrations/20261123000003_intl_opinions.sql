-- AloDoc Phase 1: International Opinion Bridge (DEC-056)
-- Curated global specialists and Saudi hospital doctor second opinion requests.

-- 1. international_specialists (ALO platform-wide specialist directory)
create table if not exists international_specialists (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_e164 text,
  email text,
  specialty text not null,
  sub_specialty text,
  institution text,
  country text not null,
  languages text[] not null default array['en']::text[],
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intl_spec_specialty_idx on international_specialists(specialty);

-- 2. international_opinion_requests (Bridging Saudi hospital cases to global specialists)
create table if not exists international_opinion_requests (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  hospital_case_id uuid not null,
  requested_by uuid not null references staff_users(id) on delete restrict,
  specialty text not null,
  clinical_question text not null,
  consented_at timestamptz not null default now(),
  consented_by_name text not null,
  assigned_specialist_id uuid references international_specialists(id) on delete set null,
  alo_handler_id uuid references staff_users(id) on delete set null,
  magic_token_hash text unique,
  token_expires_at timestamptz,
  due_at timestamptz not null default (now() + interval '72 hours'),
  status text not null default 'requested' check (status in ('requested','assigned','sent','submitted','forwarded','cancelled')),
  opinion_text text,
  recommendations text,
  decision_chips jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, hospital_id),
  foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id) on delete cascade
);
create index if not exists intl_opinion_hosp_idx on international_opinion_requests(hospital_id, status);
create index if not exists intl_opinion_due_idx on international_opinion_requests(status, due_at);

-- Triggers & RLS
create trigger intl_specialists_updated before update on international_specialists for each row execute function set_updated_at();
create trigger intl_opinions_updated before update on international_opinion_requests for each row execute function set_updated_at();

alter table international_specialists enable row level security;
alter table international_opinion_requests enable row level security;
