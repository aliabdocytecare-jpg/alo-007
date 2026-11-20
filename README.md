# AloDoc — Healthcare Coordination Platform

Bible-driven build: patient entry first, simple black-and-white text UI (EN/AR RTL),
Express API + Supabase backend, mock OTP/WhatsApp for local development.

- **Product Bible coverage:** personas, F-AUTH/F-CASE/F-MEET/F-RX/F-NOTIF, BR-001..030,
  12-status case state machine, permission matrix, notification matrix N-01..N-14.
- **Decision log:** every implementation decision is recorded in [`decisions.md`](decisions.md) (DEC-001..042).
- **Build plan:** [`PLAN.md`](PLAN.md) — 10 phases, all complete.
- **Team testing guide:** [`TESTING.md`](TESTING.md) — friendly step-by-step flow tests aligned to the user stories, for manual QA and gap reporting.

## Architecture

| Tier | Tech | Notes |
|------|------|-------|
| Client | React 18 + Vite, custom B/W CSS, custom i18n (EN/AR, `dir=rtl`) | port 5173 |
| API | Express 4, helmet, CORS, cookie-session JWT, rate limiters | port 3000 |
| Data | Supabase (Postgres + Storage) in production; embedded SQLite driver locally | DEC-001 |
| External | Meta WhatsApp Cloud API + Google Meet links (mocked locally) | DEC-009 |

The API is the **only** data gate (service-role key server-side; RLS deny-all for direct
client access). When `SUPABASE_URL` is unset, `server/config/localDriver.js` provides a
Supabase-compatible client over `better-sqlite3` + local file storage — same query subset,
zero Docker required (DEC-001/002).

## Quick start (local, no Supabase needed)

```bash
# 1. API (auto-creates schema + seeds staff & 20 test patients on first boot)
cd server && npm install && npm run dev        # http://localhost:3000

# 2. Client
cd client && npm install && npm run dev        # http://localhost:5173
```

### Seeded accounts (local/dev only — DEC-012)

| Role | Login | Password |
|------|-------|----------|
| Admin | admin@alodoc.com | Admin@12345 |
| Coordinator | coordinator@alodoc.com | Coord@12345 |
| Doctor (General Medicine) | doctor@alodoc.com | Doctor@12345 |
| Nurse | nurse@alodoc.com | Nurse@12345 |

Patients: any phone → **mock OTP `123456`** (PIN `1234` where asked). Mock WhatsApp
messages are printed to the server log, including specialist magic links.

**20 ready-made test patients (DEC-044):** `+966500001001` … `+966500001020` are pre-seeded
(local only) — sign in with OTP `123456` → *Verify & Sign In*, no registration. Use any other
number to test the registration flow. All entered data persists in `server/.data/alodoc.sqlite`.

## Tests

```bash
# UI suite — Playwright, desktop + mobile (Pixel 5). RUN UI FIRST (see note below).
cd client && npx playwright install chromium   # first time only
npm run test:ui            # HEADED — watch the sessions live
npm run test:ui:debug      # Playwright inspector (step through)
npm run test:ui:headless   # CI mode
npm run test:ui:report     # open HTML report

# API acceptance suite — Bible Tests A–E + security negatives (71 checks). RUN LAST.
cd server && npm run e2e                       # expects API running on :3000
```

> **Ordering (DEC-034):** API Test E9 intentionally bursts invalid magic-link tokens until
> the rate limiter returns 429 — saturating the window for that IP. Run Playwright before
> the API suite, or restart the API between them.

UI sessions (`client/e2e/`) — 12 tests × desktop + mobile = 24 runs:
1. **patient-entry** — same entry flow for 3 personas (EN female, AR male RTL, EN male).
2. **gmo-review** — GMO submission with real PDF uploads → anonymous specialist
   magic-link review (draft persistence, submit, auto-revoke) → coordinator release →
   patient reads the opinion (full Bible Test B via UI).
3. **staff-journey** — full consultation across patient/coordinator/doctor portals
   through report release (Bible Test A via the real UI).
4. **nurse-rx-admin** — nurse vitals + intake lock, doctor prescriptions (formulary
   auto-fill + free text), admin console (staff lifecycle, formulary, audit filter, SLA),
   patient sees released report + prescriptions.
5. **service-flow** — SERVICE request lifecycle through coordinator completion (DEC-031/032).
6. **exception-paths** — document request → patient upload auto-resume → escalation →
   cancellation with reason; follow-up from a cancelled case is blocked (Part 8.4).
7. **followup-notifications** — follow-up booking with pre-filled parent context (BR-012),
   doctor sees the previous consultation, notification center mark-read/unread count.
8. **clinical-extras** — Meet join window open/hidden (BR-023), document soft-delete
   lifecycle, OTP lockout after 5 failures (US-PAT-002 AC2).
9. **admin-config** — services on/off + coming-soon with patient-side proof (BR-026),
   SLA target persistence, staff-portals Arabic RTL.

Schema safety: `cd server && node scripts/schema-drift.mjs` verifies the local driver
mirrors the Supabase migration (DEC-037) — run it before switching to production.

Per-step screenshots land in `client/e2e-shots/`; traces/videos are retained on failure
in `client/test-results/`.

## Switching to real Supabase (production)

1. Create a Supabase project; run `supabase/migrations/20261120_001_schema.sql` then
   `20261120_002_seed.sql` (SQL editor or `supabase db push`).
2. Create the **private** storage bucket `case-documents`.
3. Set `server/.env`:
   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ENABLE_MOCK_AUTH=false
   ENABLE_MOCK_WHATSAPP=false
   NODE_ENV=production
   JWT_SECRET=<long-random-32+-chars>
   ```
   Boot **fails fast** if the secret is missing/short or mock auth is on (DEC-039).
4. Bootstrap the first admin (demo accounts are dev-only, never seeded in production):
   ```bash
   ADMIN_EMAIL=you@clinic.com ADMIN_PASSWORD='<strong-unique>' ADMIN_NAME='Your Name' \
     node scripts/create-admin.mjs
   ```
   Then create the rest of the staff via the Admin console.
5. Wire real WhatsApp Cloud API credentials (DEC-009) and restart.

## Deployment path

Mac → GitHub → Ubuntu: PM2 for the Express API, Nginx serving `client/dist`
(`npm run build`) and proxying `/api` to :3000. Supabase Cloud for data/storage.

## Repository layout

```
supabase/migrations/   SQL schema + seed (production source of truth)
server/                Express API: controllers, services, middleware, drivers
  scripts/e2e.mjs      Bible Tests A–E (67 checks)
  .data/               local SQLite (dev only, gitignored)
  .local-storage/      local file storage (dev only, gitignored)
client/                React client: pages (patient/staff/admin/review), lib, components
  e2e/                 Playwright sessions + helpers
  e2e-shots/           per-step screenshots
decisions.md           DEC-001..042 — every decision, with rationale
TESTING.md             team flow-testing guide (user-story aligned)
PLAN.md                10-phase build plan + verification results
```

## Security posture (implemented)

- HttpOnly JWT cookies (patient 30d / staff 8h sliding), staff `is_active` recheck per request.
- Lockouts: 5 wrong OTPs or passwords → 15 min; admin alert on 3rd staff failure; 5 OTP resends/h/phone.
- Rate limiters count **failed** attempts only (DEC-024/026); brute-force still trips 429 (Test E9).
- Magic links: 48-char base64url, SHA-256 at rest, 72h TTL, revoke-on-submit, age/gender-only payload.
- Optimistic locking (`cases.version` → 409 refresh), append-only timeline + audit log.
- Upload validation: PDF/JPG/PNG/DOCX, 50MB/file, 500MB/case, soft delete, access audit.