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
- **Decision:** The dual-driver design (DEC-001) is retired. `server/config/db.js` now requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and exits at boot if either is missing; `IS_LOCAL` no longer exists. Deleted `server/config/localDriver.js`, `server/scripts/schema-drift.mjs` (it compared the local driver against the migrations) and the `better-sqlite3` dependency. **All demo seeding removed** from `index.js` (`seedStaff`, `seedTestPatients`): known-password demo staff (DEC-017/039) and the 20 test patients (DEC-044) must never be written to the one live database. Boot now reports the staff count and points at `create-admin.mjs` when empty; `/health` always reports `driver: 'supabase'`. Local `server/.env` points at the same production project (`ovkxuzstzgixjtvkhadf`, database `alodoc01`) with `ENABLE_MOCK_AUTH=false` and `ENABLE_MOCK_WHATSAPP=false`. Applied `20261122000001_whatsapp_settings.sql` to that project as pure DML through the service role (11 keys, both channels OFF; `system_settings` 3 → 14). Created a second admin `adrian.lewis@alodoc.sa` (role admin, phone +966500000000) with a `STAFF_CREATED` audit row, because `create-admin.mjs` is first-user-only and already closed. Both automated suites are **retired behind an `E2E_ALLOW=true` opt-in** (`server/scripts/e2e.mjs`, `client/playwright.config.js`) — they need mock OTP/demo staff and would create patients/cases in the live database. README, TESTING.md and `.env.example` rewritten for the single-database world; test records should be named `TEST — …`.
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

## DEC-062 — Real-Time Waiting Screen Queue Stream (SSE & Web Audio Chime) & Medical Report PDF Generation
- **Decision:** Implemented sub-second real-time waiting room TV queue updates and server-side medical report PDF generation:
  1. Real-Time Waiting Screen Queue Stream:
     - Implemented `server/services/realtimeService.js` with `QueueEventEmitter` and `emitQueueUpdate(hospitalId, payload)`.
     - Added SSE stream endpoint: `GET /api/v1/public/screen/:pin/waiting/stream` (`server/controllers/publicHospitalController.js`) streaming live queue state over HTTP with automated 20s keep-alive heartbeat.
     - Wired real-time triggers in `receptionController.js` (patient check-in, arrival status updates), `publicHospitalController.js` (kiosk check-in), and `bridgeController.js` (referral bookings).
     - Upgraded `client/src/pages/public/WaitingScreen.jsx` with native `EventSource` listener, real-time live connection badge, and synthesized dual-tone Web Audio chime (C5/E5 sine waves) when a patient is called into clinic. Kept 15s interval poll as resilient fallback.
  2. Medical Report PDF Generation:
     - Added `pdfkit` to `server/package.json` for pure-JS server-side PDF generation (zero headless browser or C++ runtime dependencies).
     - Implemented `server/services/pdfReportService.js` (`buildCaseReportPdf`) generating formatted, publication-grade medical consultation reports with patient metadata, clinical indications, diagnostic findings, prescriptions table, and 4-point Clinical Safety Verification Stamp.
     - Added PDF download endpoint: `GET /api/v1/cases/:id/report/pdf` (`server/controllers/caseEnhancementsController.js`).
     - Added direct "Download PDF Report" actions in `client/src/pages/patient/CaseView.jsx` and `client/src/pages/staff/CaseOps.jsx`.
  3. Notification & Claims Policy Confirmation:
     - Secondary notification channels (Email/SMS) remain deferred in accordance with the WhatsApp-first regional strategy.
     - Clinic billing and health insurance claims remain deferred.
     - WhatsApp outbound switches remain OFF intentionally to avoid billing messages during development until human review testing is conducted.
  - Verification: Automated suite `server/scripts/test-phase7-enhancements.mjs` executed 100% passing checks verifying SSE real-time broadcast and PDF header binary generation against live Supabase; production client compiled cleanly via `vite build` in 793ms.
- **Rationale:** Waiting room screens require immediate, sub-second visual and audible feedback when a ticket is called. Patients and clinicians require formal, downloadable PDF medical reports for clinical records and pharmacy presentation.
- **Reference:** DEC-056, DEC-058, DEC-059, `server/services/realtimeService.js`, `server/services/pdfReportService.js`, `server/controllers/publicHospitalController.js`, `server/scripts/test-phase7-enhancements.mjs`.

## DEC-063 — Implementation of Six High-Impact Workflow Enhancements across Bridge 2, Hospital Day-Clinic Engine, Kiosk, and Patient Tracker
- **Decision:** Implemented six concrete workflow enhancements addressing identified clinical, privacy, and usability gaps:
  1. Bridge 2 Specialist Scan Preview:
     - Implemented `reviewIntlDocument` in `server/controllers/bridgeController.js` and mounted `GET /api/v1/review/intl/:token/documents/:docId`.
     - Validates token hash, enforces document scoping (`hospital_case_id`), and streams scans from Supabase storage (`case-documents`).
  2. Day-Clinic Visit Summary PDF Generation:
     - Implemented `buildHospitalClinicVisitPdf` in `server/services/pdfReportService.js`.
     - Mounted staff endpoint `GET /api/v1/hospital/cases/:id/report/pdf` (`server/controllers/hospitalCaseController.js`) and public check-in code endpoint `GET /api/v1/public/case/:code/report/pdf` (`server/controllers/publicHospitalController.js`).
     - Added "Download Visit Summary (PDF)" actions in `client/src/pages/hospital/HospitalDashboard.jsx` (Doctor Desk) and `client/src/pages/public/PatientTracker.jsx`.
  3. Mobile Patient Tracker Live SSE Stream & Alert:
     - Implemented `streamPublicCaseStatus` (`GET /api/v1/public/case/:code/stream`) in `server/controllers/publicHospitalController.js`.
     - Upgraded `client/src/pages/public/PatientTracker.jsx` with native `EventSource` connection, live badge, device vibration (`navigator.vibrate`), and audio chime alert when called into clinic (`in_clinic`).
  4. Printable Specimen Tube Barcode Label:
     - Added a "Print Tube Label" action in `HospitalDashboard.jsx` (Lab tab) that renders a 50mm x 25mm printable thermal label modal featuring the Code 128B SVG barcode, Specimen ID (`SPEC-...`), Patient MRN, and Test Name.
  5. Unattended Kiosk Auto-Reset Timeout:
     - Implemented a 15-second countdown auto-reset in `client/src/pages/public/Kiosk.jsx` after check-in slip issuance to guarantee patient privacy in hospital lobbies.
  6. Instant Filter / Search on Reception & Doctor Desks:
     - Added client-side real-time filter inputs in `HospitalDashboard.jsx` filtering clinic queues by Patient Name, MRN, Queue Number, or Check-in Code.
  - Verification: Automated suite `server/scripts/test-phase8-gaps.mjs` executed 100% passing checks against live Supabase; production client compiled cleanly via `vite build` in 791ms.
- **Rationale:** Ensures international specialists can inspect diagnostic imaging, physical day-clinic patients receive downloadable medical visit sheets, waiting patients receive immediate mobile call alerts, phlebotomists can print collection tube labels, and lobby kiosks preserve patient privacy.
- **Reference:** DEC-056 through DEC-062, `server/controllers/bridgeController.js`, `server/controllers/hospitalCaseController.js`, `server/controllers/publicHospitalController.js`, `server/services/pdfReportService.js`, `server/scripts/test-phase8-gaps.mjs`.

## DEC-064 — Mobile App Compatibility, Version Shielding & Rork Native Blueprint
- **Decision:** Prepared backend and architecture specifications for Rork-generated native iOS (SwiftUI) and Android (Jetpack Compose) mobile clients:
  1. Mobile App Version Guard:
     - Implemented `GET /api/v1/app/version-check` in `server/index.js` returning `min_required_version`, `latest_version`, and `force_update` flags to prevent legacy app breakage without App Store churn.
  2. Rork Native Architectural Blueprint:
     - Created `RORK-MOBILE-BLUEPRINT.md` containing end-to-end API integration contracts, zero-hardcode thin-client design rules, bilingual RTL support, native vibration and SSE stream handling, and modular prompts for Rork AI.
  3. Strict Additive Contracts:
     - Verified that all endpoints support JSON payloads and Bearer tokens for mobile native clients without browser cookie dependencies.
- **Rationale:** Rork compiles true platform-native code (Swift/Kotlin). Hardcoding clinical business rules or frequent schema alterations in the mobile client forces repeated App Store binary submissions. Decoupling the client into a server-driven UI surface with version-checking ensures the mobile app rarely needs recompiling.
- **Reference:** DEC-004, DEC-056, DEC-062, DEC-063, `RORK-MOBILE-BLUEPRINT.md`, `server/index.js`.

## DEC-065 — Rork Native Mobile Full-Stack Optimizations
- **Decision:** Implemented seven platform-native optimizations across the Express API and React client for complete compatibility with Rork-generated iOS and Android applications:
  1. Dual-Mode Authentication (Bearer Token + HttpOnly Cookie):
     - Enhanced `server/middleware/auth.js` (`resolveSession`) to seamlessly accept tokens from either `req.cookies['alodoc_session']` or `Authorization: Bearer <token>`.
     - Updated `verifyOtp`, `register`, `staffLogin`, `verifyStaffOtp`, and `chooseRole` to return the signed JWT `token` in the response body alongside setting the cookie, enabling native clients (Swift `URLSession` / Android `OkHttp`) to store credentials in Keychain/EncryptedSharedPreferences.
  2. Structured Machine-Readable Error Codes:
     - Enhanced `httpError` in `server/lib/helpers.js` to attach string error codes (e.g. `UNAUTHORIZED`, `INVALID_OTP`, `OTP_EXPIRED`, `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `CASE_NOT_FOUND`).
     - Standardized error handlers to emit `{ error: string, code: string }`, allowing typed enums in native Swift/Kotlin models without brittle string matching.
  3. Permissive CORS for Native Mobile Schemes:
     - Updated CORS policy in `server/index.js` to permit non-browser requests where `req.headers.origin` is undefined (native mobile), as well as mobile app URI schemes (`capacitor://localhost`, `ionic://localhost`, `app://alodoc`).
  4. Client Platform Telemetry & Version Headers:
     - Added mobile telemetry middleware in `server/index.js` parsing `X-Client-Platform` (`ios` | `android` | `web`), `X-App-Version`, and `X-Device-Id`.
     - Enriched Supabase `audit_log` records with client telemetry metadata for native mobile audit trails.
  5. Universal Links & Deep Linking Endpoints:
     - Implemented `GET /.well-known/apple-app-site-association` returning RFC-compliant Apple App Site Association JSON for iOS Universal Links.
     - Implemented `GET /.well-known/assetlinks.json` returning Android Digital Asset Links JSON for Android App Links.
  6. Mobile PDF Inline Streaming vs. Attachment:
     - Updated `downloadReportPdf`, `downloadClinicVisitPdf`, and `downloadPublicClinicVisitPdf` to detect mobile clients or `?inline=true` query parameters and set `Content-Disposition: inline; ...` with `Accept-Ranges: bytes` for native `PDFKit` / `PdfRenderer` view controllers.
  7. Web-to-Native Bridge Protocol (`client/src/lib/nativeBridge.js`):
     - Created unified bidirectional bridge utility detecting iOS `WKScriptMessageHandler` (`window.webkit.messageHandlers.aloBridge`) and Android JavascriptInterface (`window.AndroidBridge`) with automatic fallback to browser APIs (`navigator.vibrate`, Web Audio).
     - Integrated `NativeBridge.notifyTicketCalled(code)` into `PatientTracker.jsx`.
- **Verification:** Created automated test suite `server/scripts/test-phase9-rork-optimizations.mjs` verifying Bearer authentication, machine error codes, universal linking, CORS permissiveness, telemetry auditing, and inline PDF disposition (10/10 passing checks). Frontend compiled cleanly via `vite build` in 924ms.
- **Reference:** DEC-004, DEC-014, DEC-056, DEC-064, `client/src/lib/nativeBridge.js`, `server/scripts/test-phase9-rork-optimizations.mjs`.

## DEC-066 — Hospital Role Desk Isolation, Specialties Directory & Password Visibility Toggle
- **Decision:** Implemented role-based desk boundaries in the physical hospital dashboard, central administrative management for medical specialties with global form dropdowns, reusable password visibility toggles, and coordinator triage guidance:
  1. Role-Based Desk Boundaries in Hospital Portal:
     - Updated `client/src/pages/hospital/HospitalDashboard.jsx` to map each staff role to their exact operational desk:
       - `doctor` role sees exclusively the Doctor Consultation Desk (`doctor`).
       - `reception` role sees exclusively the Reception Desk (`reception`).
       - `lab` role sees exclusively the Lab Workbench (`lab`).
       - `pharmacy` role sees exclusively the Pharmacy Desk (`pharmacy`).
       - `hospital_admin` and ALO `admin` retain multi-desk oversight.
     - Single-role staff members have the navigation tab bar cleanly omitted, and unauthorized tab renders are strictly blocked.
  2. Central Medical Specialties Directory:
     - Implemented backend endpoints `GET /api/v1/specialties` (public active directory), `GET /api/v1/admin/specialties`, `POST /api/v1/admin/specialties`, and `PATCH /api/v1/admin/specialties/:id` in `server/controllers/adminController.js` and `server/index.js`.
     - Added the **Specialties** tab to `client/src/pages/admin/Admin.jsx` with bilingual names (`name_en`, `name_ar`), active toggles, and audit logging.
     - Replaced manual free-text inputs for clinical specialties across doctor provisioning forms in `Admin.jsx` and `HospitalDashboard.jsx` with dynamic `<select>` dropdowns populated from the database.
  3. Reusable Password Visibility Component:
     - Created `PasswordInput` in `client/src/components/ui.jsx` with an accessible SVG Eye icon toggle (`type="password"` <-> `type="text"`).
     - Applied across Staff Sign-In (`client/src/pages/Login.jsx`), Admin Staff Creation (`client/src/pages/admin/Admin.jsx`), WhatsApp Token configuration, and Kiosk Tablet Pairing (`client/src/pages/public/Kiosk.jsx`).
  4. Coordinator Triage Guidance & Action Panels:
     - Enriched `CoordinatorPanel` in `client/src/pages/staff/CaseOps.jsx` with contextual status instructions guiding next operational actions.
     - Enabled ALO Super Admins (`admin`) to directly view and test Coordinator, Nurse, and Doctor action panels.
- **Verification:** Created test suite `server/scripts/test-phase10-enhancements.mjs` verifying public specialties listing, admin listing, RBAC 403 enforcement, creation, duplicate rejection (409), and status deactivation (100% passing checks). Client compiled with 0 warnings/errors via `vite build` in 1.67s.
- **Reference:** DEC-004, DEC-056, DEC-061, `client/src/components/ui.jsx`, `client/src/pages/hospital/HospitalDashboard.jsx`, `server/scripts/test-phase10-enhancements.mjs`.

## DEC-067 — SMTP Staff Email Invitation, Self-Service Account Activation & Staff Deletion
- **Decision:** Implemented industry-standard staff onboarding (Option A), custom SMTP email delivery service, tokenized activation with self-service confidential password setting, strict email verification login gates, and permanent staff deletion with administrative lockout safeguards:
  1. Secure Staff Invitation Flow (Option A - Industry Best Practice):
     - Super Admin provisions staff by entering Full Name, Role, Email, Phone, and Specialty (for doctors).
     - Administrators no longer set passwords for staff members, ensuring zero plain-text password sharing and strict credential confidentiality.
     - System creates account with `password_hash = 'PENDING_ACTIVATION'`, generates a single-use 32-byte cryptographic token (SHA-256 hash stored in DB, expires in 24 hours), and sets `email_verified = false`.
  2. Custom SMTP Mail Service (`server/services/mailService.js`):
     - Built custom mail service using `nodemailer` connected to `mail.salemcctv.com:465` (SSL).
     - Supports bilingual (English and Arabic RTL) responsive HTML invitation email templates with AloDoc branding, action buttons, security notices, and raw link fallbacks.
     - Connection pooling with automatic reconnection and fallback audit logging.
     - Created safe test utility `server/scripts/test-email.mjs` allowing administrators to test delivery without sending unsolicited emails.
  3. Tokenized Account Activation (`/activate-account?token=...`):
     - Created `client/src/pages/auth/ActivateAccount.jsx` mounted in `client/src/App.jsx`.
     - Validates token on mount via `GET /api/v1/auth/activate-validate?token=...`.
     - Displays staff profile and requires double password entry (`password` and `confirm_password`) with the `PasswordInput` SVG eye visibility toggle.
     - Real-time password complexity checklist enforcement (10+ characters, 1 uppercase, 1 digit, 1 special character, and matching confirmation).
     - Submits to `POST /api/v1/auth/activate-complete`, hashes password with bcrypt (10 rounds), marks `email_verified = true`, revokes the token, logs `STAFF_ACCOUNT_ACTIVATED` audit event, and issues an authenticated session JWT.
  4. Strict Email Verification Login Gate:
     - Updated `staffLogin` in `server/controllers/authController.js` to block unverified staff accounts with 403 `EMAIL_NOT_VERIFIED`.
     - Frontend `Login.jsx` displays a clear user-facing alert informing staff to activate via the link sent to their email.
  5. Permanent Staff Deletion with Guardrails (`DELETE /api/v1/admin/staff/:id`):
     - Super Admins can permanently delete a staff member from the database.
     - Built-in guardrails prevent self-deletion (`CANNOT_DELETE_SELF`) and protect against deleting the last remaining platform admin (`LAST_ADMIN`).
     - Cleans up associated case assignments, case ownerships, and unread notifications before deletion.
     - Safely returns a 409 message if foreign key constraints for historical clinical notes prevent permanent deletion, advising deactivation instead.
  6. Admin Management UI Enhancements:
     - Updated `StaffTab` in `client/src/pages/admin/Admin.jsx` with an `emailVerification` column displaying `Verified` (green) and `Pending Activation` (amber) badges.
     - Added `Resend Invite` button for pending staff members.
     - Added `Delete` button with browser confirmation dialog and error/success messaging.
  7. Database Migration:
     - `supabase/migrations/20261124000001_staff_email_verification.sql` added `email_verified`, `activation_token_hash`, `activation_expires_at`, and `email_verified_at` columns, and backfilled existing Super Admins with `email_verified = true`.
- **Verification:** Applied migration to Supabase DB, passed `preflight.mjs` (13/13 passing checks), compiled frontend via `npm run build` with zero errors (120 modules in 3.44s), verified SMTP SSL handshake to `mail.salemcctv.com:465`.
- **Reference:** DEC-004, DEC-045, DEC-066, `server/services/mailService.js`, `client/src/pages/auth/ActivateAccount.jsx`, `server/scripts/test-email.mjs`.

## DEC-068 — Mandatory Email Validation, Optional Phone Labeling & Staff Forgot Password Flow
- **Decision:** Aligned form validation and field labeling to make Email strictly mandatory and Phone explicitly optional, and implemented self-service password reset for verified staff accounts via SMTP email:
  1. Mandatory Email vs. Optional Phone Labeling:
     - Updated `client/src/lib/i18n.jsx` to define `email: 'Email'` (Arabic: `البريد الإلكتروني`) and `emailOptional: 'Email (optional)'` (used only for optional patient registration).
     - In `client/src/pages/admin/Admin.jsx` (`StaffTab`), updated email field label to `Email *` and phone field to `Phone number (optional)`.
     - Strengthened client-side and server-side validation to reject empty staff emails with clear error messaging.
     - In `client/src/pages/Login.jsx`, staff sign-in field cleanly displays `Email` rather than `Email (optional)`.
  2. Staff Forgot Password Flow:
     - Added `Forgot Password?` toggle on the Staff Sign-In form (`client/src/pages/Login.jsx`).
     - Staff enters their registered email and clicks `Send Reset Link`.
     - Handled by backend endpoint `POST /api/v1/auth/forgot-password`:
       - If email is not registered, inactive, or unverified (`email_verified !== true`), throws 404: "This email is not registered to an account. Contact the administrator."
       - If valid, generates a single-use 32-byte cryptographic token (SHA-256 hash stored in DB, expires in 1 hour) and dispatches a responsive bilingual password reset email via `mailService.js`.
  3. Reset Password Page (`/reset-password?token=...`):
     - Created `client/src/pages/auth/ResetPassword.jsx` mounted in `client/src/App.jsx`.
     - Validates token on mount via `GET /api/v1/auth/reset-validate?token=...`.
     - Requires double entry (New Password & Confirm Password) using `PasswordInput` with SVG eye visibility toggle.
     - Enforces password complexity rules (10+ characters, 1 uppercase, 1 digit, 1 special character, and matching confirmation).
     - Submits to `POST /api/v1/auth/reset-complete`, updates `password_hash` with bcrypt, invalidates token, and audits `STAFF_PASSWORD_RESET`.
  4. Database Migration:
     - `supabase/migrations/20261124000002_staff_password_reset.sql` added `reset_token_hash TEXT` and `reset_expires_at TIMESTAMPTZ` with index to `staff_users`. Applied directly to live Supabase DB.
- **Verification:** Applied migration to Supabase, ran `preflight.mjs` (13/13 passing checks), compiled frontend via `vite build` with zero errors in 4.33s.
- **Reference:** DEC-004, DEC-066, DEC-067, `client/src/pages/auth/ResetPassword.jsx`, `supabase/migrations/20261124000002_staff_password_reset.sql`.

## DEC-069 — Mail Service Notification Log Fix & Drug Formulary Permanent Deletion
- **Decision:** Fixed Supabase Postgrest insert logging in `mailService.js` and added permanent deletion for drug formulary items in the Admin console:
  1. Mail Service Notification Log Fix (`server/services/mailService.js`):
     - Replaced unsupported `.insert(...).catch()` calls on Postgrest query builder with standard `try { await db.from('notification_log').insert(...); } catch (logErr) { ... }` blocks in both `sendStaffActivationEmail` and `sendStaffPasswordResetEmail`.
     - Resolved the runtime error `TypeError: db.from(...).insert(...).catch is not a function` which previously threw a 500 error after email dispatch.
  2. Drug Formulary Permanent Deletion (`DELETE /api/v1/admin/formulary/:id`):
     - Implemented `deleteDrug` endpoint in `server/controllers/adminController.js` and mounted route in `server/index.js`.
     - Added permanent `Delete` button alongside `Deactivate` / `Activate` in `FormularyTab` (`client/src/pages/admin/Admin.jsx`) with browser confirmation dialog and success/error notifications.
- **Verification:** Ran `npm run preflight` (13/13 checks passed), compiled client via `npm run build` with zero errors (121 modules in 4.79s).
- **Reference:** DEC-004, DEC-067, DEC-068, `server/services/mailService.js`, `client/src/pages/admin/Admin.jsx`.

## DEC-070 — Courier-Style Case Stepper, Ball-in-Court Custodian Engine & Coordinator Action Board
- **Decision:** Implemented Courier-Style Case Stepper, Role-Based "Ball-in-Court" (Custodian) and Next-Action To-Do Engine, and Action-Oriented Coordinator Dashboard tailored to the Written Medical Opinion flow (Practo & Mena Health standards):
  1. Backend Workflow Engine (`server/lib/caseWorkflowEngine.js`):
     - Calculates 5-stage progression (`Case Received` -> `Nurse Triage` -> `Doctor Review` -> `Opinion Prepared` -> `Delivered & Complete`).
     - Computes active `custodian` (`COORDINATOR` | `NURSE` | `DOCTOR` | `PATIENT`) based on status, assignments, and intake state.
     - Generates contextual bilingual `next_action` guidance for every stage.
     - Attached to `listCasesForRole` and `getCaseForRole` in `server/services/caseService.js`.
  2. Courier Stepper Component (`client/src/components/CaseStepper.jsx`):
     - Displays 5 connected horizontal stages with visual indicators (solid green checkmarks for completed, brand blue pulsing circle for active stage, and amber alert for requested documents).
     - Integrated into:
       - Patient Home (`client/src/pages/patient/Home.jsx`): Prominent Live Active Case Tracking card rendered on login.
       - Patient Case View (`client/src/pages/patient/CaseView.jsx`): Pinned at the top of case details.
       - Staff Case Operations (`client/src/pages/staff/CaseOps.jsx`): Pinned at the top of staff workspace.
  3. Action-Oriented Coordinator Dashboard (`client/src/pages/staff/Dashboard.jsx`):
     - Replaces manual queue hunting with 4 actionable segmented tabs:
       - `⚡ Needs My Action` (cases where custodian is Coordinator)
       - `🩺 With Nurse` (cases in triage)
       - `👨‍⚕️ With Doctor` (cases in medical review)
       - `⏳ Waiting on Patient` (cases waiting for additional reports)
       - `📁 All Cases`
     - Added `Custodian` badge and `Next Action` To-Do columns in `CaseTable`.
  4. 1-Click Clinical Handoffs (`client/src/pages/staff/CaseOps.jsx`):
     - In `NursePanel`: Added prominent `✓ Complete Triage & Forward to Doctor` CTA that saves vitals and notifies the Coordinator.
     - In `DoctorPanel`: Added Nurse Triage Vitals highlight box at the top, and updated submit CTA to `✓ Finalize Opinion & Submit to Coordinator`.
     - In `CoordinatorPanel`: Added notification callout when Nurse triage completes, instructing immediate Doctor assignment.
- **Verification:** Ran `npm run preflight` (13/13 passing checks), compiled frontend via `npm run build` with zero errors (122 modules in 6.83s).
- **Reference:** DEC-004, DEC-068, DEC-069, `client/src/components/CaseStepper.jsx`, `server/lib/caseWorkflowEngine.js`, `case_workflow_tracking_plan.md`.

## DEC-071 — Patient Identity Resolution & Robust OTP Re-Authentication
- **Decision:** Fixed the patient authentication flow and uniqueness contract across frontend and backend:
  1. API Contract Alignment (`server/controllers/authController.js`):
     - In `sendOtp`: Returned `exists: !isNew` alongside `isNew` and canonical `phone`.
     - In `verifyOtp`: Returned `exists: true` and normalized phone so returning patients are never routed to the registration form.
  2. Canonical Phone Normalization (`server/lib/phone.js`):
     - Integrated `toE164(phone)` into `sendOtp`, `verifyOtp`, and `register` in `authController.js`.
     - Automatically cleans whitespace, dashes, and parenthesized characters, ensuring Saudi numbers (`05...`) and international mobile numbers (`+91...`, `+966...`) consistently match the single unique patient record in Supabase.
  3. Frontend Robustness & Safety Net Fallback (`client/src/pages/Login.jsx`):
     - Updated `sendOtp` to evaluate `const patientExists = data.exists !== undefined ? Boolean(data.exists) : !data.isNew;` ensuring returning patients always see "Welcome back! Enter OTP to sign in".
     - Added an automatic fallback safety net in `finish()`: If an existing patient ever hits `/auth/register` (e.g. from an edge network state) and receives HTTP 409 (`ACCOUNT_EXISTS`), it immediately falls back to `/auth/verify-otp` with the entered OTP, logging them in seamlessly without blocking the user.
- **Verification:** Verified with production `vite build` (122 modules transformed in 1.69s) and server `preflight` (13/13 passing checks). Tested phone normalization and database lookup with existing patient record (`+919787076765`), confirming `exists: true` and immediate case association.
- **Reference:** DEC-043, DEC-056, `server/controllers/authController.js`, `client/src/pages/Login.jsx`, `patient_login_root_cause_and_plan.md`.













