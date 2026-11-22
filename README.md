# AloDoc — Healthcare Coordination Platform

Bible-driven build: patient entry first, simple black-and-white text UI (EN/AR RTL),
Express API + Supabase backend. One Supabase database for every environment — no local
database anywhere (DEC-054), with real WhatsApp OTP gated from Admin → WhatsApp.

- **Product Bible coverage:** personas, F-AUTH/F-CASE/F-MEET/F-RX/F-NOTIF, BR-001..030,
  12-status case state machine, permission matrix, notification matrix N-01..N-14.
- **Decision log:** every implementation decision is recorded in [`decisions.md`](decisions.md) (DEC-001..055).
- **Build plan:** [`PLAN.md`](PLAN.md) — 10 phases, all complete.
- **Team testing guide:** [`TESTING.md`](TESTING.md) — friendly step-by-step flow tests aligned to the user stories, for manual QA and gap reporting.

## Architecture

| Tier | Tech | Notes |
|------|------|-------|
| Client | React 18 + Vite, custom B/W CSS, custom i18n (EN/AR, `dir=rtl`) | port 5173 |
| API | Express 4, helmet, CORS, cookie-session JWT, rate limiters | port 3000 |
| Data | **Supabase (Postgres + Storage) — single source of truth for every environment** | DEC-054 |
| External | Meta WhatsApp Cloud API (real, admin-gated) + Google Meet links (manual) | DEC-009/051 |

The API is the **only** data gate (service-role key server-side; RLS deny-all for direct
client access). There is **no local database**: `server/config/db.js` requires
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and refuses to boot without them. Your laptop
and https://alodoc.online run the same Express code against the same Supabase project —
one version of truth, no silos (DEC-054 supersedes the DEC-001 dual driver).

## Quick start (one database — Supabase)

```bash
# 0. server/.env — required, no local fallback (DEC-054)
#    SUPABASE_URL=https://<project-ref>.supabase.co
#    SUPABASE_SERVICE_ROLE_KEY=<service_role key>
#    ENABLE_MOCK_AUTH=false
#    ENABLE_MOCK_WHATSAPP=false

# 1. API
cd server && npm install && npm run dev        # http://localhost:3000

# 2. Client
cd client && npm install && npm run dev        # http://localhost:5173
```

### Accounts (real — no demo seeding any more)

Demo staff and the 20 pre-seeded test patients were **removed** with the local driver
(DEC-054): known-password accounts must never exist in the single production database.

| Role | Login | Password |
|------|-------|----------|
| Admin (ALO Super Admin) | aliabdocytecare@gmail.com | owner-held |

- **First admin on a clean database:** `ADMIN_EMAIL=… ADMIN_PASSWORD='…' ADMIN_NAME='…' node scripts/create-admin.mjs` (first-user-only, DEC-045).
- **Everyone else:** an admin creates them in **Admin → Staff** (audited).
- **Patients:** real phone → **real WhatsApp OTP** (6 digits, 10 min, 5 sends/hour). No mock code.
  Enable it in **Admin → WhatsApp → Login OTP**; both WhatsApp channels are OFF by default.
- Name test patients `TEST — …` so they are easy to identify and clean up in the live database.

## Tests — automated suites retired (DEC-054)

Both suites needed mock OTP `123456`, demo staff and a disposable local database, and they
**create patients/cases** — which would now land in the live database. They refuse to run:

```bash
cd client && npm run test:ui     # → "UI suite retired (DEC-054)…"
cd server && npm run e2e         # → "Retired (DEC-054)…"
```

Specs are kept for reference and can be re-pointed at a disposable database with
`E2E_ALLOW=true` — never against production. **Test by hand via `TESTING.md`.**

Historical UI sessions (`client/e2e/`) — 12 tests × desktop + mobile = 24 runs:
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

Schema safety: the SQL files in `supabase/migrations/` are the only schema definition now.
The DEC-037 drift checker was removed along with the local driver it compared against.

Per-step screenshots land in `client/e2e-shots/`; traces/videos are retained on failure
in `client/test-results/`.

## Switching to real Supabase (production)

1. Create a Supabase project; run `supabase/migrations/20261120000001_schema.sql` then
   `20261120000002_seed.sql` (SQL editor or `supabase db push`).
   *`002_seed` is reference **configuration** (specialties, services, formulary, SLA, settings)
   the app needs to operate — it creates **no users, patients, or cases**.*
2. The **private** storage bucket `case-documents` is created automatically by the migration.
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
4. Bootstrap the **single ALO Super Admin** — a clean start, no demo data (DEC-045).
   This is a one-time, **first-user-only** command (the `createsuperuser` industry pattern):
   it refuses once any staff exists, so exactly one admin is seeded.
   ```bash
   ADMIN_EMAIL=you@clinic.com ADMIN_PASSWORD='<strong-unique>' ADMIN_NAME='Your Name' \
     node scripts/create-admin.mjs
   ```
   The bootstrap is audited (`ADMIN_BOOTSTRAPPED`). Create every other staff member afterwards
   via the Admin console. The **last active admin cannot be deactivated** (lockout protection).
5. Configure WhatsApp in **Admin → WhatsApp** (DEC-051) — no restart needed:
   - Enter the WABA ID, Phone Number ID and a System User access token (write-only; the
     UI only ever shows a `…last4` hint).
   - OTP uses the approved `otp_verification` AUTHENTICATION template (`en_US` + `ar`) and
     follows each patient's preferred language, falling back to the default if a variant
     is missing.
   - Leave **Status-update template** blank until an AloDoc-specific UTILITY template with
     two body variables is approved. The ALO DOCTOR pilot templates on the same WABA point
     at `howtostart.in/alo/pilot/...` and must not be reused.
   - Tick **Enable WhatsApp sending**, Save, then **Send test OTP** to verify.
   Sending is **OFF by default**: with `ENABLE_MOCK_WHATSAPP=false` and the toggle off,
   patient OTP requests return 503 until an admin enables it (staff login is unaffected).
   Optionally apply `supabase/migrations/20261122000001_whatsapp_settings.sql` to seed the
   defaults; the admin save path also creates the keys on demand.

## Deployment path (LIVE — DEC-049/050)

Production runs as **one Coolify application** on the dedicated VPS, same-origin:

```
Cloudflare (alodoc.online, proxied A record → VPS, CDN + TLS)
   └─ Traefik (Coolify proxy, Let's Encrypt) → Coolify app container
        └─ Express serves React build (client/dist) + /api  [Dockerfile, multi-stage]
             └─ Supabase Cloud (database + storage)
```

- **Domain:** https://alodoc.online (frontend + API, same origin — no CORS/cookie gymnastics).
- **Hosting:** Coolify app `alodoc` (Dockerfile build pack, port 3000, health check `/health`).
  Auto-restart + **push-to-deploy** via a GitHub webhook on `aliabdocytecare-jpg/alo-007`.
- **Data:** Supabase Cloud project `ovkxuzstzgixjtvkhadf` (clean; one Super Admin bootstrapped).
- **Env (in Coolify):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NODE_ENV=production`,
  `JWT_SECRET` (random 32B), `ENABLE_MOCK_AUTH=false`, `ENABLE_MOCK_WHATSAPP=false`,
  `CLIENT_ORIGIN=https://alodoc.online`. See `server/.env.production.example`.
- **Redeploy:** `git push` to `main` → webhook → Coolify rebuilds + rolls out (zero downtime).
- **Preflight (DEC-055):** `cd server && npm run preflight` — read-only check of env, JWT length,
  mock gates, database reachability, WhatsApp settings and the private storage bucket. Exit code
  1 = do not deploy. Env must be in Coolify **before** the push: `config/db.js` exits and
  `middleware/auth.js` throws at import, so a missing variable is a crash loop, not a warning.
- Patient self-registration uses a **real WhatsApp OTP** (Meta Cloud API), enabled per channel in Admin → WhatsApp. There is no SMS provider.

## Repository layout

```
supabase/migrations/   SQL schema + seed — the single source of truth
server/                Express API: controllers, services, middleware
  config/db.js         Supabase client (required; no local fallback)
  scripts/e2e.mjs      Bible Tests A–E (retired, DEC-054)
  scripts/preflight.mjs  Env + database gate for deploys (DEC-055)
client/                React client: pages (patient/staff/admin/review), lib, components
  e2e/                 Playwright sessions + helpers (retired, DEC-054)
  e2e-shots/           historical per-step screenshots
decisions.md           DEC-001..055 — every decision, with rationale
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