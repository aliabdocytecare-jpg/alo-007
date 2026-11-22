# AloDoc — Hospital Portal Native Port: Implementation Plan

Status: decided, ready to build. Source of the design conversation: Nov 22, 2026.
Companion documents: `decisions.md` (DEC-056 to be added), `PLAN.md` (original 10-phase build), `TESTING.md`.

This document is self-contained. A new session can start from section 19 ("Bootstrap prompt") and work from here without the prior conversation.

---

## 1. What we are doing

The hospital portal that exists today as a Base44 application (`aliabdocytecare-jpg/alo-doctor-hospital-portal`) is rebuilt **natively inside AloDoc**: same Supabase project, same Express API, same React client.

- The Base44 app stays exactly as it is — untouched, read-only, a behavioural reference. No runtime dependency in either direction.
- No records are imported. The hospital module starts empty.
- Everything additive. No existing table is renamed, and nothing existing is dropped.

Why native rather than API-to-API: there is no second datastore to keep consistent, so slot claiming, case creation, and check-in each become one Postgres transaction instead of a network conversation with idempotency keys, retries, and an outbox.

---

## 2. Locked decisions

| # | Decision | Reason |
|---|---|---|
| D1 | Port, do not integrate | One datastore, no distributed failure modes |
| D2 | `hospital_cases` is a separate table, never folded into `cases` | Different lifecycle; folding would corrupt both machines |
| D3 | Hospital is self-contained at launch ("island") | No ALO case routing, no cross-surface case access, no patient-portal visibility of hospital visits |
| D4 | One exception bridge: international opinion request | Saudi doctor must be able to request an international opinion on behalf of a patient |
| D5 | ALO `admin` creates `hospital_admin`; `hospital_admin` creates its own staff | Two creation cascades only; no self-registration |
| D6 | Hard tenant isolation — one hospital can never read another's data | Composite FKs, not just query filters |
| D7 | Hospital staff authenticate by WhatsApp OTP only — no passwords | Per-person PINs are shared secrets with no proof of identity |
| D8 | `hospital_admin` is never granted ALO `admin` or `coordinator` semantics | A single `requireCaseAccess` branch would expose every AloDoc case |
| D9 | One doctor belongs to one hospital; staff phone is globally unique | Explicit product decision; message wording fixed in D10 |
| D10 | Duplicate phone message: "This number is already part of our system, please provide a different number." | Must never name the other hospital, identical for active and inactive holders |
| D11 | Staff↔patient phone overlap is allowed; login shows a role chooser | Clinicians get treated too; blocking their own record is the worse failure |
| D12 | Hospital reception owns in-person appointment decisions (2h SLA), zero clinical visibility | Matches the portal's real workflow |
| D13 | International specialists are an ALO-admin-curated directory; no login, magic link only | Admin enters once; picked wherever needed |
| D14 | Nurse may also pick international specialists (recommended; confirm) | Nurse does intake and knows the fit |
| D15 | Monochrome UI; hospital branding by typography only | Existing project constraint |
| D16 | No per-stage gating, no separate local database, single `main` branch | DEC-054, DEC-055 |

---

## 3. Scope

**In:** hospital tenancy, hospital patients (MRN), hospital cases, arrival and queue, slot templates and slots, appointment requests and reception decisions, doctor intake and opinion, hospital documents, lab tests and comments, pharmacy dispensing, test catalogue, kiosk and waiting screens, public patient view, staff auth and staff management, international opinion requests, ALO admin hospital management, ALO coordinator request queue.

**Out (deliberately):** ALO→hospital case routing, hospital→ALO case creation, status mapping between the two case machines, hospital doctors holding ALO cases, hospital visits appearing in the patient portal, data import from Base44, billing/payments, insurance, SMS channel, per-hospital custom themes, cross-hospital doctor identity.

---

## 4. Personas

Nine account-bearing personas plus one token-only persona.

| Persona | Created by | Scope | Login |
|---|---|---|---|
| `patient` | self | own cases | phone + OTP (existing) |
| ALO `admin` | bootstrap script / another admin | platform-wide | email + password (existing) |
| ALO `coordinator` | ALO admin | all AloDoc cases | email + password |
| ALO `nurse` | ALO admin | assigned AloDoc cases | email + password |
| ALO `doctor` | ALO admin | assigned AloDoc cases | email + password |
| `hospital_admin` | ALO admin | one hospital | phone + OTP |
| hospital `doctor` | hospital_admin | own hospital cases | phone + OTP |
| `reception` | hospital_admin | queue, check-in, appointment decisions; no clinical fields | phone + OTP |
| `lab` | hospital_admin | lab module | phone + OTP |
| `pharmacy` | hospital_admin | dispensing | phone + OTP |
| international specialist | ALO admin (directory entry) | one case payload per token | magic link, no account |

Rules: deactivate, never delete. The last active ALO `admin` cannot be deactivated (DEC-045, already implemented). `hospital_admin` cannot be created by another `hospital_admin`.

---

## 5. Authentication and identity

### 5.1 Flows

**Hospital staff (OTP only)**
1. `POST /auth/staff/otp/send { phone }` — normalise to E.164, look up `staff_users` by `phone_e164`, rate limit 5/hour per phone, send the already-APPROVED WhatsApp `otp_verification` template (ar / en_US by `preferred_lang`).
2. `POST /auth/staff/otp/verify { phone, otp }` — 5 wrong attempts → 15-minute lock; OTP valid 10 minutes.
3. One staff row → issue session `{ sub, role, kind: 'staff', hospital_id }`.
4. Two accounts on the same phone (staff + patient) → `{ needsRole: true, options: ['patient', 'staff'] }`; `POST /auth/choose-role { challenge, role }` issues the chosen session.
5. Zero rows, or inactive staff, or inactive hospital → `403` with one generic message: "This number cannot sign in. Please contact your administrator."

**ALO staff (unchanged)** — `POST /auth/staff-login { email, password }`, bcrypt, 5 fails → 15-minute lock, admins notified on the 3rd failure.

**Break-glass** — `POST /admin/staff/:id/login-link` issues a single-use, 30-minute, hashed link bound to `staff_id`. For WABA outages and doctors without WhatsApp. Audited as `STAFF_LOGIN_LINK_ISSUED`.

**Kiosk** — device pairing only. `hospitals.kiosk_pin` authorises the kiosk to read its own hospital's queue and create check-ins. It grants no person identity and no clinical data.

### 5.2 Phone number lifecycle

| State | Meaning | Transition authority |
|---|---|---|
| `available` | no row holds it | — |
| `reserved` | staff row created, possession unproven (`phone_verified_at` null) | hospital_admin edits or deletes |
| `verified` | first successful OTP login | — |
| `inactive` | staff deactivated, number still held | reactivate, or release |
| `released` | nulled on the old row, audit retained | ALO admin, or OTP self-claim |

- **Unverified + inactive** → released automatically when a hospital tries to reuse it. Nothing to protect.
- **Verified + inactive** → released by ALO admin (`POST /admin/staff/:id/release-phone`, refuses while active) or by OTP self-claim (`POST /auth/staff/claim-phone`), which proves possession of the SIM.
- **Active holder** → never releasable by claim. An employee cannot be displaced by whoever currently holds a recycled number.
- **Phone change while employed** → update, audit `STAFF_PHONE_CHANGED {old, new}`, reset `phone_verified_at`, old number becomes available immediately.

### 5.3 Duplicate rule

Global partial unique index on `staff_users.phone_e164` across all rows, inactive included. Enforced twice: a shared `assertStaffPhoneAvailable(phoneE164, excludeId)` used by every create/edit path, and the index itself with Postgres `23505` mapped to the same response.

Response: `409 { error: 'phone_taken', message: 'This number is already part of our system, please provide a different number.' }` — Arabic: `هذا الرقم مسجل بالفعل في النظام، يرجى استخدام رقم آخر.`

The message never names the hospital and never distinguishes active from inactive holders; staff creation is rate-limited per admin and every rejection writes `STAFF_PHONE_REJECTED`.

Canonical storage is mandatory before the index exists: `toE164(input, defaultCountry = 'SA')` strips separators, maps `05XXXXXXXX` → `+9665XXXXXXXX`, rejects non-mobiles. Backfill runs first; if the backfill hits a collision the migration **aborts** rather than guessing.

### 5.4 Session model

- One httpOnly cookie (`COOKIE`), one active session per browser. Switching role is a logout and a fresh OTP; no dual-session scheme.
- Claims: `{ sub, role, kind, hospital_id }`. `hospital_id` is present only for hospital staff.
- `resolveSession` re-reads the staff row on each request (PK lookup, short cache) so deactivation and phone release take effect immediately, not at token expiry.
- TTL: ALO staff and hospital staff 8 hours.

### 5.5 Guards — the rule that keeps isolation real

| Guard | Applies to | Behaviour |
|---|---|---|
| `requireAuth` | everything private | existing |
| `requireRole(...)` | existing ALO routes | unchanged |
| `requireALOStaff` | `/api/v1/admin/*`, `/api/v1/cases/*` | `hospital_id` must be null |
| `requireHospitalMember` | `/api/v1/hospital/*` **only** | re-reads staff row, asserts active, asserts `hospital_id` matches tenant, asserts `hospitals.is_active`, sets `req.tenant` |
| `requireHospitalRole(...)` | hospital sub-modules | role within the tenant |
| `loadHospitalCase` | `/hospital/cases/:id` | fetch by id **and** `hospital_id`; mismatch → 404, not 403 |
| `scoped(req, table)` | every hospital query | throws when `req.tenant` is missing |

`requireHospitalMember` is mounted **per route group**. Mounting it globally would lock hospital doctors out of anything else; making `/staff/*` tenant-aware would leak hospital B into hospital A.

---

## 6. Data model

### 6.1 Alters (3 tables, in this order)

1. `hospitals` must exist first (new table below), then:
2. `staff_users`:
   - add `hospital_id uuid null references hospitals(id)`
   - add `phone_e164 text`, `phone_verified_at timestamptz`, `preferred_lang text default 'en'`
   - `email` becomes nullable (hospital staff have none); `password_hash` becomes nullable
   - drop the old `email unique` constraint and recreate as a partial unique index `where email is not null`
   - extend the role check to `('nurse','coordinator','doctor','admin','hospital_admin','reception','lab','pharmacy')`
   - unique indexes: `(phone_e164) where phone_e164 is not null`; backfill and normalise before creating it
   - constraint: `hospital_id is null` for ALO roles, `not null` for hospital roles
3. `notifications`: add `hospital_id uuid null`, `target_role text null` (one bell for both worlds; existing patient/staff rows unaffected)
4. `audit_log`: add `hospital_id uuid null` (index on `(hospital_id, created_at desc)`)
5. `magic_link_tokens`: `case_id` becomes nullable, add `opinion_request_id uuid null references international_opinion_requests(id)`, add check `(case_id is null) <> (opinion_request_id is null)` — exactly one subject. The table is empty in production, so this carries no data risk.

No new grants are needed: `20261120000003_grants.sql` sets default privileges for future tables.

### 6.2 New tables

All hospital tables carry `hospital_id` and are RLS-enabled deny-all, reached only through Express with the service role.

**`hospitals`** — id, name, name_ar, short_name, city, address, phone, timezone default `Asia/Riyadh`, logo_url, primary_color, kiosk_pin (unique, nullable), is_active, created_at.

**`hospital_patients`** — id, hospital_id, patient_id (nullable; **not populated in this phase**), mrn, full_name, phone, dob, age_years, gender, address, medical_history, created_at.
Constraints: `unique(hospital_id, mrn)`, index `(hospital_id, phone)`.

**`hospital_cases`** — id, hospital_id, hospital_patient_id, case_number (`C-0001`), checkin_code (6 chars, unique), queue_number, source (`hospital`), service_type, requested_specialty, status, arrival_status, arrived_at, in_clinic_at, assigned_doctor_id, case_summary, patient_question, nurse_interview_summary, doctor_opinion, follow_up, appointment_date, appointment_time, visit_type, general_consent, version, created_at, updated_at.
Constraints: `unique(id, hospital_id)`, `unique(hospital_id, case_number)`, `unique(checkin_code)`.
Numbering: advisory lock per hospital + `max(case_number)+1`, never a global sequence.
Not present in this phase (added later with the routing bridge): `alo_case_id`, `alo_case_number`, `ai_summary`, `alo_attachments`.

**`hospital_case_timeline`** — id, hospital_id, hospital_case_id, from_status, to_status, arrival_status, actor_id, actor_role, note, created_at. Append-only.

**`hospital_documents`** — id, hospital_id, hospital_case_id, uploader_id, uploader_role, category, file_name, file_type, file_size, storage_path, is_deleted, created_at.
Storage: single private bucket `case-documents`, path `hospitals/<hospital_id>/<hospital_case_id>/<uuid>.<ext>`. The existing `documents` table is not reused: its `case_id` is FK-bound to `cases(id)`.

**`hospital_slot_templates`** — id, hospital_id, doctor_id, weekdays int[], times text[], duration_min, active, valid_from, valid_to.

**`hospital_slots`** — id, hospital_id, doctor_id, date, time, duration_min, status (`free|booked|released|blocked`), hospital_case_id, booked_at, released_at.
Constraint: **`unique(hospital_id, doctor_id, date, time)`** — this single index replaces the portal's claim-before-write choreography.

**`hospital_appointment_requests`** — id, hospital_id, hospital_case_id, patient_first_name, specialty, doctor_id, preferred_dates date[], preferred_window, note, status (`requested|confirmed|proposed|declined|cancelled`), confirmed_date, confirmed_time, proposed_date, proposed_time, decline_reason, handled_by, due_at, created_at.

**`hospital_test_catalogue`** — id, hospital_id, name, description, category, specimen_type, parameters jsonb, is_active.

**`hospital_lab_tests`** — id, hospital_id, hospital_case_id, hospital_patient_id, test_catalogue_id, test_name, specimen_type, specimen_id, priority, parameters jsonb, results jsonb, has_abnormal, critical_result, status (`requested|collected|in_progress|resulted|verified|amended|cancelled`), result_status (`normal|abnormal|critical`), amendment_reason, previous_versions jsonb, report_path, notes, requested_by, requested_at, completed_by, completed_at.

**`hospital_lab_comments`** — id, hospital_id, hospital_lab_test_id, author_id, text, created_at.

**`hospital_medications`** — id, hospital_id, hospital_case_id, drug_name, dosage, frequency, duration_days, instructions, dispense_status (`prescribed|dispensed|partial|cancelled`), dispense_note, doctor_id, created_at.

**`international_opinion_requests`** — id, hospital_id, hospital_case_id, requested_by, specialty, clinical_question, preferred_specialist_id, consented_at, consented_by_name, status (`requested|assigned|sent|submitted|forwarded|cancelled`), assigned_specialist_id, alo_handler_id, due_at, opinion_text, created_at, updated_at.

**`international_specialists`** (ALO-wide, no `hospital_id`) — id, full_name, phone_e164, specialty, institution, country, languages text[], notes, is_active, created_at.

### 6.3 Structural isolation

Every child row physically cannot reference another hospital's parent:

- parent tables expose `unique(id, hospital_id)`
- child tables declare `foreign key (hospital_case_id, hospital_id) references hospital_cases(id, hospital_id)`
- applied to: `hospital_case_timeline`, `hospital_documents`, `hospital_slots` (via case), `hospital_appointment_requests`, `hospital_lab_tests`, `hospital_medications`, `international_opinion_requests`
- `hospital_lab_comments` → `hospital_lab_tests(id, hospital_id)`

Query-level scoping remains the first defence; this is the one that survives a controller bug.

### 6.4 Codes

- `hospital_cases.case_number`: `C-0001`, per hospital, gap-free under advisory lock.
- `checkin_code`: 6 chars, uppercase alphanumerics excluding lookalikes (`O`,`0`,`I`,`1`), globally unique, created with the case.
- `queue_number`: integer for the day, assigned at check-in.
- MRN: entered by hospital, `unique(hospital_id, mrn)`.

### 6.5 Status vocabularies

| Entity | Values |
|---|---|
| case status | `new`, `in_consultation`, `pending_lab`, `pending_pharmacy`, `completed`, `cancelled` |
| arrival | `scheduled`, `arrived`, `in_clinic`, `done`, `no_show` |
| appointment request | `requested`, `confirmed`, `proposed`, `declined`, `cancelled` |
| lab | `requested`, `collected`, `in_progress`, `resulted`, `verified`, `amended`, `cancelled` |
| medication | `prescribed`, `dispensed`, `partial`, `cancelled` |
| opinion request | `requested`, `assigned`, `sent`, `submitted`, `forwarded`, `cancelled` |

Transitions live in one module (`server/services/hospitalStateMachine.js`) with an explicit map, mirroring the existing `stateMachine.js` style. No controller writes a status directly.

### 6.6 Audit events (new)

`HOSPITAL_CREATED`, `HOSPITAL_UPDATED`, `HOSPITAL_STAFF_CREATED`, `HOSPITAL_STAFF_DEACTIVATED`, `STAFF_PHONE_REJECTED`, `STAFF_PHONE_CHANGED`, `STAFF_PHONE_RELEASED`, `STAFF_PHONE_CLAIMED`, `STAFF_LOGIN_LINK_ISSUED`, `STAFF_LOGIN_OTP`, `LOGIN_ROLE_CHOSEN`, `HOSPITAL_PATIENT_CREATED`, `HOSPITAL_CASE_CREATED`, `HOSPITAL_CASE_STATUS`, `HOSPITAL_CHECKIN`, `SLOT_GENERATED`, `SLOT_BOOKED`, `SLOT_RELEASED`, `APPT_REQUEST_CREATED`, `APPT_DECISION`, `LAB_REQUESTED`, `LAB_RESULTED`, `MED_DISPENSED`, `INTL_OPINION_REQUESTED`, `INTL_OPINION_SUBMITTED`, `INTL_OPINION_FORWARDED`.

All hospital events carry `hospital_id` in `audit_log`.

---

## 7. API surface

Base path `/api/v1`. Every route lists its guard.

**Auth**
- `POST /auth/staff/otp/send` — public, rate-limited
- `POST /auth/staff/otp/verify` — public, rate-limited
- `POST /auth/choose-role` — public, challenge-bound
- `POST /auth/staff/claim-phone` — public, OTP-bound
- `POST /auth/staff-login` — existing (ALO email + password)

**ALO admin**
- `GET/POST /admin/hospitals`, `PATCH /admin/hospitals/:id` — `requireRole('admin')`
- `POST /admin/hospitals/:id/admins` — `requireRole('admin')`
- `POST /admin/staff/:id/release-phone` — `requireRole('admin')`
- `POST /admin/staff/:id/login-link` — `requireRole('admin')`
- `GET/POST/PATCH /admin/intl-specialists` — `requireRole('admin')`

**Hospital staff management**
- `GET/POST /hospital/staff`, `PATCH /hospital/staff/:id`, `PATCH /hospital/staff/:id/active` — `requireHospitalRole('hospital_admin')`
- `GET /hospital/doctors` — `requireHospitalMember`

**Hospital cases**
- `GET/POST /hospital/patients` — reception, doctor, hospital_admin
- `GET/POST /hospital/cases` — reception, doctor, hospital_admin
- `GET /hospital/cases/:id` — all hospital roles (serialiser strips clinical fields for reception/lab/pharmacy)
- `POST /hospital/cases/:id/opinion` — doctor (assigned), hospital_admin
- `POST /hospital/cases/:id/documents` — doctor, hospital_admin, reception

**Reception**
- `POST /hospital/reception/checkin` — reception (by code or case id)
- `GET /hospital/reception/queue` — reception, hospital_admin
- `POST /hospital/reception/arrival` — reception (`arrived`, `notify_doctor`, `done`)
- `GET/POST /hospital/appointment-requests` — reception, hospital_admin
- `POST /hospital/appointment-requests/:id/decision` — reception (`confirm|propose|decline`)

**Slots**
- `GET /hospital/slots`, `POST /hospital/slots/generate`, `POST /hospital/slots/:id/block`, `POST /hospital/slots/:id/release` — doctor (own), hospital_admin
- `GET/POST/PATCH /hospital/slot-templates` — hospital_admin

**Lab**
- `GET/POST /hospital/lab/tests`, `PATCH /hospital/lab/tests/:id`, `POST /hospital/lab/tests/:id/results`, `POST /hospital/lab/tests/:id/comments` — lab (+ doctor read)
- `GET/POST/PATCH /hospital/test-catalogue` — lab, hospital_admin

**Pharmacy**
- `GET /hospital/pharmacy/queue`, `POST /hospital/pharmacy/medications/:id/dispense` — pharmacy

**International opinion**
- `POST /hospital/cases/:id/intl-opinion` — doctor, hospital_admin
- `GET /hospital/intl-opinions` — doctor, hospital_admin
- `GET /staff/intl-opinions`, `POST /staff/intl-opinions/:id/assign`, `POST /staff/intl-opinions/:id/forward`, `POST /staff/intl-opinions/:id/cancel` — `requireRole('nurse','coordinator','admin')`
- `GET /review/intl/:token`, `POST /review/intl/:token/draft`, `POST /review/intl/:token/submit` — token only (public, like `/review/:token`)

**Public (no session, rate-limited, code-gated)**
- `GET /public/kiosk/:pin` — hospital branding + active doctors
- `GET /public/case/:code` — first name, doctor, appointment, arrival status only
- `GET /public/catalog/hospitals` — id, name, short_name, city, logo

**Ops**
- `GET /hospital/ops/kpis` — hospital_admin
- `POST /public/kiosk/:pin/checkin` — kiosk-created check-in (no patient identity beyond the code)

---

## 8. Client surface

Routing added to `client/src/App.jsx`; `/hospital/*` uses the existing `Guard` with the new roles.

| Route | Screen | Roles |
|---|---|---|
| `/login` | add a phone-OTP tab; auto-route `@` to password | public |
| `/hospital` | dashboard (today's queue, pending lab, pending pharmacy) | hospital_admin, doctor, reception, lab, pharmacy |
| `/hospital/cases`, `/hospital/cases/:id` | case list and case detail | per role |
| `/hospital/reception` | queue, check-in, appointment decisions | reception, hospital_admin |
| `/hospital/lab`, `/hospital/lab/:id` | lab bench and result entry | lab, doctor (read) |
| `/hospital/pharmacy` | dispensing queue | pharmacy |
| `/hospital/doctors/:id` | doctor's day, own slots | doctor |
| `/hospital/settings` | staff, slot templates, test catalogue, branding | hospital_admin |
| `/kiosk` | check-in by code, patient-facing | public |
| `/screen/waiting` | queue display | public |
| `/screen/management` | flow board | public |
| `/p/:code` | patient's own status page | public |
| `/admin/hospitals` | create hospitals, create hospital admins, KPI | ALO admin |
| `/admin/intl-specialists` | specialist directory | ALO admin |
| `/staff/intl-opinions` | request queue, assign, forward | nurse, coordinator, admin |

Non-negotiables for the client: monochrome palette, EN/AR with `dir=rtl` from `client/src/lib/i18n.jsx`, every Arabic string from the portal's functions and pages moved into i18n rather than hard-coded, one notification bell per session filtered by `recipient_id`, and a `Guard` for every non-public route.

---

## 9. The international opinion bridge

The only flow that crosses the two worlds. It is a request, not case routing.

1. Hospital doctor, inside a case: "Request international opinion" → specialty, clinical question (required), attachments (`hospital_documents`), optional preferred specialist, patient consent attestation (required, stored as `consented_at` + `consented_by_name`, immutable afterwards).
2. ALO coordinator/nurse queue `/staff/intl-opinions`: assign specialist from the directory, issue a 72-hour token (WhatsApp), SLA timer starts.
3. Specialist opens `/review/intl/:token` — no account — reads the payload, saves a draft, submits.
4. Delivery: `opinion_text` + a `hospital_documents` row (`category='intl_opinion'`), case timeline entry, notification to the requesting doctor. The doctor decides what to tell the patient.
5. Nothing else crosses.

**Disclosure contract** — the ALO side sees only: patient name, age, sex, MRN, the clinical question, the attached documents, the requesting doctor's name and hospital. Never lab results, medication, other patients, or the rest of the timeline. This is implemented as one serializer with an explicit comment; widening it later is a data-protection incident, not a refactor.

Reuse: `magic_link_tokens` generalised in 6.1, shared `reviewTokenService` for issue/expire/revoke/draft. No second token table, no duplicated crypto.

---

## 10. Background jobs

Extend the existing 60-second `tick()` in `server/index.js`:

- hourly: slot release sweep — `free` slots inside 24 hours → `released`
- nightly: slot generation — templates × 14-day horizon, skipping existing `(doctor, date, time)`
- hourly: appointment request SLA reminders (`due_at` approaching, still `requested`)
- daily: opinion request ageing (assigned but not sent within 48h → coordinator notification)
- existing jobs untouched: SLA, reminders, auto `IN_PROGRESS`, 6-hourly WhatsApp template drift

Every job is idempotent and writes `audit_log` with `actor_role='system'`.

---

## 11. Config and preflight

No new secrets. New optional env: `HOSPITAL_SLOT_HORIZON_DAYS` (default 14), `HOSPITAL_SLOT_RELEASE_HOURS` (default 24).

`server/scripts/preflight.mjs` gains read-only checks:
- `hospitals` reachable and at least one active row
- each `hospital_*` table reachable
- `staff_users.phone_e164` unique index present
- no staff row with `hospital_id` and a null `phone_e164`
- `case-documents` bucket accepts a `hospitals/` prefix
- static scan: every `from('hospital_` occurrence is inside a `scoped(` call

Failures exit 1, same as today.

---

## 12. Phases

Estimates assume one developer with the existing codebase.

### Phase 1 — Schema and isolation (1.5 days)
Deliverables: `supabase/migrations/20261123000001_hospitals.sql` (hospitals, hospital_*, international_specialists, international_opinion_requests), `20261123000002_staff_identity.sql` (staff alters, phone normalisation + backfill, unique indexes, notification/audit/magic-link alters), `server/lib/phone.js`.
Acceptance: migrations applied to `ovkxuzstzgixjtvkhadf`; `npm run preflight` passes; composite FKs reject a cross-hospital insert in a manual test; existing ALO flows still work (`/health`, admin login, catalog).

### Phase 2 — Auth, tenant control, staff management (1.5 days)
Deliverables: `middleware/hospitalAuth.js`, `lib/scope.js` (`scoped()`), auth endpoints (staff OTP, choose-role, claim-phone), staff CRUD for hospital_admin and ALO admin, release-phone, break-glass link, `resolveSession` re-read.
Acceptance: OTP login for a hospital doctor; duplicate phone blocked with the exact message; unverified and verified release paths; claim refused while active; role chooser for staff+patient; hospital A cannot read hospital B (manual `curl` matrix, 404 not 403).

### Phase 3 — Directory, slots, reception (2 days)
Deliverables: `hospitalSlotService.js`, hospitals/doctors/slot templates/slots endpoints, reception queue and check-in, appointment requests and decisions, kiosk/public endpoints.
Acceptance: generate 14 days of slots, book, release, double-book rejected by the unique index; reception confirms an in-person request inside the SLA and the case shows the appointment; public case view exposes only the four allowed fields.

### Phase 4 — Doctor intake and case workflow (2 days)
Deliverables: `hospitalCaseService.js`, `hospitalStateMachine.js`, patient and case endpoints, documents upload to `hospitals/<id>/...`, opinion save, timeline, case numbering under advisory lock, queue numbers.
Acceptance: intake creates patient + case + checkin code; status transitions reject illegal moves; documents are private and hospital-scoped; doctor sees only his cases; hospital_admin sees all in his hospital.

### Phase 5 — Lab and pharmacy (2 days)
Deliverables: `labController.js`, `pharmacyController.js`, catalogue, result entry with previous-versions on amendment, comments, critical-result flag, dispensing.
Acceptance: doctor requests a test → lab results it → doctor sees it on the case; critical result notifies the doctor; pharmacy dispense updates the case.

### Phase 6 — Client surfaces (3 days)
Deliverables: all routes in section 8, i18n additions, kiosk and screen layouts, staff settings screens, ALO admin hospitals screen, monochrome styling.
Acceptance: `npm run build` clean; Arabic walkthrough end-to-end at 375px and desktop; every public route works without a cookie; no role sees a screen it should not.

### Phase 7 — International opinion bridge (2.5 days)
Deliverables: request table endpoints, coordinator queue, token generalisation, specialist review page, forward-to-doctor, notifications, ageing job.
Acceptance: doctor requests with consent; coordinator assigns and the specialist submits through the token; opinion appears on the hospital case; ALO payload contains no lab or medication data (asserted in a manual check).

### Phase 8 — Verification and rollout (1 day)
Deliverables: `TESTING.md` hospital chapter, preflight additions, DEC-056 in `decisions.md`, README deployment note.
Acceptance: full manual script below passes on production after deploy; rollback rehearsed.

**Total: 15.5 days.**

---

## 13. Manual test script (suites are retired behind `E2E_ALLOW`)

1. ALO admin creates hospital + hospital_admin → hospital_admin receives OTP → signs in.
2. hospital_admin creates doctor, reception, lab, pharmacy; duplicate doctor phone across two hospitals is rejected with the exact message.
3. Doctor intake: new patient, walk-in case, checkin code visible.
4. Reception check-in by code → queue number → `arrived` → `in_clinic`.
5. Doctor saves opinion → requests lab → lab results (one abnormal) → pharmacy dispenses → case `completed`.
6. Reception creates an appointment request → confirms → slot becomes `booked`; concurrent confirm of the same slot fails cleanly.
7. Kiosk pairs with PIN, checks in a patient, exposes nothing clinical.
8. `/p/:code` shows first name, doctor, time, arrival only.
9. Hospital A admin requests `/hospital/cases/<hospital B id>` → 404; lab B cannot read test A.
10. Doctor requests international opinion with consent → coordinator assigns → specialist submits → opinion on case.
11. Deactivate a doctor holding a slot; the slot is released by the sweep and the queue clears.
12. Release an unverified number, then re-create with it; claim a verified inactive number via OTP; claim refused while the holder is active.
13. Arabic RTL pass over every hospital screen; monochrome check.

---

## 14. Rollout and rollback

Order is fixed: schema → preflight → code → verify.

1. Confirm Supabase PITR/backup is current for `ovkxuzstzgixjtvkhadf`.
2. Apply the two migrations in numeric order through the service role (same practice as DEC-054).
3. Run `npm run preflight` locally against the production project.
4. Merge and push to `main` (single branch, Coolify auto-deploy), or set env first if any is added — none are required.
5. Watch `/health`, then probe the new routes for `401` (route present) before any `404` (deploy done).
6. Only then create the first real hospital and its admin.

Rollback: the migrations are additive and nothing existing is dropped, so reverting code (`git revert`) leaves new tables unused and harmless. `magic_link_tokens.case_id` becoming nullable is compatible with the current code. No destructive down-migration is required or offered.

---

## 15. Risks and revisit triggers

| Risk | Mitigation |
|---|---|
| A hospital admin accidentally granted ALO `admin` semantics exposes every AloDoc case | Separate guards and route groups; a line in DEC-056; `requireALOStaff` asserts `hospital_id is null` |
| A missed `hospital_id` filter leaks across tenants | `scoped()` helper plus the preflight static scan; composite FKs as the last line |
| `staff_users` constraint changes break the two live admins | Backfill first; migration aborts on collision; `email`/`password_hash` relaxed, never tightened |
| Phone recycling leaves a number permanently stuck | Unverified auto-release, OTP claim, ALO admin release |
| Hospital staff without WhatsApp cannot sign in | Break-glass single-use link |
| WABA outage locks out an entire hospital | Same break-glass path; documented in TESTING.md |
| Hospital expected to receive AloDoc cases | Explicitly out of scope (D3); revisit when a client asks |
| Duplicate `magic_link_tokens` semantics drift between case review and opinion review | One service, one table, one expiry sweep |

Revisit triggers: first request for ALO→hospital routing; first request for hospital visits in the patient portal; first hospital asking for its own branding colours.

---

## 16. DEC-056 draft (paste into `decisions.md` on approval)

> ## DEC-056 — Hospital portal rebuilt natively; separate case model; hospital-scoped tenancy
> **Decision:** The Base44 hospital portal is reimplemented inside AloDoc on the existing Supabase project and Express API, with the Base44 app left untouched and unreferenced at runtime. Hospital data lives in a separate `hospital_*` family keyed by `hospitals.id`; `hospital_cases` is deliberately **not** merged into `cases`, so the 12-state AloDoc pipeline and the six-state hospital flow stay independent. Every hospital table carries `hospital_id` and composite foreign keys to its parent, so a cross-hospital reference is impossible even without a query filter. Hospital staff authenticate by WhatsApp OTP only (no passwords, no per-person PINs); `hospitals.kiosk_pin` authenticates a device and grants no person identity. `staff_users.phone_e164` is globally unique, so one doctor belongs to one hospital; duplicates are rejected with "This number is already part of our system, please provide a different number.", which never names the other hospital. A number is released automatically when unverified, by audited ALO-admin action or OTP self-claim when verified, and never while the holder is active. ALO admin creates hospitals and `hospital_admin`; `hospital_admin` creates the rest. `hospital_admin` never receives ALO `admin`/`coordinator` semantics. Hospital is self-contained at launch: no ALO case routing, no case-portal access for hospital doctors, no hospital visit in the patient portal. The single cross-boundary flow is an international opinion request — hospital doctor → ALO coordinator → specialist magic link → opinion returned to the hospital case — carrying only the patient demographics, the clinical question and the documents the doctor attached.
> **Rationale:** …
> **Consequences / follow-ups:** …

Fill the rationale and consequences at implementation time with verification evidence, per the existing DEC style.

---

## 17. File map (new unless marked)

Server: `lib/phone.js`, `lib/scope.js`, `middleware/hospitalAuth.js`, `services/hospitalSlotService.js`, `services/hospitalCaseService.js`, `services/hospitalStateMachine.js`, `services/hospitalNotificationService.js`, `services/opinionRequestService.js`, `services/reviewTokenService.js` (refactor of `magicLinkService.js`), `controllers/hospitalAdminController.js`, `controllers/hospitalStaffController.js`, `controllers/hospitalCaseController.js`, `controllers/receptionController.js`, `controllers/labController.js`, `controllers/pharmacyController.js`, `controllers/publicHospitalController.js`, `controllers/opinionRequestController.js`.
Touched: `server/index.js` (route groups, jobs), `middleware/auth.js` (session re-read, claim), `controllers/authController.js` (staff OTP), `controllers/adminController.js` (hospitals, specialists, release-phone), `controllers/caseController.js` (specialist picker), `scripts/preflight.mjs`.
Client: `pages/hospital/*` (dashboard, cases, reception, lab, pharmacy, doctors, settings), `pages/public/Kiosk.jsx`, `WaitingScreen.jsx`, `ManagementWall.jsx`, `PatientStatus.jsx`, `pages/admin/Hospitals.jsx`, `pages/admin/IntlSpecialists.jsx`, `pages/staff/IntlOpinions.jsx`, plus `App.jsx`, `lib/i18n.jsx`, `styles.css`.
Docs: `decisions.md` (DEC-056), `README.md` (hospital module, one paragraph), `TESTING.md` (section 13 script).

---

## 18. Open item

**Nurse allowed to pick international specialists?** Recommendation: yes, alongside `coordinator` and `admin`; the hospital doctor may only propose. Confirm or override before Phase 7.

---

## 19. Bootstrap prompt for a new session

> Read `HOSPITAL-PORT-PLAN.md` in this repo and treat sections 2–6 as frozen decisions. I am building the hospital portal natively inside AloDoc, starting at Phase 1. Constraints: single Supabase database `ovkxuzstzgixjtvkhadf`, Express is the only logic layer, additive migrations only, monochrome UI, EN/AR RTL, decisions logged in `decisions.md` as DEC-056, single `main` branch. Do not integrate with the Base44 app at runtime and do not import its data. Begin by writing the two migrations in section 12 Phase 1, then run `npm run preflight`.
