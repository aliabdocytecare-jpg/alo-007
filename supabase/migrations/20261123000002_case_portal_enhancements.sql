-- AloDoc Phase 1: Case Portal Enhancements (DEC-056)
-- Triage AI summary, multi-round specialist reviews, report request checklists, 3-step final reports.

-- 1. Extend cases with AI summary, handoff tracking, and final reports
alter table cases add column if not exists ai_summary_en jsonb;
alter table cases add column if not exists ai_summary_ar jsonb;
alter table cases add column if not exists ai_summary_status text not null default 'none' check (ai_summary_status in ('none','draft','approved'));
alter table cases add column if not exists ai_summary_approved_by text;
alter table cases add column if not exists ai_summary_approved_at timestamptz;
alter table cases add column if not exists hospital_handoff jsonb;
alter table cases add column if not exists handoff_history jsonb not null default '[]'::jsonb;
alter table cases add column if not exists final_report_en text;
alter table cases add column if not exists final_report_ar text;
alter table cases add column if not exists final_report_published boolean not null default false;
alter table cases add column if not exists final_report_published_at timestamptz;

-- 2. case_reviews (Multi-Round Specialist Reviews with Decision Chips and Then-vs-Now Snapshot)
create table if not exists case_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null constraint case_reviews_case_id_fkey references cases(id) on delete cascade,
  specialist_id uuid constraint case_reviews_specialist_id_fkey references staff_users(id) on delete set null,
  specialist_name text,
  round_number int not null default 1,
  request_type text not null default 'fresh_case' check (request_type in ('fresh_case','additional_reports','second_review','meeting_request','post_meeting_review','follow_up')),
  request_note text,
  decision_chips jsonb not null default '{}'::jsonb,
  clinical_findings text,
  diagnostic_assessment text,
  recommendations text,
  follow_up_guidance text,
  opinion_ar jsonb,
  voice_note_path text,
  case_snapshot jsonb,
  magic_token_hash text unique,
  token_expires_at timestamptz,
  opened_at timestamptz,
  status text not null default 'pending' check (status in ('pending','submitted','expired','revoked')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists case_reviews_case_idx on case_reviews(case_id, round_number);
create index if not exists case_reviews_token_idx on case_reviews(magic_token_hash);

-- 3. case_reports_requests (Itemized missing document checklist sent to patients)
create table if not exists case_reports_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null constraint case_reports_requests_case_id_fkey references cases(id) on delete cascade,
  requested_by uuid constraint case_reports_requests_requested_by_fkey references staff_users(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'pending' check (status in ('pending','partially_fulfilled','fulfilled','cancelled')),
  token_hash text unique,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists case_reports_req_case_idx on case_reports_requests(case_id);

-- Triggers & RLS
create trigger case_reviews_updated before update on case_reviews for each row execute function set_updated_at();
create trigger case_reports_requests_updated before update on case_reports_requests for each row execute function set_updated_at();

alter table case_reviews enable row level security;
alter table case_reports_requests enable row level security;
