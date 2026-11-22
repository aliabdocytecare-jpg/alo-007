# AloDoc — Rork Native Mobile App Blueprint (iOS & Android)

This blueprint provides the exact architectural specification, API contracts, and prompt templates to feed into **Rork** for generating true platform-native applications (**SwiftUI for iOS** and **Jetpack Compose for Android**) against the AloDoc backend.

---

## 1. Core Architectural Guidelines for Rork

1. **Zero Hardcoded Business Logic (Thin Client):**
   * Do not let Rork hardcode case state transitions or medical rules in Swift/Kotlin.
   * The AloDoc Express API (`https://alodoc.online/api/v1`) returns the active status badge, localized label, next step guidance, and allowed actions array. The app simply renders what the server returns.
2. **Version Shielding on Launch:**
   * Every app launch checks `GET /api/v1/app/version-check?platform=ios` (or `android`). If `force_update: true`, it displays a non-dismissible update modal linking to the App Store or Google Play Store.
3. **Strict Monochrome High-Contrast Styling (DEC-004):**
   * Background: `#FFFFFF` (Light) / `#000000` (Dark)
   * Primary Text & Heavy Borders: `#000000` (Light) / `#FFFFFF` (Dark)
   * Muted Text: `#666666`
   * Borders: `2px solid #000000` (sharp, no rounded pill cards)
   * System Typography: San Francisco (`SF Pro`) on iOS, `Roboto` on Android.
4. **Bilingual RTL Support (Arabic & English):**
   * Native layout automatically flips RTL when the user selects Arabic.
   * Send header `Accept-Language: ar` or `en` with all API requests.
5. **Native Hardware Integrations:**
   * **Push Notifications (APNs / FCM):** To wake the app when a queue ticket or medical report is ready.
   * **Device Vibration (`UIImpactFeedbackGenerator` on iOS / `Vibrator` on Android):** When patient queue ticket `A-001` is called into clinic (`in_clinic`).
   * **Camera Document Scanner:** To capture multi-page medical records and PDFs for case intake.

---

## 2. Screen Hierarchy & Navigation Flow

```
┌───────────────────────────────────────────────────────────┐
│              RORK NATIVE MOBILE APPLICATION               │
└─────────────────────────────┬─────────────────────────────┘
                              │
                    Launch / Version Check
               (GET /api/v1/app/version-check)
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
       Patient Journey              Hospital Staff Journey
    (WhatsApp Phone + OTP)          (WhatsApp Phone + OTP)
               │                             │
    ┌──────────┴──────────┐       ┌──────────┴──────────┐
    ▼                     ▼       ▼                     ▼
My Cases & Intake    Live Queue   Reception Desk     Doctor Desk
 (PDF Reports &       Tracker     (Queue checkin    (Consultation,
  Scans Preview)    (Vibration &   & walk-in reg)    Lab Barcodes &
                     SSE Stream)                     Dispensing)
```

---

## 3. API Integration Contract (Endpoints Reference)

* **Base URL:** `https://alodoc.online/api/v1`
* **Standard Headers:**
  * `Authorization: Bearer <JWT>`
  * `X-Client-Platform: ios` or `android`
  * `X-App-Version: 1.0.0`
  * `Accept-Language: ar` or `en`
* **Error Response Contract (DEC-065):**
  * HTTP 4xx/5xx: `{ "ok": false, "error": "Human readable message", "code": "MACHINE_CODE" }`
  * Standard error codes: `UNAUTHORIZED`, `INVALID_OTP`, `OTP_EXPIRED`, `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `CASE_NOT_FOUND`

### 3.1 App Version Guard & Universal Links
* Version Check: `GET /app/version-check?platform={ios|android}&version={1.0.0}`
  * Response: `{ ok: true, min_required_version: "1.0.0", force_update: false, store_url: "..." }`
* iOS Universal Links: `GET /.well-known/apple-app-site-association`
* Android App Links: `GET /.well-known/assetlinks.json`

### 3.2 Passwordless WhatsApp Authentication
* **Patient Login:**
  * Send OTP: `POST /auth/send-otp` `{ phone: "+966500000000" }`
  * Verify OTP: `POST /auth/verify-otp` `{ phone: "+966500000000", otp: "123456" }` ➔ Returns `{ ok: true, registered: true, token, user }`
* **Hospital Staff Login:**
  * Send OTP: `POST /auth/staff/otp/send` `{ phone: "+966500000000" }`
  * Verify OTP: `POST /auth/staff/otp/verify` `{ phone: "+966500000000", otp: "123456" }` ➔ Returns `{ ok: true, token, user }`
  * Dual-Role Chooser (if phone is both staff & patient): `POST /auth/choose-role` `{ challenge, role: "staff"|"patient" }` ➔ Returns `{ ok: true, token, user }`

### 3.3 Patient Case Management & Intake
* List Cases: `GET /cases`
* Case Details: `GET /cases/:id`
* Submit Case Intake: `POST /cases` (Multipart form-data: reason, specialty, history, scans)
* Download Medical Report PDF (Inline preview supported): `GET /cases/:id/report/pdf?inline=true`

### 3.4 Mobile Live Queue Tracker (`/p/:code`)
* Snapshot: `GET /public/case/:code`
* Real-Time Stream: `GET /public/case/:code/stream` (SSE EventSource with 20s heartbeat ping)
  * When `arrival_status == 'in_clinic'` or `just_called == true` ➔ Trigger native vibration + alert.
* Download Clinic Visit Summary PDF (Inline preview supported): `GET /public/case/:code/report/pdf?inline=true`

### 3.5 Hospital Staff Operations (Scoped to Tenant Hospital)
* Reception Queue: `GET /hospital/reception/queue`
* Check-in Patient: `POST /hospital/reception/checkin` `{ checkin_code: "ABC789" }`
* Update Arrival Status (Call Patient): `POST /hospital/reception/arrival` `{ case_id, arrival_status: "in_clinic" }`
* Doctor Save Consultation & Opinion: `POST /hospital/cases/:id/opinion` `{ doctor_opinion, status: "completed" }`
* Order Lab Test: `POST /hospital/lab/tests` `{ hospital_case_id, test_catalogue_id, priority }`
* Download Clinic Visit Summary PDF: `GET /hospital/cases/:id/report/pdf?inline=true`

### 3.6 Web-to-Native Bridge Protocol (for Hybrid Screens)
For screens embedded in a native `WKWebView` (iOS) or `WebView` (Android), the frontend exposes `NativeBridge` in `client/src/lib/nativeBridge.js`:
* **iOS Handler:** `window.webkit.messageHandlers.aloBridge.postMessage({ action, ...payload })`
* **Android Interface:** `window.AndroidBridge.postMessage(JSON.stringify({ action, ...payload }))`
* **Actions:** `haptic`, `scan_request`, `ticket_called`, `logout`

---

## 4. Master Prompt Templates for Rork

### Prompt 1: Project Initialization & Base Architecture
> *"Build an iOS (SwiftUI) and Android (Jetpack Compose) healthcare app called 'AloDoc' connecting to our REST API at https://alodoc.online/api/v1. The design must be strict high-contrast monochrome (pure black `#000000` and pure white `#FFFFFF` with 2px borders, sharp corners, and system fonts). Do not hardcode medical workflows or business rules in the mobile code; consume all case statuses, action buttons, and instructions dynamically from the API. Implement full bilingual support for English (LTR) and Arabic (RTL) with instant language toggle. On app launch, query `/api/v1/app/version-check`; if `force_update` is true, show a non-dismissible update prompt."*

### Prompt 2: Authentication & Dual Role Support
> *"Implement passwordless WhatsApp OTP authentication. The login screen should have two tabs: 'Patient Sign-In' (calling `/auth/send-otp` and `/auth/verify-otp`) and 'Hospital Clinic Staff' (calling `/auth/staff/otp/send` and `/auth/staff/otp/verify`). Format Saudi phone numbers with country code `+966`. Store the issued JWT token securely in iOS Keychain / Android EncryptedSharedPreferences and attach `Authorization: Bearer <token>` to all subsequent requests. If the API returns `{ needsRole: true }`, present a clean native modal allowing the user to select between 'Access Patient Portal' or 'Access Clinic Staff Desk'."*

### Prompt 3: Patient Portal & Live Queue Tracker with Vibration
> *"Build the Patient Home and Case Tracker. When viewing a day-clinic appointment with a 6-character check-in code, connect to the Server-Sent Events stream `/api/v1/public/case/:code/stream`. When the server pushes an update where `arrival_status` changes to `in_clinic`, trigger a native haptic vibration pattern (`UIImpactFeedbackGenerator` on iOS, `Vibrator` on Android) and show a high-contrast black alert banner saying: 'YOU HAVE BEEN CALLED - Proceed to Doctor Clinic Room'. If `doctor_opinion` or `completed` status exists, provide a button to download the clinic visit summary PDF from `/api/v1/public/case/:code/report/pdf` and open it in the native document viewer."*

### Prompt 4: Hospital Clinic Operations (Reception & Doctor Desks)
> *"For staff users, render the Hospital Operations Dashboard. The Reception desk displays today's live queue with instant search filtering by patient name, MRN, or 6-char check-in code. Tapping 'Check In' calls `/hospital/reception/checkin`. The Doctor desk displays the waiting queue; tapping 'Call into Clinic' sets `arrival_status: in_clinic` via `/hospital/reception/arrival`. In the consultation view, allow the doctor to dictate or type clinical notes and diagnosis, prescribe medications, and order lab tests from the catalogue. Include a button to download the official clinic visit summary PDF."*
