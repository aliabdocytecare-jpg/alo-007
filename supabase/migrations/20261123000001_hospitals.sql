-- AloDoc Phase 1: Hospital Day-Clinic Tenancy (DEC-056)
-- Single project, multi-tenant hospital clinic island on Supabase PostgreSQL.

-- 1. hospitals
create table if not exists hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  short_name text,
  city text not null,
  address text,
  phone text,
  timezone text not null default 'Asia/Riyadh',
  logo_url text,
  primary_color text,
  kiosk_pin text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. hospital_patients (Physical day-clinic patients scoped to a hospital)
create table if not exists hospital_patients (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  patient_id uuid references patients(id) on delete set null,
  mrn text not null,
  full_name text not null,
  phone text,
  dob date,
  age_years int,
  gender text check (gender in ('MALE','FEMALE','OTHER')),
  address text,
  medical_history text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, hospital_id),
  unique (hospital_id, mrn)
);
create index if not exists hospital_patients_phone_idx on hospital_patients(hospital_id, phone);

-- 3. hospital_cases (Day-clinic physical consultations and remote referrals)
create table if not exists hospital_cases (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  hospital_patient_id uuid not null,
  alo_case_id uuid references cases(id) on delete set null,
  alo_case_number text,
  case_number text not null,
  checkin_code text not null unique,
  queue_number text,
  source text not null default 'hospital' check (source in ('hospital','alo_doctor')),
  service_type text not null default 'in_person' check (service_type in ('in_person','online','intl_opinion_followup')),
  requested_specialty text,
  status text not null default 'new' check (status in ('new','in_consultation','pending_lab','pending_pharmacy','completed','cancelled')),
  arrival_status text not null default 'scheduled' check (arrival_status in ('scheduled','arrived','in_clinic','done','no_show')),
  arrived_at timestamptz,
  in_clinic_at timestamptz,
  assigned_doctor_id uuid references staff_users(id) on delete set null,
  case_summary text not null,
  patient_question text,
  nurse_interview_summary text,
  doctor_opinion text,
  follow_up text,
  appointment_date date,
  appointment_time text,
  visit_type text not null default 'visit' check (visit_type in ('visit','online')),
  general_consent boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, hospital_id),
  unique (hospital_id, case_number),
  foreign key (hospital_patient_id, hospital_id) references hospital_patients(id, hospital_id) on delete restrict
);
create index if not exists hospital_cases_hosp_status_idx on hospital_cases(hospital_id, status);
create index if not exists hospital_cases_hosp_arrival_idx on hospital_cases(hospital_id, arrival_status);
create index if not exists hospital_cases_hosp_date_idx on hospital_cases(hospital_id, appointment_date);
create index if not exists hospital_cases_alo_case_idx on hospital_cases(alo_case_id);

-- 4. hospital_case_timeline
create table if not exists hospital_case_timeline (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  hospital_case_id uuid not null,
  from_status text,
  to_status text,
  arrival_status text,
  actor_id uuid,
  actor_role text,
  note text,
  created_at timestamptz not null default now(),
  foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id) on delete cascade
);
create index if not exists hospital_timeline_case_idx on hospital_case_timeline(hospital_case_id, created_at desc);

-- 5. hospital_documents
create table if not exists hospital_documents (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  hospital_case_id uuid not null,
  uploader_id uuid,
  uploader_role text,
  category text not null check (category in ('lab_report','radiology','prescription','clinical_note','intl_opinion','other')),
  file_name text not null,
  file_type text not null,
  file_size int not null,
  storage_path text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id) on delete cascade
);
create index if not exists hospital_documents_case_idx on hospital_documents(hospital_case_id);

-- 6. hospital_slot_templates & hospital_slots
create table if not exists hospital_slot_templates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  doctor_id uuid not null references staff_users(id) on delete cascade,
  weekdays int[] not null default array[0,1,2,3,4]::int[],
  times text[] not null,
  duration_min int not null default 30,
  active boolean not null default true,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now()
);

create table if not exists hospital_slots (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  doctor_id uuid not null references staff_users(id) on delete cascade,
  date date not null,
  time text not null,
  duration_min int not null default 30,
  status text not null default 'free' check (status in ('free','booked','released','blocked')),
  hospital_case_id uuid,
  booked_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (hospital_id, doctor_id, date, time),
  foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id) on delete set null
);
create index if not exists hospital_slots_free_idx on hospital_slots(hospital_id, date, status);

-- 7. hospital_appointment_requests (2h SLA reception queue)
create table if not exists hospital_appointment_requests (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  hospital_case_id uuid not null,
  alo_case_number text,
  patient_first_name text not null,
  specialty text,
  doctor_id uuid references staff_users(id) on delete set null,
  preferred_dates date[] not null default array[]::date[],
  preferred_window text not null default 'any' check (preferred_window in ('morning','evening','any')),
  note text,
  status text not null default 'pending' check (status in ('pending','confirmed','proposed','declined','cancelled')),
  confirmed_date date,
  confirmed_time text,
  proposed_date date,
  proposed_time text,
  decline_reason text,
  handled_by uuid references staff_users(id),
  due_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id) on delete cascade
);
create index if not exists hospital_appt_req_due_idx on hospital_appointment_requests(hospital_id, status, due_at);

-- 8. hospital_test_catalogue
create table if not exists hospital_test_catalogue (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  name text not null,
  name_ar text,
  category text not null,
  specimen_type text not null,
  description text,
  parameters jsonb not null default '[]',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 9. hospital_lab_tests & comments
create table if not exists hospital_lab_tests (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  hospital_case_id uuid not null,
  hospital_patient_id uuid not null,
  test_catalogue_id uuid references hospital_test_catalogue(id) on delete set null,
  test_name text not null,
  specimen_type text not null,
  specimen_id text not null,
  priority text not null default 'routine' check (priority in ('routine','urgent','stat')),
  parameters jsonb not null default '[]',
  results jsonb not null default '{}',
  has_abnormal boolean not null default false,
  critical_result boolean not null default false,
  status text not null default 'requested' check (status in ('requested','collected','in_progress','resulted','verified','amended','cancelled')),
  result_status text not null default 'normal' check (result_status in ('normal','abnormal','critical')),
  amendment_reason text,
  previous_versions jsonb not null default '[]',
  report_path text,
  notes text,
  requested_by uuid not null references staff_users(id),
  requested_at timestamptz not null default now(),
  completed_by uuid references staff_users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, hospital_id),
  foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id) on delete cascade,
  foreign key (hospital_patient_id, hospital_id) references hospital_patients(id, hospital_id) on delete restrict
);
create index if not exists hospital_lab_tests_case_idx on hospital_lab_tests(hospital_case_id);
create index if not exists hospital_lab_tests_status_idx on hospital_lab_tests(hospital_id, status);

create table if not exists hospital_lab_comments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  hospital_lab_test_id uuid not null,
  author_id uuid not null references staff_users(id),
  text text not null,
  created_at timestamptz not null default now(),
  foreign key (hospital_lab_test_id, hospital_id) references hospital_lab_tests(id, hospital_id) on delete cascade
);

-- 10. hospital_medications
create table if not exists hospital_medications (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete restrict,
  hospital_case_id uuid not null,
  drug_name text not null,
  dosage text not null,
  frequency text not null,
  duration_days int not null default 7,
  instructions text,
  dispense_status text not null default 'prescribed' check (dispense_status in ('prescribed','dispensed','partial','cancelled')),
  dispense_note text,
  doctor_id uuid not null references staff_users(id),
  dispensed_by uuid references staff_users(id),
  dispensed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id) on delete cascade
);
create index if not exists hospital_meds_case_idx on hospital_medications(hospital_case_id);
create index if not exists hospital_meds_dispense_idx on hospital_medications(hospital_id, dispense_status);

-- Updated_at triggers
create trigger hospitals_updated before update on hospitals for each row execute function set_updated_at();
create trigger hospital_patients_updated before update on hospital_patients for each row execute function set_updated_at();
create trigger hospital_cases_updated before update on hospital_cases for each row execute function set_updated_at();
create trigger hospital_appt_req_updated before update on hospital_appointment_requests for each row execute function set_updated_at();
create trigger hospital_lab_tests_updated before update on hospital_lab_tests for each row execute function set_updated_at();
create trigger hospital_medications_updated before update on hospital_medications for each row execute function set_updated_at();

-- RLS: deny all direct client access
alter table hospitals enable row level security;
alter table hospital_patients enable row level security;
alter table hospital_cases enable row level security;
alter table hospital_case_timeline enable row level security;
alter table hospital_documents enable row level security;
alter table hospital_slot_templates enable row level security;
alter table hospital_slots enable row level security;
alter table hospital_appointment_requests enable row level security;
alter table hospital_test_catalogue enable row level security;
alter table hospital_lab_tests enable row level security;
alter table hospital_lab_comments enable row level security;
alter table hospital_medications enable row level security;
