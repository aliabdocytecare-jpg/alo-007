# AloDoc — Decision Log

Every autonomous decision is recorded here with rationale, per user instruction (Nov 20, 2026).
Format: ID · Decision · Rationale · Bible/Blueprint reference · Reversibility.

---

## DEC-001 — Supabase remains the production infrastructure; embedded local driver for dev only
- **Decision:** Production/target architecture is Supabase (PostgreSQL + RLS, Storage, Realtime) accessed via the service-role SDK from Express, exactly per blueprint. Real Supabase SQL migrations live in `supabase/migrations/`. Because this machine has the Supabase CLI but **no Docker** (required by `supabase start`), the server ships a second data driver: an embedded SQLite store implementing the same Supabase-client query interface, activated ONLY when `SUPABASE_URL` is unset.
- **Rationale:** User priority is real patient entry immediately, autonomous run with no manual setup. Setting `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Supabase Cloud free tier needs no Docker) switches the identical codebase to real Supabase with zero rework.
- **Reference:** Blueprint §1/§6; user instruction "start using real patient entry first".
- **Reversibility:** Trivial — set two env vars; local driver never used in production.

## DEC-002 — Data-access conventions constrained to a portable query subset
- **Decision:** Server code uses only: `select` (flat columns, no embedded resource joins), `eq/in/is/lt/lte/gt/gte`, `order`, `limit`, `single/maybeSingle`, `insert/update/upsert`. Related records are fetched with separate queries and assembled in services.
- **Rationale:** Keeps the Supabase driver and local driver behaviorally identical; avoids PostgREST-specific join semantics. Also clearer audit boundaries.
- **Reference:** Industry best practice (repository/service layering).
- **Reversibility:** Additive — richer queries can be introduced later on Supabase only.

## DEC-003 — Local storage driver mirrors Supabase Storage semantics
- **Decision:** In local mode, files are stored under `server/.local-storage/case-documents/` (private, served only through authenticated Express endpoints). In Supabase mode, the private bucket `case-documents` is used via service SDK. Same `storage_path` values in both modes.
- **Rationale:** Bible F-CASE-05 requires hashed/signed access; no public file URLs in either mode.
- **Reference:** F-CASE-05, BR-013, P2 Least Exposure.

## DEC-004 — Plain black-and-white text UI, single CSS file (no Tailwind yet)
- **Decision:** Phase 1 UI is monochrome, monospace, table/border-based. Tailwind + visual design deferred to a later phase per explicit user instruction ("keep it simple black and white, text based… ui/ux can be brought in").
- **Rationale:** Patient entry first; design layer must not block functional validation.
- **Reference:** User instruction Nov 20.

## DEC-005 — Lightweight i18n module instead of i18next (for now)
- **Decision:** Custom React context dictionary (EN/AR) with `dir=rtl` switching and localStorage persistence. Same functional contract as P7 (every string bilingual, instant switch, RTL). i18next can replace it later without UI changes.
- **Rationale:** Fewer dependencies for the text-UI phase; identical behavior.
- **Reference:** P7, US-PAT-014.

## DEC-006 — Arabic status labels are provisional
- **Decision:** AR translations for the 12 patient-facing statuses are written by the build and marked provisional. Bible flags client-provided AR labels due Nov 22 as a localization blocker.
- **Rationale:** Cannot block autonomous build; single source (`stateMachine.js` LABELS) makes replacement a one-file edit.
- **Reference:** Part 5.1 [!IMPORTANT].

## DEC-007 — Mock auth & mock WhatsApp behind env flags
- **Decision:** `ENABLE_MOCK_AUTH=true` → OTP 123456 (PIN 1234 also accepted per blueprint). `ENABLE_MOCK_WHATSAPP=true` → WhatsApp sends recorded in `notification_log` as `mock_sent` with full message body; in-app notifications always real. Real Meta Cloud API integration is a Phase-2 swap inside `notificationService.js` only.
- **Rationale:** Blueprint §4A; no external credentials available on this machine.
- **Reference:** F-AUTH-01/02, F-NOTIF-02, BR-017 (no PHI in bodies).

## DEC-008 — Booking time slots: datetime picker, not availability engine
- **Decision:** Patients pick a preferred datetime; coordinator confirms/adjusts when scheduling. No doctor availability calendar in this build.
- **Rationale:** Availability engine is not specified in the Bible beyond "available time slot"; coordinator scheduling (US-CRD-011, Test A9) is the authoritative step. Keeps patient entry unblocked.
- **Reference:** US-PAT-005 AC1, Part 3.3.

## DEC-009 — Report PDF via browser print stylesheet
- **Decision:** Released reports render as a formatted print view; "Print / Save as PDF" uses the browser. Server-side PDF generation deferred.
- **Rationale:** US-PAT-011 AC2 satisfied functionally without a PDF dependency; upgrade path isolated to one endpoint later.
- **Reference:** US-PAT-011, Test B10.

## DEC-010 — Staff onboarding: admin sets initial password (setup-link deferred)
- **Decision:** Admin creates staff with an initial password meeting F-AUTH-03 policy. One-time setup link (US-ADM-001 AC2) deferred; schema supports adding it.
- **Rationale:** No email channel yet; keeps BR-030 (no self-registration) fully enforced now.
- **Reference:** US-ADM-001, F-AUTH-03, BR-030.

## DEC-011 — Optimistic locking on case writes
- **Decision:** `cases.version` increments on every transition; concurrent writers get HTTP 409 "This case was just updated. Please refresh."
- **Rationale:** Bible 8.2 explicitly prescribes last-write-wins with optimistic locking.
- **Reference:** Part 8.2.

## DEC-012 — SLA pause on ADDITIONAL_INFO_REQUIRED: timer keeps running
- **Decision:** BR-019 leaves pausing optional ("confirm with client"). Default: SLA clock runs; the status has its own generous target (72h) in `sla_config`, admin-editable.
- **Rationale:** Safer operational default (nothing silently stalls); reversible via admin SLA config.
- **Reference:** BR-019, US-ADM-005.

## DEC-013 — Notification channels in this build
- **Decision:** In-app (real) + WhatsApp (mock log). SMS fallback and email recorded in `notification_log` as `queued`/skipped with reason, not sent. Retry worker stubbed (max 3 / 5-min policy stored in log schema).
- **Rationale:** No external providers configured; F-NOTIF schema complete so Phase 2 is a driver swap.
- **Reference:** F-NOTIF-02/03, Part 8.3.

## DEC-014 — Sessions: HttpOnly JWT cookies, sliding expiry
- **Decision:** Single cookie `alodoc_session`; patient 30 days, staff 8 hours, refreshed on activity. Role + kind inside JWT; staff `is_active` re-checked on every guarded request (deactivation mid-session → 401).
- **Rationale:** F-AUTH-02/03 and Part 8.1 (deactivated staff) exactly.
- **Reference:** F-AUTH-02/03, Part 8.1.

## DEC-015 — Magic-link tokens: 48 chars base64url, SHA-256 at rest
- **Decision:** `crypto.randomBytes(36).toString('base64url')` = 48 URL-safe chars; only SHA-256 hash stored. Review URL `/review/{token}` on the client origin (blueprint's review.alodoc.com subdomain is a deployment-time DNS concern).
- **Rationale:** F-AUTH-04, BR-006/007/008/024.
- **Reference:** Part 3.1 F-AUTH-04.

## DEC-016 — International review privacy minimization
- **Decision:** Magic-link payload exposes age + gender, NOT full name / DOB / phone (US-INT-002 AC2 "confirm with client" → default to minimum). Coordinator sees full record.
- **Rationale:** P2 Least Exposure; safest default pending client confirmation.
- **Reference:** US-INT-002, P2.

## DEC-017 — Seed data & accounts
- **Decision:** Migrations seed specialties, 5 healthcare services, 12-drug formulary, 9 SLA targets, system settings. Server boot idempotently seeds 4 staff accounts (admin/coordinator/doctor/nurse) with policy-compliant passwords, printed in README.
- **Rationale:** Immediate usability; BR-030 preserved (creation path is admin-only in API).
- **Reference:** US-ADM-001/002/003/005.

## DEC-018 — E2E verification is automated, not manual
- **Decision:** `server/scripts/e2e.mjs` executes Bible Part 9 Tests A–E against the running API (cookie-jar fetch client), including negative security tests E1–E10. Phase 10 gate: all green.
- **Rationale:** Part 9 defines pass/fail proof; automation makes it repeatable on Ubuntu CI later.
- **Reference:** Part 9.

## DEC-019 — No git commits during autonomous build
- **Decision:** Files are written to the workspace; git init/commit/push left to the user (deployment path Mac→GitHub→Ubuntu unchanged).
- **Rationale:** Commit policy requires explicit user request.
- **Reference:** Blueprint §6.

## DEC-020 — Realtime deferred; polling/refresh in text UI
- **Decision:** Supabase Realtime subscriptions (blueprint `useCase.js`) deferred to Phase 2; text UI uses explicit refresh + 30s notification poll. Schema and API already realtime-compatible.
- **Rationale:** Local driver has no realtime server; keeps both drivers identical.
- **Reference:** Blueprint §3 hooks.

## DEC-021 — Multer 2.x instead of 1.x
- **Decision:** Use `multer@^2.0.1` (memory storage, same `upload.single('file')` API).
- **Rationale:** npm flagged Multer 1.x as vulnerable (CVE-patched only in 2.x). Industry best practice: no known-vulnerable deps.
- **Reference:** Security baseline.

## DEC-022 — SERVICE case completion path (Bible gap)
- **Decision:** Part 5's state machine covers Consultation/GMO but defines no completion transition for Healthcare Service cases, while Test D4 requires services "tracked through to completion". Added: coordinator/admin may transition an assigned SERVICE case (SPECIALIST_ASSIGNED or IN_PROGRESS) to COMPLETED via the status endpoint, with timeline + audit + optimistic lock identical to normal transitions.
- **Rationale:** Closes the gap with the least-privilege actor (coordinator owns operations); flagged for client sign-off at next Bible review.
- **Reference:** Part 5, Test D4, BR-029.

## DEC-023 — E2E expiry test manipulates local dev DB only
- **Decision:** Test E6 (expired magic link) sets `expires_at` into the past directly in the embedded SQLite file when the server runs in local mode; skipped with a notice when running against real Supabase.
- **Rationale:** No API should ever allow backdating tokens; the test harness may touch the dev-only store. Production verification of E6 uses natural 72h expiry or a staging DB.
- **Reference:** Part 9 Test E6, BR-007.

## DEC-024 — Review rate limiter counts failed attempts only
- **Decision:** `/review/*` limiter uses `skipSuccessfulRequests: true` (max 30 failures / 10 min / IP). Client maps HTTP 429 to a distinct bilingual "too many attempts" screen instead of "invalid link".
- **Rationale:** Loop-2 testing proved counting legitimate specialist views (page + inline PDF iframes + draft + submit) saturated the window and mis-rendered revoked links as invalid. Brute-force token guessing always fails (403) so Test E9 still triggers 429 within a 10-request burst.
- **Reference:** Part 9 Test E9, Part 8.1, F-AUTH-04.

## DEC-025 — Stale-while-revalidate data loading in UI
- **Decision:** `useAsync` keeps previous data during refreshes (loading flag only before first data). Case views no longer unmount panels mid-refresh.
- **Rationale:** Loop-3 testing proved the old unmount-on-refresh behavior wiped in-flight form state (doctor report textarea reset -> disabled submit) and caused flicker. Also removes a whole class of UI race conditions.
- **Reference:** US-DOC-004 (autosave), P3 No Dead Ends.

## DEC-026 — Auth rate limiter counts failed attempts only
- **Decision:** `/auth/*` limiter uses `skipSuccessfulRequests: true` (max 60 failures / 15 min / IP).
- **Rationale:** Loop-4/5 testing proved counting successful registrations/logins made repeated legitimate sessions (and CI re-runs) self-block with 429. Account-level brute-force defenses remain: 5 wrong OTPs -> 15-min lock, 5 wrong passwords -> 15-min lock + admin alert on 3rd, 5 OTP resends/hour/phone.
- **Reference:** F-AUTH-01/02/03, Part 8.1, Blueprint §2 rate limiter.

## DEC-027 — Stable data-testid selectors for UI automation
- **Decision:** Key controls carry `data-testid` (assign-staff, doc-category); Playwright specs target testids/roles/placeholders, never positional `select.first()`.
- **Rationale:** Loop-4 root cause: positional select locator resolved to the document-category select before the assign select rendered, and never detached, so selectOption retried against the wrong element forever. Testids are the industry-standard fix and survive layout changes.
- **Reference:** Testability best practice.

## DEC-028 — Viewable Playwright harness
- **Decision:** `client/e2e/` Playwright suite with desktop + mobile (Pixel 5) projects; `npm run test:ui` = headed (watchable), `test:ui:debug` = Playwright inspector, `test:ui:headless` = CI mode, `test:ui:report` = HTML report. Per-step screenshots in `client/e2e-shots/`, traces/videos retained on failure.
- **Rationale:** User requested viewable sessions repeating patient entry for different patients; personas cover EN female, AR male (RTL), EN male.
- **Reference:** User instruction Nov 20; Part 9 acceptance proof.

## DEC-029 — Settle viewport after fullPage screenshots in headed runs
- **Decision:** The `shot()` helper awaits two animation frames after every fullPage screenshot before the next interaction.
- **Rationale:** Headed Chromium expands the visual viewport for fullPage capture and restores it asynchronously; an immediately following click can be measured against the still-tall viewport. Cheap deterministic settle for the viewable harness.
- **Reference:** Loop-5 headed-only GMO failure investigation.

## DEC-030 — Click-to-load PDF previews (focus-steal root cause)
- **Decision:** `DocPreview` renders a "Preview PDF: <name>" button for PDFs; the iframe viewer mounts only on explicit click. Images stay inline; other types stay download links. EN/AR key `previewPdf`.
- **Rationale:** Loop-5 root cause, proven by trace + focus probe: the headed Chromium PDF extension grabs focus (activeElement EMBED/PDF-VIEWER) and scrolls the page while initializing. When this happened between Playwright's scroll-into-view and mouse dispatch, the click landed inside the PDF iframe and vanished — no confirm dialog, no POST, form untouched. This also affected real users (page yanked mid-form-fill) and wasted mobile bandwidth auto-rendering every PDF. Click-to-load eliminates the race at the source; headless never reproduced it because headless shell has no PDF extension. GMO spec now opens a preview explicitly to prove rendering still works.
- **Reference:** Loop-5 evidence (trace.zip input point vs screencast scrollY=0; dbg5 focus probe); US-INT-002, P3.

## DEC-031 — Complete Service action in coordinator UI
- **Decision:** CoordinatorPanel shows a "Complete Service" button (with confirm) for SERVICE cases in SPECIALIST_ASSIGNED/IN_PROGRESS, calling the existing status→COMPLETED endpoint. Bilingual key `completeService`.
- **Rationale:** Coverage audit found SERVICE cases could be created and assigned via UI but only completed via API — a P3 (No Dead Ends) violation. Found while adding UI session 5.
- **Reference:** US-PAT-013, US-CRD, DEC-022, P3.

## DEC-032 — No phantom report for SERVICE cases
- **Decision:** Patient CaseView hides the medical-report box for SERVICE cases and shows a dedicated completion message (`serviceCompleted`, EN/AR) instead of the report-promising COMPLETED next-step text.
- **Rationale:** A completed SERVICE case told the patient "Your report is available below" while the report box said "being prepared" forever — misleading dead end. Consultation/GMO behavior unchanged.
- **Reference:** US-PAT-013, BR-016, P3.

## DEC-033 — Time-proof and queue-safe test helpers
- **Decision:** `futureSlot(days,hour)` computes appointment datetimes dynamically (hardcoded 2026-11-25 would become a past date and fail scheduling validation); `openAssignedCase()` scopes case opening to the Assigned Cases dashboard section.
- **Rationale:** Nurse/doctor dashboards intentionally list a case in multiple queues (Due Today + Assigned Cases), breaking strict-mode locators; and date-sensitive tests must not expire. Both are harness fixes, not app changes.
- **Reference:** US-NUR-005, US-DOC-001, F-CASE scheduling validation.

## DEC-034 — Suite ordering: UI before API e2e (E9 limiter saturation)
- **Decision:** Documented and enforced ordering — Playwright suites run BEFORE `server npm run e2e`; the API script prints a warning that E9 intentionally trips the review limiter for the caller IP. Restarting the API clears limiter state between suites.
- **Rationale:** E9 proves brute-force protection by bursting invalid tokens until 429 — which necessarily saturates the failure-counting window for that IP. UI tests sharing the IP within 10 minutes then see the (correct) "too many attempts" screen. This is the security feature working, not a bug; weakening the limiter for test convenience was rejected. Isolation via ordering/restart keeps both suites honest.
- **Reference:** Part 9 Test E9, DEC-024, F-AUTH-04.

## DEC-035 — Local staff assignment gated to the ready window
- **Decision:** `assign` (local staff branch) now rejects with 409 unless status is READY_FOR_ASSIGNMENT or SPECIALIST_ASSIGNED — mirroring the international branch. New API check E14 locks this in.
- **Rationale:** Screenshot review of the follow-up session exposed that local assignment had no status guard: it silently set owner_id from INITIAL_REVIEW (leaving status inconsistent) and would have accepted assignment to COMPLETED/CANCELLED cases. The UI already hid the control; the API hole is now closed (defense in depth).
- **Reference:** Part 5 state machine, BR-003, US-CRD-002, Part 9 Test E14.

## DEC-036 — No phantom report for cancelled cases
- **Decision:** Patient CaseView hides the medical-report box when status is CANCELLED (any service type), extending DEC-032.
- **Rationale:** A cancelled consultation still promised "Your report is being prepared" — a report that will never come. Same P3 dead-end class as DEC-032, caught by reviewing the exception-paths screenshot.
- **Reference:** BR-020, P3, DEC-032.

## DEC-037 — Schema-drift guard between local driver and Supabase migration
- **Decision:** `server/scripts/schema-drift.mjs` parses CREATE TABLE blocks from both the Supabase migration and the local driver and fails on any table/column difference (driver-internal `_sequences` whitelisted). Run before deploying to Supabase.
- **Rationale:** DEC-001's dual-driver design only stays safe while the schemas mirror each other; a silent drift would break the production switch the user explicitly requires. First run confirmed 19/19 tables in sync.
- **Reference:** DEC-001/002, deployment path.

## DEC-038 — Dependency security upgrades (router 7, vite 7)
- **Decision:** Upgraded react-router-dom 6→7 and vite 5→7 (+ @vitejs/plugin-react 5). `npm audit` now reports 0 vulnerabilities in both packages.
- **Rationale:** Audit found esbuild/vite dev-server advisory (moderate) and react-router open-redirect + SSR-hydration CVEs (moderate/high). Router 7 is drop-in for our usage (Routes/Link/Navigate/hooks); vite 7 clears the esbuild advisory without the v8 breaking change. Full 22-run UI suite + 68-check API suite re-verified green on the upgraded stack; bundle 101.9 kB gzip.
- **Reference:** GHSA-67mh-4wv8-2f99, GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg; industry best practice instruction.

## DEC-039 — Production boot safety (P0 closure)
- **Decision:** (a) Demo staff seeding runs only in local/mock mode; production logs a bootstrap hint instead. (b) `scripts/create-admin.mjs` creates the first admin on either driver, enforcing a strong unique password (rejects known demo passwords). (c) Boot fails fast in production if JWT_SECRET is missing/short (<32 chars) or ENABLE_MOCK_AUTH=true.
- **Rationale:** Gap analysis found seedStaff() unconditional (known credentials would exist in production) and a silent dev JWT fallback (forgeable sessions). Verified: weak/demo passwords refused, bootstrap admin can sign in, production without secret refuses to boot.
- **Reference:** P0 items 1–2, F-AUTH, US-ADM-001.

## DEC-040 — React error boundary
- **Decision:** `ErrorBoundary` wraps all routes; crash fallback is a bilingual B/W box with Reload/Home actions, logging the error to console.
- **Rationale:** A render exception previously white-screened the portal (P3). Static bilingual copy because the i18n provider itself may be the crash source.
- **Reference:** P3 No Dead Ends, P7.

## DEC-041 — SLA save feedback + deterministic config tests
- **Decision:** SlaTab save now has try/catch with OK/error message (previously silent on failure). Admin-config session awaits the PATCH response and asserts the OK message; services/SLA state is restored after the test.
- **Rationale:** A failed-run trace showed the SLA PATCH never fired and the UI gave no feedback either way. Server-side persistence was proven correct via authenticated curl; the probe passed in isolation. Feedback closes the silent-failure class; response-awaiting removes the race. New session also proves BR-026 (off=hidden, coming-soon=visible-but-disabled) and staff-portals RTL.
- **Reference:** US-ADM-005, BR-026, P3/P7.

## DEC-042 — Background jobs proven via E15 (local-only time manipulation)
- **Decision:** API check E15 backdates SLA/reminder/appointment timestamps in the dev SQLite (DEC-023 pattern), waits one tick cycle, and asserts N-12 coordinator alert, N-10 patient reminder, and auto IN_PROGRESS. Skipped with a notice on real Supabase.
- **Rationale:** The tick jobs were implemented but unproven (timing-based). E15 makes the notification matrix's time-driven rows verifiable without waiting 24h. Suite now 71 checks.
- **Reference:** N-10, N-12, Part 5 auto-transition, DEC-023.

## DEC-043 — Explicit patient register-vs-sign-in state
- **Decision:** The patient login now shows a clear heading ("New here? Create your patient account" vs "Welcome back — enter your OTP"), a hint that new numbers must register with a required Full name, a persistent international-phone-format hint, and a `*` on Full name. EN/AR keys added; patient-entry suite asserts the new-patient heading.
- **Rationale:** Team testing reported "everyone logs in with 123456 except patients." Reproduced via API: patient registration works, but a NEW number silently switches to a Register form requiring Full name — testers entered phone+OTP expecting staff-style login and hit "Full name is required" / phone-format errors (and sometimes the 5-OTP/hour cap). Staff are pre-seeded so they never see this. The state is now self-explanatory for real patients too.
- **Reference:** US-PAT-001/002, P3 No Dead Ends; team feedback Nov 21.

## DEC-044 — 20 pre-seeded test patients (dev/mock only)
- **Decision:** On local/mock boot, seed 20 patients with phones `+966500001001..+966500001020` (varied names, gender, EN/AR preference, valid DOB), idempotent by phone. Guarded by the same IS_LOCAL/ENABLE_MOCK_AUTH gate as staff (DEC-039) — never created in production. Documented in TESTING.md.
- **Rationale:** Team wanted ready patients to test all flows without registering each time. Seeded patients sign in directly (OTP 123456 → Verify), and give each tester a distinct patient. Registration flow remains testable with any number outside the series. Confirmed entered data persists in the local SQLite DB (patients/cases/documents tables).
- **Reference:** US-PAT-001, DEC-039, team request Nov 21.

## DEC-045 — Clean production start: first-user-only Super Admin bootstrap
- **Decision:** Production starts empty of users/demo data. The first user is brought in via a one-time, operator-run CLI (`scripts/create-admin.mjs`), hardened to be **first-user-only** (refuses once any staff exists) so exactly one ALO Super Admin is bootstrapped; all other staff are created through the authenticated, audited Admin console. The bootstrap writes an `ADMIN_BOOTSTRAPPED` audit row. Added **last-active-admin lockout protection** (cannot deactivate the last admin). The `admin` role is the super admin (top of the Bible role model); no new role/schema needed. Reference catalog config (002_seed) is retained as required configuration, distinct from demo user data.
- **Rationale:** Industry best practice for the first user is a deliberate bootstrap (Django `createsuperuser`, Strapi/Grafana admin init), never hardcoded migration users or shipped default credentials: secrets from env/vault, strong unique password, closed after first use, least privilege, audited, lockout-safe. Matches the user's request for a clean start with a single super admin. Verified live: bootstrap refuses when staff exist; last-admin deactivation returns 409; non-admin deactivation unaffected. API suite now 72 checks (E16-last-admin).
- **Reference:** US-ADM-001, F-AUTH-03, DEC-039; user request Nov 21.

## DEC-046 — Live Supabase cutover (clean) + three real fixes
- **Decision:** Applied the schema to the live Supabase project (clean: 0 users/patients/cases; reference config seeded; private bucket; RLS deny-all). Fixed three issues found only on the live path: (1) migration files shared version prefix `20261120` causing a `schema_migrations` collision — renamed to unique 14-digit timestamps `20261120000001_schema` / `20261120000002_seed` (updated schema-drift + comments + README); (2) Node 20 has no native WebSocket so supabase-js Realtime construction threw — added `ws` dependency and `realtime: { transport: ws }` in db.js; (3) tables created via the pooler lacked Supabase default privileges so `service_role` was denied — added migration `20261120000003_grants.sql` (explicit grants + default privileges). Verified read/write/storage via the app driver; local dev untouched (still SQLite for the team).
- **Rationale:** The Supabase path was designed-for but unproven (gap A1); running it live surfaced exactly these integration bugs. Connection uses the IPv4 session pooler (`aws-0-ap-south-1.pooler.supabase.com:5432`, user `postgres.<ref>`) because the direct host is IPv6-only. Grants keep the service-role-only security model intact.
- **Reference:** DEC-001, gap A1; live cutover Nov 21.

## DEC-047 — Split-hosting readiness (Cloudflare Pages frontend + separate API)
- **Decision:** Made the client host-agnostic: `api.js` baseURL = `import.meta.env.VITE_API_URL || '/api/v1'`; added `client/public/_redirects` (SPA fallback `/* /index.html 200`) for Cloudflare Pages; CORS accepts comma-separated `CLIENT_ORIGIN`; magic-link origin uses the first `CLIENT_ORIGIN` entry. Added `client/.env.example` and `server/.env.production.example` (clean production template). Dev/same-origin behavior unchanged (verified build + 6/6 patient-entry).
- **Rationale:** User chose Cloudflare Pages for the static frontend (alodoc.online) + dedicated server for the API + Supabase Cloud for data — clean tier separation to avoid the prior multi-version-on-one-server confusion. Cookie `SameSite=Lax` requires frontend+API on the same registrable domain (e.g. alodoc.online + api.alodoc.online), NOT raw pages.dev.
- **Reference:** DEC-001, DEC-045; user hosting decision Nov 21.

## DEC-048 — Bootstrap password policy aligned to staff policy; first Super Admin created
- **Decision:** Aligned `create-admin.mjs` password validation to the same policy as staff creation (adminController `PW_RE`: 10+ chars with uppercase, digit, special), replacing the stricter 12+ rule. Bootstrapped the single ALO Super Admin on live Supabase: `aliabdocytecare@gmail.com` (name "ALO Super Admin"). Verified: staff_users=1, ADMIN_BOOTSTRAPPED audit row, patients/cases=0, bootstrap now closed (refuses a second admin), correct password logs in (role admin) and wrong password is rejected.
- **Rationale:** Owner explicitly chose this credential; it satisfies the established staff password policy, so the bootstrap was made consistent rather than rejecting a valid strong password. Supabase confirmed as the permanent database + storage backend; Express remains the logic layer; frontend targets Cloudflare Pages.
- **Reference:** DEC-039, DEC-045, DEC-046, F-AUTH-03; owner credential Nov 21.