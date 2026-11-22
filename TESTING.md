# AloDoc — Team Flow-Testing Guide 🧪

Hi team! 👋 This guide lets **anyone** test AloDoc end-to-end, even if you've never seen the
code. Pick a flow, follow the steps, tick the "Expect" boxes, and tell us where it breaks.

**How to use this guide**
1. Get the app running (5 minutes, below).
2. Pick a flow card. Each one maps to a **user story** from the Product Bible (e.g. `US-PAT-005`).
3. Do the **Steps**, check the **Expect** list, then try the **Gap-watch** probes.
4. Found something odd? Report it with the tiny template at the bottom. No bug is too small.

> 🔄 **DEC-054 — one database, no silos.** The local SQLite stand-in and the demo/mock
> accounts are **gone**. Every environment now talks to the **same live Supabase project**,
> so data you create while testing is **real production data**. Patient login uses a **real
> WhatsApp OTP**; staff sign in with real accounts. The automated suites are retired (they
> needed mock mode) — test by hand using these cards.

---

## 1. Get it running (one database — Supabase)

You need **Node.js 20+** and the project's Supabase credentials. There is **no local database**
any more (DEC-054): your laptop runs the same Express code against the same live Supabase
project as https://alodoc.online.

```bash
git clone https://github.com/aliabdocytecare-jpg/alo-007.git
cd alo-007

# server/.env — ask the owner for these values (never commit them):
#   SUPABASE_URL=https://<project-ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
#   ENABLE_MOCK_AUTH=false
#   ENABLE_MOCK_WHATSAPP=false

# Terminal 1 — the API
cd server && npm install && npm run dev
# → "AloDoc API on http://localhost:3000 (database: Supabase — single source of truth, DEC-054)"

# Terminal 2 — the website
cd client && npm install && npm run dev
# → open http://localhost:5173
```

The API **refuses to boot** without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

Open **http://localhost:5173** — or just test **https://alodoc.online**. It is the same
database, so anything you do in one shows up in the other.

**Tip:** use two browser windows (or one normal + one incognito) so you can be a patient in
one and a staff member in the other at the same time.

---

## 2. Golden rules (read these once)

1. **Patient login is a real WhatsApp OTP.** Use a phone you actually control, in international
   format (e.g. `+919159007007`). The 6-digit code arrives on WhatsApp from **Everyday Ai Labs**,
   is valid **10 minutes**, and allows **5 sends/hour**. There is no `123456` any more, and no SMS.
   Each delivered code is a **billed** message — don't spam Send OTP. If **Admin → WhatsApp →
   Login OTP** is OFF you'll get *"Verification codes are unavailable right now"* (503).
2. **Real staff accounts** — demo accounts no longer exist (DEC-054 removed all seeding):

   | Role | Email | Password |
   |------|-------|----------|
   | Admin (ALO Super Admin) | `aliabdocytecare@gmail.com` | owner-held, never documented |
   | Admin | `adrian.lewis@alodoc.sa` | owner-held, never documented |

   Staff sign-in: on the login page click **"Staff sign-in"**, then email + password.
   Passwords are never written into this repo — ask the owner, or have an admin create your
   account in **Admin → Staff** (10+ chars, 1 uppercase, 1 number, 1 special character).

   **Coordinator / doctor / nurse accounts must be created by an admin** before you can test
   those flows; they are no longer generated automatically.

   **Test patients:** register with a real number you control, and prefix the name with
   `TEST — ` so test records are easy to spot and clean up in the live database.
3. **Magic links are handed to the coordinator, not printed.** Assigning an international
   specialist returns `review_url` (`/review/<48-char token>`, 72 h TTL) in the response and the
   coordinator UI. Delivering that link by WhatsApp (N-06) uses the **status updates** channel,
   which is **OFF by default** — so until an admin enables it, copy the link manually and open
   it in a browser. That's the specialist's anonymous page.
4. **Every case gets a number** like `ALO-2026-00012`. Write it down — you'll search for it.
5. **Your data is REAL and shared.** It lives in the live Supabase project alongside actual
   patient records — there is no "delete the folder and start fresh" any more. Name test
   patients `TEST — …`, note the case numbers you create, and ask an admin to clean up
   afterwards. Keep the WhatsApp **status updates** channel OFF while testing unless you
   genuinely intend to message real people.
6. **Statuses are plain-English for patients** ("Our team is reviewing your case") but
   technical for staff (`INITIAL_REVIEW`). Both are correct — don't report that as a bug.

---

## 3. The flow cards

### Flow 1 — A patient joins and signs in ✅
**Stories:** `US-PAT-001` (register), `US-PAT-002` (sign-in + lockout)

> ⚠️ **#1 thing testers get stuck on:** patients and staff log in differently.
> Staff accounts already exist, so they sign straight in. **A patient with a NEW number must
> REGISTER first** — after Send OTP the form shows *"New here? Create your patient account"*.
> Enter the code from WhatsApp, fill **Full name (required)**, then press **Register** (not "Verify").
> If you only type phone + OTP and look for a login button, you'll see *"Full name is required."*

**Steps**
1. Go to http://localhost:5173 (or https://alodoc.online) → you land on the login page.
2. Type a real phone you control, e.g. `+919159007007` → click **Send OTP**.
3. Read the 6-digit code from the **WhatsApp** message → type it in.
4. Because this number is new, a registration form appears. Fill **Full name** (prefix
   `TEST — `), **Date of birth**, **Gender** → click **Register**.
5. You should land on the patient home with three service cards.
6. Click **Logout** (top right). Sign in again with the same phone → **Send OTP** → enter the
   new code → you go straight in (no registration form this time).

**Expect**
- [ ] New number → registration form; returning number → straight to home.
- [ ] Your name shows in the top bar.
- [ ] Registering the same phone twice is refused (try it: logout, register again with the same number).

**Gap-watch**
- Try a badly-formed phone (letters, too short) — is the error friendly?
- **Lockout:** sign in with a wrong OTP (`000000`) **5 times**. The 6th attempt should say
  "Account temporarily locked…". (Use a throwaway number so you don't lock yourself out.)

**Troubleshooting (if a patient "can't get in")**
- *"Full name is required"* → it's a new number; fill the name and press **Register**.
- *"Enter a valid phone number in international format"* → include `+` and country code, e.g. `+966512345678`.
- *"Too many OTP requests"* → more than 5 Send-OTP clicks in an hour on that number; wait or use a new number.
- *"Account temporarily locked"* → 5 wrong OTPs earlier; wait 15 minutes or use a different number.
- *"No account with this number. Please register."* → you pressed Verify on a number that was never registered; go Back and Register.

---

### Flow 2 — Patient home & booking a consultation ✅
**Stories:** `US-PAT-004` (home cards), `US-PAT-005` (book consultation)

**Steps**
1. As a signed-in patient, click card **"1. Medical Consultation"**.
2. Choose **Consultation type** (Online), a **Specialty** (General Medicine), a **Doctor**,
   and a **Preferred date & time** (pick a future date).
3. Type a **Reason** (e.g. "persistent headache for a week").
4. (Optional) attach a file with **Choose files**.
5. Click **Review & Submit**.

**Expect**
- [ ] A confirmation screen with a case number `ALO-2026-#####` and payment instructions.
- [ ] **View** opens the case; **My Cases** lists it.
- [ ] The case shows a plain-English status + a "Next step" sentence.
- [ ] Your profile details are pre-filled — you never re-type your name/DOB.

**Gap-watch**
- Submit with an empty Reason — is it blocked with a clear message?
- Pick a specialty with no doctor — does it say the coordinator will match you?
- Switch language to **العربية** (top right) — does the whole page flip right-to-left?

---

### Flow 3 — The full consultation journey (the big one) ✅
**Stories:** `US-CRD-001/002/004/008`, `US-NUR-001/003/004`, `US-DOC-001/003/004/005`
**This is Bible Test A.** Use two windows: patient + staff.

**Steps**
1. **Patient:** book a consultation (Flow 2). Note the case number.
2. **Coordinator** (`coordinator@alodoc.com`): Dashboard → find the case under **New** → **Open**.
3. Type a payment note → **Confirm Payment**. (Try clicking it twice — the 2nd must be refused.)
4. In the assign dropdown pick **Nour Al-Khalidi (Nurse)** → **Assign**.
5. **Nurse** (`nurse@alodoc.com`): Dashboard → **Assigned Cases** → Open the case.
   Fill vitals (BP `120/80`, HR `72`, etc.) + nursing notes → **Save**.
   Then **Complete Intake & Route to Coordinator**.
6. **Coordinator:** reload the case → assign **Emmanuel Arcon (Doctor · General Medicine)** →
   **Assign** → pick a future date/time → **Schedule Appointment** → paste a Meet link
   (`https://meet.google.com/abc-defg-hij`) → **Google Meet link**.
7. **Doctor** (`doctor@alodoc.com`): Open the case → **Start Consultation** → fill notes →
   **Save** → add a prescription (Flow 3b) → write the **Medical report** → **Submit Final Report**.
8. **Coordinator:** reload → **Review & Release Report** → confirm.
9. **Patient:** open the case → the report is now visible with a **Print / Save as PDF** button.

**Expect**
- [ ] Nurse sees the case only after assignment; vitals save with a timestamp.
- [ ] After "Complete Intake", the nurse's form becomes **read-only**.
- [ ] Doctor sees the nurse's vitals at the top of the case.
- [ ] Before release, the patient sees "Your report is being prepared" — **not** the report.
- [ ] After release, the patient sees the report + prescriptions, status "Your case is complete".
- [ ] The case timeline grows at every hand-off.

**Gap-watch**
- Can the nurse write a report? Can the doctor confirm payment? (They must NOT — role rules.)
- Open the same case as two staff and change both — does the second get a "please refresh" message?
- Does the doctor's note **auto-save** if you wait ~60 seconds without clicking Save?

**Flow 3b — Prescriptions** (`US-DOC-003`, `F-RX`)
- Doctor case → **Prescriptions** → **Select from Formulary** → pick *Paracetamol (Panadol)*.
  Drug name / dosage / route auto-fill. Add frequency + duration → **Add Prescription**.
- Switch to **Free Text**, type any drug → **Add Prescription**.
- [ ] Both appear in the table; after release the **patient** sees them too.

---

### Flow 4 — Global Medical Opinion + international review ✅
**Stories:** `US-PAT-006`, `US-CRD-005/007`, `US-INT-001..005`
**This is Bible Test B.** The specialist has **no account** — they use a magic link.

**Steps**
1. **Patient:** click card **"2. Global Medical Opinion"** → pick Specialty + Purpose →
   Reason → attach 1–2 PDFs → tick the consent box → **Review & Submit**. Note the case number.
2. **Coordinator:** Open the case → **Confirm Payment** → under *Assign international specialist*
   type a name + phone (e.g. `+919800000001`) → **Assign**.
3. **Copy the `/review/...` link from Terminal 1** (Golden Rule #3) → open it in a **new
   incognito window** (no login!).
4. **Specialist page:** you should see the case number, **Age + Gender only** (no name!),
   the reason, and the documents (click **Preview PDF** to view).
5. Type **Clinical findings** and **Recommendation** (each ≥ 50 characters) → **Save Draft**.
6. **Reload the page** → your draft text is still there.
7. Click **Request More Information**, type a question, submit → coordinator gets notified.
8. Click **Submit Final Opinion** → confirm → "Thank you" screen.
9. **Reload again** → the link now says it's no longer active (auto-revoked).
10. **Coordinator:** reload → **Review & Release Report** → **Patient** sees the opinion.

**Expect**
- [ ] Specialist page shows **no patient name, phone, or full DOB** — only age + gender.
- [ ] Draft survives a reload (and would survive a different device).
- [ ] After submit, the same link is dead.
- [ ] Short findings (<50 chars) are blocked.

**Gap-watch**
- Change one character of the magic-link URL → friendly "invalid", never a crash or data leak.
- Try opening the link after 72h (or ask a dev to backdate it) → "expired" screen, zero case data.
- Can the specialist see another case's documents by guessing IDs? (Must be refused.)

---

### Flow 5 — Follow-up with memory ✅
**Stories:** `US-PAT-012`, `US-DOC-002` · **Bible Test C**

**Steps**
1. Finish a consultation through release (Flow 3).
2. **Patient:** open the completed case → **Request Follow-up**.
3. The booking form opens **pre-filled**: reason starts with "Follow-up:", same specialty/doctor.
4. Submit → a **new** case number is created (linked to the old one).
5. **Coordinator:** confirm payment + assign the doctor on the new case.
6. **Doctor:** open the new case → a **"Previous Consultation"** panel shows the old report.

**Expect**
- [ ] New case ≠ old case number, but the doctor sees the prior context.
- [ ] History/profile carried over — no re-typing.

**Gap-watch**
- Cancel a case, then try "Request Follow-up" on it (or paste its book URL) → must be refused.

---

### Flow 6 — Request a service (pharmacy, physio, …) ✅
**Stories:** `US-PAT-013`, `US-CRD` · **Bible Test D (service part)**

**Steps**
1. **Patient:** card **"3. Healthcare Services"** → pick a service (e.g. Pharmacy) → Reason → submit.
2. **Coordinator:** Open → **Confirm Payment** → assign a nurse → **Complete Service**.
3. **Patient:** the case shows "Your case is complete" with a service-specific message.

**Expect**
- [ ] A completed service does **not** promise a medical report (there isn't one).
- [ ] "Coming Soon" services can't be booked (see Flow 8).

---

### Flow 7 — When things go wrong (exception paths) ✅
**Stories:** `US-CRD-003/009/010`, `US-PAT-010`

**Steps**
1. **Coordinator** on a fresh case → **Request Documents** with a note ("please upload your ID").
2. **Patient:** the case says "We need a few more documents" + shows the note. Upload a file.
3. The case **automatically returns** to "Our team is reviewing your case".
4. **Coordinator:** **Escalate** with a note → an `[Escalate]` flag appears (admin is alerted).
5. **Coordinator:** **Cancel Case** with a reason → status "Cancelled".
6. **Patient:** sees "Cancelled" + the reason in the timeline; no follow-up buttons.

**Expect**
- [ ] Cancel **requires** a reason (empty is blocked).
- [ ] Upload after a document request resumes the case without staff action.
- [ ] A cancelled case offers no follow-up / related-service actions.

---

### Flow 8 — Admin console ✅
**Stories:** `US-ADM-001/003/004/005/007`

Sign in as `admin@alodoc.com` → top nav **Admin**.

**Steps & Expect**
- **Staff Management:** create a new staff account → it appears → **Deactivate** → shows Inactive.
  - [ ] A deactivated staff member can no longer sign in.
- **Drug Formulary:** seeded drugs listed (Paracetamol, Ibuprofen…); add one; deactivate it.
- **Services:** turn a service **OFF** → it disappears from the patient booking list.
  Turn **Coming Soon ON** → it shows but is greyed out / not bookable. Turn back ON.
- **SLA Targets:** change a target minutes value → **Save** → "OK" → reload → it persisted.
- **Audit Logs:** filter by role `nurse` → **Apply** → you see entries like `INTAKE_COMPLETED`.
  - [ ] Audit is read-only — there is no edit/delete button anywhere.

**Gap-watch**
- Open a patient's case as admin → that access must be **logged** in the audit trail.

---

### Flow 9 — Notifications ✅
**Stories:** `F-NOTIF`, notification matrix `N-01..N-14`

**Steps**
1. As a patient with activity, click **Notifications** in the top nav (it shows `[n]` unread).
2. Open it → messages like "your report is ready". Click **Mark read** → the unread count drops.
3. As staff, check you received assignment / intake / report notifications.

**Expect**
- [ ] Unread badge decreases after marking read.
- [ ] In-app notifications appear. WhatsApp delivery is **skipped** while the status-updates
      channel is OFF (`notification_log.delivery_status = skipped`, reason `notify_disabled`).

> ℹ️ Email/SMS show as "queued" in the log — real providers aren't wired yet (see Limitations).

---

### Flow 10 — Try to break it (security) ✅
**Bible Test E.** Be the villain 😈 — these are *expected* to fail safely.

- [ ] Patient A opens Patient B's case URL → **403 / refused**, and it's logged.
- [ ] A nurse opens a case they're not assigned to → refused.
- [ ] A doctor tries to confirm payment; a coordinator tries to write clinical notes → refused.
- [ ] Guess magic-link tokens rapidly → after a burst you get "too many attempts" (rate limit).
- [ ] Upload a `.exe` renamed to `.pdf`, or a >50MB file → rejected with a friendly message.
- [ ] SQL-ish text in a reason field (`'; drop table cases;--`) → stored as plain text, nothing breaks.

---

### Flow 11 — Arabic & mobile ✅
**Story:** P7 (bilingual), mobile-first specialist page

- [ ] Toggle **العربية** on patient pages → layout flips RTL, labels translate, file buttons translate.
- [ ] Toggle on a **staff** page (e.g. Admin) → also RTL.
- [ ] Open the specialist `/review/...` link on a phone (or narrow the window) → readable, usable.
- [ ] Tables on a narrow screen scroll sideways instead of breaking the layout.

---

### Flow 12 — Hospital Day-Clinic Engine ✅
**Stories:** DEC-056, DEC-057, DEC-058. Multi-tenant clinic operations, kiosk, queue, doctor desk, lab & pharmacy.

**Steps**
1. **Hospital Staff Sign-In:** On `/login`, click "Hospital Clinic Staff" tab. Enter staff WhatsApp phone number (e.g. `+966500000001`), verify OTP, and access `/hospital/dashboard`.
2. **Kiosk Setup & Pairing:** Open `/kiosk` on tablet. Enter 6-digit hospital kiosk PIN (from `hospitals.kiosk_pin`) → pairs device and shows check-in keypad.
3. **Patient Self Check-In:** Enter 6-character check-in code (e.g. `K9X2M4`) or national ID/MRN → receives daily queue number slip (`A-001`) with estimated wait time (`~15 min`).
4. **Waiting Room Display:** Open `/screen/waiting` on waiting room TV monitor → displays live Riyadh clock, "Now Calling" board (`A-001 -> Clinic 3`), and waiting queue.
5. **Doctor Consultation Desk:** On `/hospital/dashboard` (Doctor tab), call patient `A-001` → status updates to `in_clinic`, chime triggers on waiting screen. Record clinical notes, diagnosis, and follow-up plan.
6. **Specimen Tube Barcode & Lab Order:** Order lab tests from catalogue (e.g. CBC, Lipid Profile). System generates `SPEC-<HOSP>-<HEX>` with pure-JS Code 128B SVG barcode for specimen tube labeling.
7. **Lab Workbench:** In Lab tab, enter test results with normal/abnormal/critical flags. If correcting an error, enter rationale → previous values are immutably archived in `previous_versions` jsonb history.
8. **Pharmacy Dispensing:** In Pharmacy tab, view prescribed medications from consultation. Click "Dispense" → records pharmacist ID, timestamp, and transitions case to `completed`.

**Expect**
- [ ] Multi-tenant isolation: Hospital A staff cannot query Hospital B records (returns 404).
- [ ] Barcode SVG renders crisp Code 128B stripes scannable by physical barcode wands.
- [ ] Lab amendments preserve complete audit trail with timestamps and reasons.

---

### Flow 13 — Bridge 1: Online Intake ➔ Saudi Hospital Referral ✅
**Stories:** DEC-056, DEC-060. Seamless transition from online intake to physical day-clinic consultation.

**Steps**
1. Patient completes online intake on `/intake`.
2. ALO Nurse reviews intake on `/staff/cases/:id` and approves bilingual AI summary.
3. In case actions, click **"Refer to Saudi Hospital Clinic"**.
4. Select partner hospital (e.g. King Fahad Specialist Hospital) and choose an available consultation slot from the live slot selector.
5. Click **"Confirm & Book Clinic Appointment"**.

**Expect**
- [ ] **Single Atomic Transaction:** Slot status changes from `free` to `booked` in `hospital_slots` (database constraint rejects double-booking).
- [ ] Clinic case created in `hospital_cases` with sequential daily case number (`C-0001`) and 6-character check-in code.
- [ ] Remote case timeline records `HOSPITAL_REFERRED` with handoff payload.
- [ ] Patient receives WhatsApp confirmation with clinic address, date/time, and 6-char check-in code linking to `/p/:code`.

---

### Flow 14 — Bridge 2: Saudi Hospital Doctor ➔ International Second Opinion ✅
**Stories:** DEC-056, DEC-060. Clinic doctor requests global specialist second opinion with patient consent.

**Steps**
1. On `/hospital/dashboard`, Saudi clinic doctor opens an active clinic case.
2. Under "Second Opinion", check **"Patient Consent Confirmed"**, enter patient consenting name and clinical question (e.g. "Evaluate surgical margins and adjuvant protocol").
3. Submit request → enters ALO Coordinator queue on `/staff/intl-opinions`.
4. Coordinator reviews request, selects an international specialist from curated directory (e.g. MD Anderson, Mayo Clinic, Charité), and clicks **"Dispatch"**.
5. Specialist opens secure 48-char token link `/review/intl/:token`.
6. Specialist reviews clinical question and attached scans (privacy-filtered: zero internal hospital notes or patient contact info exposed), selects decision chips, types opinion, and submits.

**Expect**
- [ ] Specialist token revoked immediately upon submission (single-use).
- [ ] Opinion text automatically appends to the Saudi patient's chart timeline (`hospital_case_timeline`).
- [ ] Saudi clinic doctor receives in-app alert that international opinion is attached to patient chart.

---

### Flow 15 — Case Portal Enhancements: AI Summary, Checklist & Multi-Round Reviews ✅
**Stories:** DEC-056, DEC-059. Advanced coordinator tools and mobile specialist review pipeline.

**Steps**
1. **Bilingual AI Summary:** Coordinator opens remote case → clicks "Generate AI Summary". System produces structured bilingual schema (presentation, findings, questions, red flags) in English and Arabic. Coordinator edits and clicks "Approve".
2. **Itemized Reports Checklist:** Coordinator clicks "Request Missing Documents", adds required items (e.g. "Recent Pelvic MRI DICOM", "Histopathology Report from Biopsy"). Patient receives WhatsApp link to `/upload-reports/:token`.
3. **Patient Fulfillment:** Patient uploads files against specific checklist items → case returns to `INITIAL_REVIEW` when fulfilled.
4. **Multi-Round Specialist Reviews:** Coordinator dispatches round 2 review. System captures immutable `case_snapshot` for "Then vs. Now" longitudinal diffing.
5. **Specialist Mobile Dictation:** Specialist on `/review/:token` records voice dictation note using HTML5 audio recorder, chooses Decision Chips (Agreement, Path, Urgency), fills 4-box opinion, and submits. Audio is saved to Supabase storage `case-documents/voice-notes/`.
6. **3-Step Final Report Synthesis:**
   - Step 1: Coordinator compiles bilingual report (`final_report_en`, `final_report_ar`).
   - Step 2: Coordinator verifies 4-point Clinical Safety Checklist.
   - Step 3: Releasing report sets `final_report_published = true`, transitions case to `COMPLETED`, and alerts patient.

---

## 4. Automated Verification Test Suites

In addition to manual testing, four comprehensive automated verification scripts validate the new database constraints, multi-tenant boundaries, and native bridge transactions against the live Supabase database without creating un-scrubbed mock data:

```bash
# 1. Environment & Database Preflight (13 checks)
cd server && npm run preflight

# 2. Phase 2: Tenancy Scoping & WhatsApp OTP Staff Auth (12 checks)
node server/scripts/test-phase2.mjs

# 3. Phase 3: Hospital Day-Clinic Engine & Barcodes (19 checks)
node server/scripts/test-phase3.mjs

# 4. Phase 4: Case Portal Enhancements & Multi-Round Reviews (17 checks)
node server/scripts/test-phase4.mjs

# 5. Phase 5: Bridge 1 & Bridge 2 Native Transactions (17 checks)
node server/scripts/test-phase5.mjs

# 6. Real-Time Queue Stream (SSE & Chime) & Medical Report PDF Generation
NO_LISTEN=1 node --env-file=server/.env server/scripts/test-phase7-enhancements.mjs

# 7. Frontend Production Compilation (Vite build)
npm --prefix client run build
```

*Note: All test scripts clean up their temporary test rows (`TEST — …`) upon completion, ensuring zero database pollution.*

---

## 5. The legacy robot tests are retired (DEC-054)

Both automated suites depended on the world we just removed: mock OTP `123456`, demo staff
accounts, and a disposable local database. They also **create patients and cases**, which would
now land in the **live** database. So they refuse to run by default:

```bash
cd client && npm run test:ui     # → "UI suite retired (DEC-054)…"
cd server && npm run e2e         # → "Retired (DEC-054)…"
```

The specs are kept for reference (`client/e2e/`, `server/scripts/e2e.mjs`), and the historical
screenshots in `client/e2e-shots/` still show what each flow looked like. The ✅ marks on the
flow cards mean "this flow used to have automated proof".

**Test by hand instead** — that's what these cards are for. If you ever need the robots back,
they must be re-pointed at a disposable database with real seeded staff and run with
`E2E_ALLOW=true`. Never do that against the production project.

---

## 6. Known limitations — please DON'T report these as bugs 🙏

These are deliberate, documented decisions (see `decisions.md`):

| Thing | Status |
|-------|--------|
| WhatsApp messages | Real sending via Meta Cloud API, configured in **Admin → WhatsApp**. **Two independent switches**, both **OFF by default**: *Login OTP* and *Status updates* (DEC-051/053). Only AUTHENTICATION/UTILITY templates are allowed (DEC-052) |
| Email / SMS | Logged as "queued" — providers not wired yet |
| Google Meet | Coordinator pastes a link manually; no auto-created meetings |
| Live updates | Pages refresh on action / every 30s; no real-time push yet |
| Arabic wording | Provisional — needs a native speaker's review |
| Print / PDF | Uses the browser's print dialog, not a server-generated PDF |
| OTP | Real 6-digit WhatsApp code · 10-minute validity · 5 sends/hour · 5 wrong attempts → 15-minute lock. No mock code exists |
| Expiry / job tests (E6, E15) | Retired with the local database — they backdated rows directly in SQLite |
| Local database | **Removed** (DEC-054). Supabase is the single source of truth for every environment |

If you find something **outside** this list — that's a real gap. Tell us!

---

## 7. How to report a gap (30 seconds)

Open a GitHub Issue: https://github.com/aliabdocytecare-jpg/alo-007/issues → **New issue**.

```
Flow / Story:   e.g. Flow 4 / US-INT-002
What I did:     1) ... 2) ... 3) ...
What I expected: ...
What happened:  ...
Screenshot:     (drag one in — huge help!)
Browser/phone:  e.g. Chrome on Mac / Safari on iPhone
Severity:       blocker / annoying / cosmetic
```

**Severity guide:** *blocker* = can't continue or data leaks; *annoying* = works but wrong/confusing;
*cosmetic* = looks off. When in doubt, report it — we'd rather hear twice than miss once. 💛

---

## 7. Quick reference

- **Patient portal:** http://localhost:5173 · **API:** http://localhost:3000
- **Patient statuses (plain English):** received → reviewing → need documents → matching →
  assigned → under review / appointment confirmed → in progress → report being prepared →
  complete / follow-up / cancelled.
- **Where's the magic link?** Server terminal (Terminal 1), the `[WhatsApp mock -> specialist...]` line.
- **Reset everything:** stop server → delete `server/.data/` → restart.
- **Decisions & rationale:** `decisions.md` · **Build plan:** `PLAN.md` · **Setup/deploy:** `README.md`.

Happy testing — break it kindly, report it clearly. 🚀