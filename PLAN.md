# AloDoc — Autonomous Build Plan (10 Phases)

Source of truth: Product Bible v1.0 (Nov 20, 2026) + Architecture Blueprint.
Mode: autonomous, no intermediate questions. All decisions logged in `decisions.md`.

| Phase | Scope | Bible coverage | Verification |
|-------|-------|----------------|--------------|
| 1 | Scaffold, DB schema (Supabase SQL + local driver), config, drivers | Part 3 data model | Server boots, schema created |
| 2 | Auth: mock OTP patient register/sign-in, staff login, JWT cookies, lockouts | F-AUTH-01..03, US-PAT-001/002 | API smoke tests |
| 3 | Case engine: state machine, ownership, timeline, SLA timers, case numbers | Part 5, F-CASE-01..04, BR-001/002/029 | Transition tests incl. illegal moves |
| 4 | Documents: upload validation (type/50MB/500MB), storage, soft delete, access audit | F-CASE-05, BR-013, 8.2 | Upload + rejection tests |
| 5 | Clinical: vitals, intake, scheduling, Meet link windows, notes autosave, reports, release, prescriptions | F-MEET, F-RX, US-NUR/DOC/CRD | Role-gated API tests |
| 6 | Magic links: 48-char tokens, SHA-256 at rest, 72h TTL, draft/submit/revoke, review API | F-AUTH-04, BR-006..009/024, US-INT | Token lifecycle tests |
| 7 | Notifications (in-app + mock WhatsApp log, dedupe), audit log, admin APIs, SLA/reminder jobs | Part 7, F-NOTIF, US-ADM | Job + admin tests |
| 8 | Client shell (B/W text UI, EN/AR RTL) + patient portal: login, home, booking, GMO, service, my cases, case view | US-PAT-001..014 | vite build + browser flow |
| 9 | Staff portals: coordinator ops, nurse intake, doctor clinical, admin console, mobile review page | US-NUR/CRD/DOC/ADM/INT | vite build + browser flow |
| 10 | Automated E2E (Bible Tests A, B, C, D, E), security negative tests, fixes, README, deployment notes | Part 9 | DONE: API 71/71 (incl. E15 jobs); Playwright 24/24 headed + 24/24 headless (9 sessions); P0 boot safety closed; 0 npm vulnerabilities; schema drift guard; DEC-024..042 |

## Run targets
- API: http://localhost:3000 (`cd server && npm run dev`)
- Client: http://localhost:5173 (`cd client && npm run dev`)
- E2E: `cd server && npm run e2e` (boots nothing; expects API running)

## Deployment path (unchanged)
Mac -> GitHub -> Ubuntu (PM2 for Express, Nginx for React build) -> Supabase Cloud.
Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to switch from local driver to real Supabase.