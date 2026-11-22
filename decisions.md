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

## DEC-049 — Same-origin hosting (Option A) + Docker image for Coolify
- **Decision:** Express serves the built React client AND the API from one process (same origin). Added `express.static` + SPA fallback (guarded by dist existence; dev still uses Vite :5173), a CSP tuned for the SPA (self + unsafe-inline styles/scripts, self API/PDF frames), and a multi-stage `Dockerfile` (build client → run server serving it) + `.dockerignore`. `/health` endpoint used for Coolify health checks. Verified locally: Express-served build on :3000 renders, registers a patient, and shows the home cards with no CSP blocks.
- **Rationale:** With Express on the dedicated server, same-origin removes all cross-origin CORS/cookie complexity (no VITE_API_URL needed; SameSite=Lax works). One Coolify app, one domain (alodoc.online), one deploy. Cloudflare sits in front as a proxied CDN/TLS layer (A records set), preserving same origin. Chosen over Cloudflare Pages (split) and Supabase Edge Functions (rewrite) for simplicity + keeping tested code.
- **Reference:** DEC-047, DEC-048; hosting decision Nov 21.

## DEC-050 — Production deployed live via Coolify (additive, zero disruption)
- **Decision:** Deployed AloDoc as a single Coolify application on the existing VPS (vps-alo, 93.127.134.206) without touching existing services. Created project "AloDoc" + app `alodoc` (uuid jh8sp7m4vsr1j3i1znxzqkre) from public repo aliabdocytecare-jpg/alo-007, Dockerfile build pack, port 3000, domain https://alodoc.online. Set production env in Coolify (Supabase URL/key, random JWT_SECRET, mocks off, CLIENT_ORIGIN=https://alodoc.online). Enabled /health health check. Added GitHub push webhook → Coolify for auto-deploy. Cloudflare proxied A records (@ + www) → VPS provide CDN/TLS.
- **Rationale:** Owner authorized additive changes via SSH/Coolify. Same-origin (DEC-049) avoids CORS/cookie issues. Verified live: https://alodoc.online/health → {ok:true,driver:supabase}; frontend loads; Super Admin login → role admin; existing ad.howtostart.in app + Coolify still 200 (no disruption); mock:false confirms production. Server has ample headroom (4 CPU / 7.8GB RAM / 125GB disk). Coolify REST API was enabled for setup (token alodoc-deploy); to be disabled after setup to reduce exposure (webhooks are independent of the REST API).
- **Reference:** DEC-046, DEC-049; deployment Nov 21.

## DEC-051 — WhatsApp Cloud API configured in Admin settings, OFF by default
- **Decision:** WhatsApp credentials (WABA ID, Phone Number ID, access token, Graph API version, OTP template + default language, optional status-update template + language) live in `system_settings` (`whatsapp_*` keys) and are edited from **Admin → WhatsApp**. Sending is OFF unless `whatsapp_enabled='true'`; enabling is refused without a Phone Number ID + token. Effective mode resolves as `mock → disabled → not_configured → live`, so `ENABLE_MOCK_WHATSAPP` (DEC-007) still wins locally and dev/QA behaviour is unchanged. The admin badge nonetheless follows the toggle (`OFF` / `ON — credentials missing` / `ON — mock` / `ON — live`) with the kill switch reported separately as `mock_switch`, so OFF always reads as OFF. An explicit `token: null` clears the stored secret (refused while sending is ON); blank or masked input keeps it. OTP uses the already-APPROVED `otp_verification` AUTHENTICATION template (code sent in body **and** button params), follows the patient's `preferred_lang` (`ar`/`en_US`) and retries once with the configured default language if a variant is missing. Status updates use an admin-supplied UTILITY template with exactly two body variables; blank means WhatsApp is skipped for notifications. `notification_log.delivery_status` now records reality: `sent` (+`detail.message_id`), `mock_sent`, `skipped` (`whatsapp_disabled` / `notify_template_not_set` / `no_phone_on_file`) or `failed` (provider error, capped at 200 chars). The token is write-only (API returns `token_set` + `…last4`), blank/masked input keeps the stored value, and `catalog` now whitelists public setting keys so admin secrets cannot reach a patient browser. Added a read-only template inspector (`GET /admin/settings/whatsapp/templates`, `scripts/whatsapp-templates.mjs`) showing status and body-variable counts.
- **Rationale:** Ops can rotate credentials and switch sending on/off without a redeploy or shell access; default-OFF means a fresh install never spends money or messages real patients. Verified against the live WABA (886522121108941): 23 APPROVED templates, including `otp_verification` in `en_US` **and** `ar` with a COPY_CODE button and a 10-minute expiry footer — so no template creation was needed and the 10-minute OTP TTL already matches. The other 20 UTILITY templates belong to the **ALO DOCTOR pilot** (buttons deep-link to `https://howtostart.in/alo/pilot/...`, `CASE-####`/`AD-####` identifiers, 4-hour doctor acceptance, nurse chat, red-flag keywords) and are deliberately **not** reused: they would send AloDoc patients to the wrong application. Mock-first precedence keeps the documented terminal `[WhatsApp mock -> …]` flow (TESTING.md Golden Rule #3) and the E2E suites intact, which only assert on in-app notifications. Follow-ups: per-event template mapping for status updates, at-rest encryption of the stored token, SMS fallback.
- **Reference:** DEC-005, DEC-007, DEC-013, DEC-050; `server/services/whatsappService.js`, `server/controllers/adminController.js`, migration `20261122000001_whatsapp_settings.sql`, UI regression `client/e2e/whatsapp-admin.spec.js`. Verified: 25 admin/API checks, 7 non-mock notification-branch checks, real-mode OTP 503 (OFF) / 502 (provider failure), full API E2E 72/72, browser UI spec passing.

## DEC-052 — Cost policy: AUTHENTICATION / UTILITY templates only, MARKETING hard-blocked
- **Decision:** AloDoc may only send `AUTHENTICATION` (OTP) and `UTILITY` (transactional status) templates. Enforced at three layers: (1) **config time** — saving a template field or enabling sending triggers a fresh Meta lookup and rejects anything not found, not `APPROVED`, or in the wrong category (`MARKETING` → 400); turning OFF or rotating a token needs no network call; (2) **send time** — `assertTemplateCategory` checks a 10-minute cached template index (stale-while-revalidate) before every OTP/status send and blocks `MARKETING` before any spend; (3) **drift watch** — the background job re-checks the configured templates every 6h and raises an in-app `WA_CATEGORY_DRIFT` admin notification if Meta re-categorised, unapproved or deleted one. The admin inspector and `npm run wa:templates` flag `MARKETING` templates and variable-only bodies (Meta classifies "unclear" content such as a body that is only `{{1}}` as marketing).
- **Rationale:** Marketing carries the highest per-message rate and volume-tier discounts apply only to utility/authentication. A save-time check alone is insufficient: Meta automatically re-categorises approved utility templates to marketing (instantly, with no advance notice, once an account has been warned), and account-level enforcement can re-categorise **all** approved utility templates to marketing for 7 days (30 for repeat violations), so the guard must also run at send time. Audit of WABA 886522121108941: 23 templates = 20 UTILITY + 2 AUTHENTICATION (`otp_verification` en_US/ar) + 1 MARKETING (`thanks_response` [en], "Thank you for Calling..."). `thanks_response` is not referenced by any AloDoc code path and was left untouched — it belongs to another product on the shared WABA; deleting or re-categorising someone else's template is not ours to do. **Pricing correction:** since 1 Oct 2026 utility messages sent inside an open 24-hour customer service window are **no longer free** (`pricing_type` changed from `free_customer_service` to `regular`); only the Click-to-WhatsApp free entry point window and the monthly service free tier remain. Do not disguise promotional content as UTILITY to save money — mixed or unclear content is exactly what triggers the enforcement ladder. A template's category can be edited via API/WhatsApp Manager and resubmitted for review (`template_category_update` webhook). Follow-up: subscribe to that webhook for instant drift detection instead of 6h polling.
- **Reference:** DEC-051; `server/services/whatsappService.js` (`REQUIRED_CATEGORY`, `assertTemplateCategory`, `validateConfiguredTemplates`, `checkTemplateDrift`), `server/controllers/adminController.js`, `server/index.js` tick, `server/scripts/whatsapp-templates.mjs`.

## DEC-053 — Separate switches: WhatsApp login OTP vs WhatsApp status updates
- **Decision:** The single `whatsapp_enabled` flag from DEC-051 is replaced by two independent settings, both default `'false'`: `whatsapp_otp_enabled` (login verification) and `whatsapp_notify_enabled` (case/status notifications). Admin → WhatsApp shows one checkbox and one mode badge per channel. `whatsappMode(cfg, channel)` resolves per channel (`mock → disabled → not_configured → live`); `sendOtp` consults the OTP channel only, `notify()` the updates channel only. Enabling updates additionally requires a non-empty UTILITY template (400 otherwise). DEC-052 category validation runs only for the channel being enabled or whose template value actually changed, and the 6-hourly drift watch covers only enabled channels. The skipped reason `whatsapp_disabled` is renamed `notify_disabled`. Migration `20261122000001_whatsapp_settings.sql` was updated in place (it had never been applied).
- **Rationale:** Owner requirement — handle login and updates separately so (a) one channel being OFF never blocks the other flow (patients can still sign in while updates are off, and a missing/unapproved status template can never lock anyone out of login), and (b) testing a full case journey does not send and bill a WhatsApp message at every transition (roughly 20 messages per flow). In-app notifications stay real regardless, so switching updates OFF hides nothing inside the portal — it only stops the paid outbound channel. Typical usage: OTP ON + updates OFF during pilot/testing, then updates ON once the AloDoc UTILITY templates are approved.
- **Reference:** DEC-051, DEC-052; `server/services/whatsappService.js`, `server/services/notificationService.js`, `server/controllers/authController.js`, `server/controllers/adminController.js`, `client/e2e/whatsapp-admin.spec.js`.

## DEC-054 — Supabase as the single source of truth; local SQLite driver removed
- **Decision:** The dual-driver design (DEC-001) is retired. `server/config/db.js` now requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and exits at boot if either is missing; `IS_LOCAL` no longer exists. Deleted `server/config/localDriver.js`, `server/scripts/schema-drift.mjs` (it compared the local driver against the migrations) and the `better-sqlite3` dependency. **All demo seeding removed** from `index.js` (`seedStaff`, `seedTestPatients`): known-password demo staff (DEC-017/039) and the 20 test patients (DEC-044) must never be written to the one live database. Boot now reports the staff count and points at `create-admin.mjs` when empty; `/health` always reports `driver: 'supabase'`. Local `server/.env` points at the same production project (`ovkxuzstzgixjtvkhadf`, database `alodoc01`) with `ENABLE_MOCK_AUTH=false` and `ENABLE_MOCK_WHATSAPP=false`. Applied `20261122000001_whatsapp_settings.sql` to that project as pure DML through the service role (11 keys, both channels OFF; `system_settings` 3 → 14). Created a second admin `kathirvel.murugan@gmail.com` (role admin, phone +919159007007) with a `STAFF_CREATED` audit row, because `create-admin.mjs` is first-user-only and already closed. Both automated suites are **retired behind an `E2E_ALLOW=true` opt-in** (`server/scripts/e2e.mjs`, `client/playwright.config.js`) — they need mock OTP/demo staff and would create patients/cases in the live database. README, TESTING.md and `.env.example` rewritten for the single-database world; test records should be named `TEST — …`.
- **Rationale:** Owner requirement — one version of truth, no isolated silos. Two drivers meant two schemas (the local driver had no ALTER support and the drift checker only compared SQL text), two data sets, and constant confusion about which records were real; two local processes sharing one SQLite file also interleaved their audit rows while OTP codes stayed per-process. Unifying on Supabase makes local testing exercise exactly the production data path, RLS and Storage. Removing demo seeding was mandatory rather than optional: with one shared database, `ENABLE_MOCK_AUTH=true` would have seeded known-password staff into production and let anyone sign in as any real patient with `123456`. Verified live: `/health` → `{ok:true,driver:'supabase'}`; staff login for the new admin → `{ok:true,role:'admin'}`; catalog returns the 8 specialties / 5 services from Postgres; `GET /admin/settings/whatsapp` shows both channels `disabled` and `configured:false`; `POST /auth/send-otp` → 503 while WhatsApp is unconfigured; `case-documents` bucket present and private; patients/cases still 0.
- **Consequences / follow-ups:** `server/.data/` and `server/.local-storage/` are now inert (gitignored) and can be deleted; documents uploaded locally before the cutover do not exist in Supabase Storage. Coordinator/doctor/nurse accounts must be created by an admin before those flows can be tested. WhatsApp login OTP still needs credentials plus the OTP switch enabled in Admin → WhatsApp on the live database, and the code must be deployed (push → Coolify) before alodoc.online serves it. Replace the temporary dashboard token with a permanent System User token. Staff still have no second factor; `staff_users.phone` exists if WhatsApp 2FA is wanted later.
- **Reference:** DEC-001, DEC-017, DEC-037, DEC-039, DEC-044, DEC-045, DEC-046, DEC-051/052/053; owner request Nov 22.

## DEC-055 — Ship the Supabase-only build to Coolify; credentials from environment only
- **Decision:** Production runs the DEC-054 code path unchanged: Express on the VPS is the only data gate and Supabase `ovkxuzstzgixjtvkhadf` is the only datastore. Credentials are supplied **exclusively** through Coolify environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` ≥32 chars, `NODE_ENV=production`, `CLIENT_ORIGIN=https://alodoc.online`, `PORT=3000`, `ENABLE_MOCK_AUTH=false`, `ENABLE_MOCK_WHATSAPP=false`); `VITE_API_URL` stays unset because the build is same-origin. Nothing secret is committed: `.dockerignore` excludes `server/.env`, so committing it would leak the service_role key while still not reaching the container, and GitHub Actions secrets are irrelevant because Coolify reads its own app env and the repo has no workflow. **Ordering is mandatory** — env first, then code: `server/config/db.js` calls `process.exit(1)` without Supabase credentials and `server/middleware/auth.js` throws at import when `NODE_ENV=production` with a short `JWT_SECRET` or mock auth, so a missing variable crash-loops the container instead of warning. Added `server/scripts/preflight.mjs` (`npm run preflight`): read-only env/DB/storage validation with exit code 1, runnable locally and inside the running container. Single branch by owner request — one commit straight to `main`, fast-forward from `8c2b677`, no force push.
- **Rationale:** The deployed artifact must contain exactly one data path, so what is verified on a laptop is what serves patients — no dual-driver branch and no SQLite file possible on the VPS. Keeping secrets out of git protects the service_role key (it bypasses the deny-all RLS) in a repository the client and its collaborators can read, and git history is permanent even after deletion. The preflight collapses three otherwise silent failure modes (missing key, short secret, mock auth on in production) into one fail-fast command that can be re-run against the live container after rollout.
- **Consequences / follow-ups:** Local `server/.env` points at the same project, so laptop runs are real writes — test rows stay prefixed `TEST — …` and PITR/backups are mandatory. Patient login stays unavailable until an admin stores WABA ID / Phone Number ID / System User token in **Admin → WhatsApp** and enables the OTP channel (staff login is unaffected); status updates stay OFF during piloting to avoid per-transition billing (DEC-053). `server/.data/` and `server/.local-storage/` were deleted. The secondary admin account is no longer published in the client-visible README.
- **Reference:** DEC-039, DEC-045, DEC-046, DEC-049, DEC-050, DEC-054; `server/config/db.js`, `server/middleware/auth.js`, `server/scripts/preflight.mjs`, `Dockerfile`, `.dockerignore`, `server/.env.production.example`; owner request Nov 22.


## DEC-056 — Phase 1: Native Hospital & Case Portal Foundation (Database Migrations Applied & Verified)
- **Decision:** The Base44 hospital day-clinic portal and advanced case portal capabilities are ported natively into AloDoc (`alo-007`) on the existing Supabase Postgres database (`ovkxuzstzgixjtvkhadf`) and Express backend. Applied four additive, non-breaking migrations (`20261123000001_hospitals.sql`, `20261123000002_case_portal_enhancements.sql`, `20261123000003_intl_opinions.sql`, `20261123000004_staff_auth.sql`) and verified `20261122000001_whatsapp_settings.sql` in `supabase_migrations.schema_migrations`.
  - Added 15 new tables: `hospitals`, `hospital_patients`, `hospital_cases`, `hospital_case_timeline`, `hospital_documents`, `hospital_slot_templates`, `hospital_slots`, `hospital_appointment_requests`, `hospital_test_catalogue`, `hospital_lab_tests`, `hospital_lab_comments`, `hospital_medications`, `case_reviews`, `case_reports_requests`, `international_specialists`, `international_opinion_requests`.
  - Hard tenant isolation enforced at the database level via composite foreign keys `(hospital_case_id, hospital_id) REFERENCES hospital_cases(id, hospital_id)`.
  - Anti-double-booking constraint `UNIQUE(hospital_id, doctor_id, date, time)` applied to `hospital_slots`.
  - Multi-tenant staff identity: `staff_users` augmented with `hospital_id`, `phone_e164`, `phone_verified_at`, and a global unique partial index on `phone_e164`. Email/password constraints relaxed for hospital staff (who authenticate solely via WhatsApp OTP).
  - Scope realignment: `hospital_cases` includes `alo_case_id` and `alo_case_number` to enable atomic internal referrals from remote intake (Bridge 1), eliminating Base44's fragile HTTP webhook approach.
  - Implemented `server/lib/phone.js` (E.164 normalization, Saudi mobile validation, and tenant-safe availability checks).
  - Preflight suite (`server/scripts/preflight.mjs`) expanded to 13 checks covering hospital tables, staff phone integrity, and private storage buckets; all 13 checks pass green against the live Supabase database.
- **Rationale:** Native porting avoids distributed failure modes, eliminates outbox synchronization lags, and allows referral slot claiming, check-in code generation, and case handoffs to occur in a single atomic PostgreSQL transaction (<50ms). Keeping `hospital_cases` distinct from `cases` preserves the integrity of both the 12-state remote machine and the 6-state clinic machine.
- **Consequences / follow-ups:** Phase 1 complete and verified. Ready to proceed to Phase 2 (Tenancy Scoping Middleware & WhatsApp OTP Staff Authentication).
- **Reference:** F-CASE, DEC-054, DEC-055, `HOSPITAL-AND-CASE-PORTAL-PLAN.md`, `supabase/migrations/20261123*.sql`, `server/scripts/preflight.mjs`, `server/lib/phone.js`.


## DEC-057 — Phase 2: Multi-Tenant Scoping Middleware & WhatsApp OTP Staff Authentication
- **Decision:** Implemented hospital multi-tenant authorization guards, tenant scoping query helpers, and the complete WhatsApp OTP staff authentication pipeline.
  - Implemented `server/middleware/hospitalAuth.js` with:
    - `requireHospitalMember`: re-reads staff row on every request to immediately enforce deactivations (Part 8.1), asserts active hospital affiliation, and mounts `req.tenant` and `req.staff`.
    - `requireHospitalRole(...roles)`: role-based access control inside the hospital tenant (`doctor`, `reception`, `lab`, `pharmacy`, `hospital_admin`).
    - `requireALOStaff`: asserts `req.session.hospital_id` is null, preventing any hospital admin from gaining ALO platform coordinator/admin permissions (D8).
  - Implemented `server/lib/scope.js` with:
    - `scoped(req, table)`: enforces that all hospital data queries are bound by `hospital_id = req.tenant.id`.
    - `loadHospitalCase(req, res, next)`: loads hospital cases scoped to `req.tenant.id`; mismatches return 404 (never 403) to prevent cross-tenant existence probing.
    - `sanitizeHospitalCaseForRole`: filters clinical notes from non-clinical roles (`reception`, `lab`, `pharmacy`).
  - Implemented `server/controllers/hospitalAuthController.js`:
    - `POST /auth/staff/otp/send`: rate-limited WhatsApp OTP dispatch for active staff members.
    - `POST /auth/staff/otp/verify`: OTP verification, dual staff/patient identity resolution challenge, and session issuance (`hospital_id` in claims).
    - `POST /auth/choose-role`: resolves dual identity challenges.
    - `POST /auth/staff/claim-phone`: OTP proof-of-possession self-claim for verified inactive recycled numbers (D10 / Section 5.2).
    - `GET /auth/me`: provides complete profile and active hospital branding context.
  - Implemented `server/controllers/hospitalStaffController.js`:
    - CRUD for hospital staff under `hospital_admin` scope (`doctor`, `reception`, `lab`, `pharmacy`).
    - Duplicate phone rejection enforcing D10 message: `"This number is already part of our system, please provide a different number."`.
    - Immediate deactivation toggle (`PATCH /hospital/staff/:id/active`).
  - Implemented `server/controllers/hospitalAdminController.js`:
    - ALO platform admin endpoints to provision hospitals, create `hospital_admin`, release inactive phones, and issue single-use 30-min break-glass login links (`STAFF_LOGIN_LINK_ISSUED`).
  - Verification: Automated suite `server/scripts/test-phase2.mjs` executed 12/12 passing checks verifying phone normalization, hospital provisioning, duplicate rejection, query scoping, and immediate deactivation against live Supabase.
- **Rationale:** Strict database-level and middleware-level scoping eliminates cross-tenant data leaks. Passwordless WhatsApp OTP eliminates shared PIN vulnerabilities, matching real clinician workflows in Saudi Arabia.
- **Reference:** DEC-056, `HOSPITAL-AND-CASE-PORTAL-PLAN.md`, `server/middleware/hospitalAuth.js`, `server/lib/scope.js`, `server/controllers/hospitalAuthController.js`, `server/scripts/test-phase2.mjs`.

## DEC-058 — Phase 3: The Hospital Day-Clinic Engine
- **Decision:** Implemented and verified the complete day-clinic operations engine for Saudi hospitals.
  - Implemented `server/lib/barcode128.js`: pure-JS Code 128B font encoding and SVG barcode renderer for specimen test tubes and patient wristbands.
  - Implemented `server/services/hospitalSlotService.js`:
    - `generateSlotsForHospital`: generates doctor consultation slots from weekly recurrence templates across a rolling 14-day horizon.
    - `releaseExpiredFreeSlots`: automated hourly sweep releasing unbooked slots approaching within 24h threshold.
    - Double-booking prevention enforced via `UNIQUE(hospital_id, doctor_id, date, time)`.
  - Implemented `server/controllers/receptionController.js`:
    - Daily queue numbering (`A-001`, `A-002`) grouped by arrival status (`scheduled`, `arrived`, `in_clinic`, `done`).
    - Multi-method patient check-in (by 6-character uppercase check-in code or case ID) with idempotency.
    - 2h SLA appointment request confirmation/proposal/decline workflow.
  - Implemented `server/controllers/publicHospitalController.js`:
    - Public kiosk tablet pairing via 6-digit hospital PIN (`/kiosk/pair`).
    - Kiosk self-service check-in with bilingual feedback and queue slip data.
    - Patient mobile live status page (`/p/:code`) with queue position and estimated wait time.
    - Waiting room TV screen broadcast feed (`/screen/:token` or `/screen/h/:shortName`).
  - Implemented `server/controllers/hospitalCaseController.js`:
    - Hospital patient management (MRN uniqueness scoped per hospital).
    - Physical clinic walk-in and referral case creation (`C-0001` format, 6-character check-in code excluding ambiguous characters).
    - Doctor consultation note and clinical opinion recording.
    - Scoped document attachment with category classification (`lab_report`, `radiology`, `prescription`, `clinical_note`, `intl_opinion`).
  - Implemented `server/controllers/labController.js`:
    - Hospital test catalogue CRUD (`hospital_test_catalogue`).
    - Lab test order placement with automated specimen ID generation (`SPEC-<HOSP>-<HEX>`) and Code 128B SVG barcode.
    - Lab result entry with critical alert flags and complete amendment audit trail (`previous_versions` jsonb history).
    - Internal specimen communication (`hospital_lab_comments`).
  - Implemented `server/controllers/pharmacyController.js`:
    - Doctor prescription creation for clinic cases (`hospital_medications`).
    - Pharmacy queue listing and dispensing confirmation with pharmacist note and timestamps.
  - Verification: Automated suite `server/scripts/test-phase3.mjs` executed 19/19 passing tests verifying slot templates, double-booking rejection, patient creation, check-in queue numbering, consultation completion, barcode SVG generation, lab result versioning, pharmacy dispensing, and database cleanup.
- **Rationale:** Physical day-clinic operations require resilient queue numbering, specimen barcode tracking, and complete audit history. Implementing this natively within AloDoc provides seamless coordination without third-party clinic tools.
- **Reference:** DEC-056, DEC-057, `HOSPITAL-AND-CASE-PORTAL-PLAN.md`, `server/lib/barcode128.js`, `server/services/hospitalSlotService.js`, `server/controllers/receptionController.js`, `server/controllers/labController.js`, `server/controllers/pharmacyController.js`, `server/scripts/test-phase3.mjs`.

## DEC-059 — Phase 4: Specialist & Coordinator Case Portal Upgrades
- **Decision:** Implemented and verified the advanced coordinator tools and mobile specialist review pipeline.
  - Bilingual AI Summary:
    - Structured clinical schema (`clinical_presentation`, `key_findings`, `pending_questions`, `suggested_specialties`, `red_flags`) in English and Arabic.
    - Lifecycle states (`none`, `draft`, `approved`) with coordinator audit tracking.
  - Itemized Reports Request Checklist:
    - Created `case_reports_requests` enabling coordinators to send itemized missing report requirements with required/optional flags.
    - 7-day secure tokenized upload link dispatched to patient via WhatsApp.
    - Status progression (`pending`, `partially_fulfilled`, `fulfilled`) with automatic return to `INITIAL_REVIEW` when fulfilled.
  - Multi-Round Specialist Reviews:
    - Extended `case_reviews` for multi-round reviews (`fresh_case`, `additional_reports`, `second_review`, `follow_up`).
    - At dispatch time, an immutable `case_snapshot` is captured (case context, patient age/gender, and document manifest).
    - Specialists review previous rounds for "Then vs. Now" longitudinal diffing.
    - Integrated Decision Chips: agreement (`agrees_with_preliminary`, `modifies_preliminary`, `disagrees`), path (`medical_therapy`, `interventional`, `surgical`, `further_investigation`), and urgency (`routine`, `urgent`, `emergent`).
    - Integrated 4-Box Opinion Schema: `clinical_findings`, `diagnostic_assessment`, `recommendations`, `follow_up_guidance`.
    - Integrated Mobile Voice Dictation: specialist audio recordings uploaded directly to private storage bucket `case-documents` under `voice-notes/`.
  - 3-Step Final Report Publisher:
    - Step 1: Draft compilation and bilingual translation (`final_report_en`, `final_report_ar`).
    - Step 2: Clinical Safety Checklist verification (`patient_identity_checked`, `questions_addressed`, `red_flags_cleared`, `translation_verified`).
    - Step 3: Releasing final report to patient (`final_report_published = true`), case transition to `COMPLETED`, and WhatsApp notification dispatch (`N-09`).
  - Verification: Automated suite `server/scripts/test-phase4.mjs` executed 17/17 passing tests verifying AI summary, checklist fulfillment, multi-round review dispatch, voice note upload, decision chips submission, "Then vs. Now" diffing, and final report publication against live Supabase.
- **Rationale:** Remote second opinion cases frequently span multiple rounds and require structured decision categorization and voice dictation for busy international specialists.
- **Reference:** DEC-056, DEC-057, DEC-058, `HOSPITAL-AND-CASE-PORTAL-PLAN.md`, `server/controllers/caseEnhancementsController.js`, `server/controllers/reviewController.js`, `server/scripts/test-phase4.mjs`.

## DEC-060 — Phase 5: The Two Native Bridges
- **Decision:** Implemented and verified the two native architectural bridges connecting online intake and physical clinic care without distributed webhook dependencies.
  - Bridge 1 (Online Intake ➔ In-person Clinic):
    - Implemented `POST /api/v1/cases/:id/refer-to-hospital` (`server/controllers/bridgeController.js`).
    - Atomically assigns a verified doctor consultation slot in `hospital_slots` (enforcing anti-double-booking).
    - Resolves or creates hospital patient record under target hospital with MRN.
    - Generates daily clinic case (`C-0001` format) and 6-character check-in code (`checkin_code`).
    - Links slot to clinic case, records hospital handoff in remote case (`cases.hospital_handoff`), and updates timeline.
    - Dispatches WhatsApp appointment confirmation to patient with check-in code and queue tracking link (`/p/:code`).
  - Bridge 2 (Saudi Hospital ➔ Global Specialist Second Opinion):
    - Implemented `POST /api/v1/hospital/cases/:id/intl-opinion`: Saudi clinic doctor requests an international opinion with mandatory patient consent (`patient_consent: true`, `consented_by_name`).
    - Implemented ALO Coordinator dispatch queue (`/staff/intl-opinions`, `/staff/intl-opinions/:id/dispatch`) and global specialist directory (`international_specialists`).
    - Implemented privacy-minimized specialist portal (`/review/intl/:token`): presents clinical question, scans, and patient age/gender only (zero internal hospital staff notes or patient phone/contact numbers).
    - Specialist submits opinion and recommendations; token is revoked immediately.
    - Opinion is automatically appended directly to the Saudi clinic patient chart timeline (`hospital_case_timeline`), keeping all care data within the Saudi hospital context.
  - Verification: Automated suite `server/scripts/test-phase5.mjs` executed 17/17 passing tests verifying atomic referral, check-in code generation, double-booking rejection, consented second opinion creation, coordinator dispatch, specialist review, token revocation, and timeline chart integration against live Supabase.
- **Rationale:** Replacing external Base44 HTTP webhooks with native internal PostgreSQL transactions eliminates synchronization lags, avoids dropped webhooks, and ensures slot reservation, check-in code generation, and case handoffs succeed atomically or fail cleanly together.
- **Reference:** DEC-056, DEC-057, DEC-058, DEC-059, `HOSPITAL-AND-CASE-PORTAL-PLAN.md`, `server/controllers/bridgeController.js`, `server/scripts/test-phase5.mjs`.

## DEC-061 — Phase 6: Frontend Client Surfaces, Localization & Verification
- **Decision:** Implemented and mounted all client surfaces, public kiosks, TV feeds, specialist portals, and bilingual RTL localization for the unified platform.
  - Public & Specialist Surfaces:
    - `client/src/pages/public/Kiosk.jsx`: Self-service check-in kiosk tablet interface with 6-digit hospital PIN pairing, 6-character check-in code input, and daily queue slip generator (`A-001`, `~15 min` estimated wait).
    - `client/src/pages/public/WaitingScreen.jsx`: Fullscreen TV display feed for waiting rooms with real-time "Now Calling" board (`A-001 -> Clinic 3`), waiting queue (`A-002`, `A-003`), and live Riyadh digital clock.
    - `client/src/pages/public/PatientTracker.jsx`: Patient mobile live queue tracker (`/p/:code`) with status badge, doctor name, and queue position countdown.
    - `client/src/pages/public/ReportsUpload.jsx`: Patient itemized reports upload checklist (`/upload-reports/:token`) mapping uploaded files directly to required checklist items.
    - `client/src/pages/public/IntlReview.jsx`: Privacy-minimized global specialist review portal (`/review/intl/:token`) with clinical question, scans preview, decision chips, and recommendation submission.
  - Hospital Operations Portal (`client/src/pages/hospital/HospitalDashboard.jsx`):
    - Multi-desk operational views: Reception desk (live queue & walk-in registration), Doctor consultation desk (notes, lab orders & prescriptions), Lab workbench (specimen barcode tracking & amendment audit trail), Pharmacy desk (dispensing queue), and Admin desk (staff & slot templates).
  - ALO Staff & Specialist Enhancements:
    - `client/src/pages/staff/IntlOpinionsQueue.jsx`: Coordinator queue for international second opinions with directory selection and magic link dispatch.
    - `client/src/pages/staff/CaseOps.jsx`: Integrated Bilingual AI summary generation/approval, itemized reports request modal, and Bridge 1 "Refer to Saudi Hospital Clinic" form.
    - `client/src/pages/Review.jsx`: Upgraded with Decision Chips, 4-Box Opinion Schema, HTML5 MediaRecorder mobile voice dictation, and "Then vs. Now" multi-round diffing viewer.
    - `client/src/pages/Login.jsx`: Added Saudi clinic staff sign-in tab via WhatsApp OTP (`/auth/staff/otp/send` and `/auth/staff/otp/verify`).
  - Bilingual Localization:
    - Full English LTR and Arabic RTL translations added to `client/src/lib/i18n.jsx` for all new clinical, kiosk, lab, pharmacy, and specialist concepts.
  - Strict Monochrome Styling:
    - High-contrast black and white styling across all new views in accordance with DEC-004.
  - Verification: Clean compilation of React 18 client via `vite build` (dist output generated in 777ms with zero errors).
- **Rationale:** Completes the end-to-end user experience for physical clinic day operations, patient self-service, remote case coordination, and global second opinion reviews within a unified, same-origin full-stack architecture.
- **Reference:** DEC-056 through DEC-060, `HOSPITAL-AND-CASE-PORTAL-PLAN.md`, `client/src/App.jsx`, `client/src/pages/public/*`, `client/src/pages/hospital/*`, `client/src/pages/staff/*`.




