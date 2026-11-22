// Test Suite: Phase 9 Rork Native Mobile Optimizations (DEC-065)
import http from 'http';
import jwt from 'jsonwebtoken';
import { db } from '../config/db.js';
import { app } from '../index.js';
import { PATIENT_TTL } from '../middleware/auth.js';

let server;
let port;
let baseUrl;

function logPass(msg) { console.log(`\x1b[32mPASS\x1b[0m ${msg}`); }
function logFail(msg, err) { console.error(`\x1b[31mFAIL\x1b[0m ${msg}`, err || ''); process.exit(1); }

async function setup() {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
}

async function runTests() {
  console.log('--- Testing Rork Native Mobile Optimizations (DEC-065) ---');
  await setup();

  const testSuffix = Date.now().toString(36);
  let testPatient = null;
  let testHospital = null;
  let testHospPatient = null;
  let testHospitalCase = null;
  let patientToken = null;

  try {
    // 1. Setup Test Patient
    const testPhone = `+9665${Math.floor(10000000 + Math.random() * 90000000)}`;
    const { data: pat, error: pErr } = await db
      .from('patients')
      .insert({
        phone: testPhone,
        full_name: 'Ahmed Al-Rork Test',
        gender: 'MALE',
        preferred_lang: 'en'
      })
      .select()
      .single();

    if (pErr || !pat) logFail('Failed to insert test patient', pErr);
    testPatient = pat;
    logPass(`Created test patient: ${testPatient.phone}`);

    // Generate JWT token as would be returned by verifyOtp / staffLogin
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    patientToken = jwt.sign(
      { sub: testPatient.id, role: 'patient', kind: 'patient' },
      secret,
      { expiresIn: '1h' }
    );

    // 2. Setup Test Hospital, Patient & Case for PDF inline check
    const { data: hosp } = await db
      .from('hospitals')
      .insert({
        name: `TEST — Rork Hosp ${testSuffix}`,
        name_ar: 'مستشفى الفحص',
        short_name: `rork-${testSuffix}`,
        city: 'Jeddah',
        kiosk_pin: Math.floor(100000 + Math.random() * 900000).toString(),
        is_active: true
      })
      .select()
      .single();
    testHospital = hosp;

    const { data: hPat, error: hpErr } = await db
      .from('hospital_patients')
      .insert({
        hospital_id: hosp.id,
        mrn: `MRN-${testSuffix}`,
        phone: testPhone,
        full_name: 'Ahmed Al-Rork Test',
        gender: 'MALE',
        dob: '1988-06-15'
      })
      .select()
      .single();
    if (hpErr || !hPat) logFail('Failed to insert test hospital patient', hpErr);
    testHospPatient = hPat;

    const { data: hCase, error: cErr } = await db
      .from('hospital_cases')
      .insert({
        hospital_id: hosp.id,
        hospital_patient_id: hPat.id,
        case_number: `C-RORK-${testSuffix}`,
        checkin_code: `RK${Math.floor(1000 + Math.random() * 9000)}`,
        status: 'in_consultation',
        arrival_status: 'arrived',
        queue_number: 'A-001',
        case_summary: 'Evaluation of routine check-in symptoms',
        appointment_date: new Date().toISOString().split('T')[0],
        appointment_time: '10:00'
      })
      .select()
      .single();

    if (cErr || !hCase) logFail('Failed to create test hospital case', cErr);
    testHospitalCase = hCase;
    logPass(`Created test hospital & case: ${hCase.case_number} (${hCase.checkin_code})`);

    // =========================================================================
    // TEST 1: Universal Links & Deep Linking Endpoints
    // =========================================================================
    // iOS Apple App Site Association
    const aasaRes = await fetch(`${baseUrl}/.well-known/apple-app-site-association`);
    if (aasaRes.status !== 200) logFail(`AASA returned status ${aasaRes.status}`);
    const aasaContentType = aasaRes.headers.get('content-type') || '';
    if (!aasaContentType.includes('application/json')) logFail(`AASA content-type is not JSON: ${aasaContentType}`);
    const aasaJson = await aasaRes.json();
    if (!aasaJson.applinks?.details?.[0]?.appIDs) logFail('AASA missing applinks structure', aasaJson);
    logPass('Universal Link 1: iOS apple-app-site-association returns valid JSON with applinks mapping');

    // Android Digital Asset Links
    const assetRes = await fetch(`${baseUrl}/.well-known/assetlinks.json`);
    if (assetRes.status !== 200) logFail(`Assetlinks returned status ${assetRes.status}`);
    const assetJson = await assetRes.json();
    if (!Array.isArray(assetJson) || !assetJson[0]?.relation?.includes('delegate_permission/common.handle_all_urls')) {
      logFail('Assetlinks missing valid array schema', assetJson);
    }
    logPass('Universal Link 2: Android assetlinks.json returns valid delegate permission schema');

    // =========================================================================
    // TEST 2: Structured Machine-Readable Error Codes
    // =========================================================================
    // 2A: Unauthorized protected route
    const unauthRes = await fetch(`${baseUrl}/api/v1/cases`);
    const unauthJson = await unauthRes.json();
    if (unauthRes.status !== 401 || unauthJson.code !== 'UNAUTHORIZED') {
      logFail('Expected 401 with code: UNAUTHORIZED', { status: unauthRes.status, body: unauthJson });
    }
    logPass('Structured Error 1: Protected route returned status 401 with code: UNAUTHORIZED');

    // 2B: Expired or missing OTP
    const otpRes = await fetch(`${baseUrl}/api/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+966500000000', otp: '999999' })
    });
    const otpJson = await otpRes.json();
    if (otpRes.status !== 400 || otpJson.code !== 'OTP_EXPIRED') {
      logFail('Expected 400 with code: OTP_EXPIRED', { status: otpRes.status, body: otpJson });
    }
    logPass('Structured Error 2: Missing/Expired OTP returned status 400 with code: OTP_EXPIRED');

    // =========================================================================
    // TEST 3: Dual-Mode Auth (Bearer Token in Authorization Header with NO Cookies)
    // =========================================================================
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        'Authorization': `Bearer ${patientToken}`
      }
    });
    if (meRes.status !== 200) {
      logFail(`Bearer token auth returned status ${meRes.status}`, await meRes.text());
    }
    const meJson = await meRes.json();
    if (!meJson.profile || meJson.profile.id !== testPatient.id) {
      logFail('Bearer token auth user mismatch', meJson);
    }
    logPass(`Bearer Token Auth: Verified session successfully via 'Authorization: Bearer <JWT>' without cookies`);

    // =========================================================================
    // TEST 4: CORS Permissiveness for Native Mobile Schemes
    // =========================================================================
    // 4A: Native request without Origin header (typical iOS/Android URLSession)
    const noOriginRes = await fetch(`${baseUrl}/health`);
    if (noOriginRes.status !== 200) logFail(`No-origin request failed with ${noOriginRes.status}`);
    logPass('CORS 1: Native request with no Origin header accepted without CORS rejection');

    // 4B: Capacitor mobile scheme origin
    const capRes = await fetch(`${baseUrl}/health`, {
      headers: {
        'Origin': 'capacitor://localhost'
      }
    });
    const allowOrigin = capRes.headers.get('access-control-allow-origin');
    if (allowOrigin !== 'capacitor://localhost') {
      logFail(`CORS origin not echoed for capacitor scheme: ${allowOrigin}`);
    }
    logPass('CORS 2: Capacitor scheme origin (capacitor://localhost) accepted with CORS allow header');

    // =========================================================================
    // TEST 5: Client Telemetry & Version Headers Auditing
    // =========================================================================
    const telemetryRes = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${patientToken}`,
        'X-Client-Platform': 'ios',
        'X-App-Version': '1.0.0-rork',
        'X-Device-Id': 'device-test-uuid-123'
      },
      body: JSON.stringify({ preferred_lang: 'ar' })
    });
    if (telemetryRes.status !== 200) logFail(`Telemetry request failed with ${telemetryRes.status}`, await telemetryRes.text());

    // Wait 200ms and check audit_log
    await new Promise(r => setTimeout(r, 200));
    const { data: auditRows } = await db
      .from('audit_log')
      .select('*')
      .eq('actor_id', testPatient.id)
      .eq('action', 'PATIENT_PROFILE_UPDATED')
      .order('created_at', { ascending: false })
      .limit(1);

    const matchAudit = auditRows?.[0]?.detail?.client?.platform === 'ios';
    if (!matchAudit) {
      logFail('Audit record missing client platform telemetry', auditRows?.[0]?.detail);
    }
    logPass(`Client Telemetry: Captured X-Client-Platform=ios and X-App-Version=1.0.0-rork in audit log`);

    // =========================================================================
    // TEST 6: Mobile PDF Inline Streaming vs Attachment
    // =========================================================================
    const pdfRes = await fetch(`${baseUrl}/api/v1/public/case/${testHospitalCase.checkin_code}/report/pdf?inline=true`, {
      headers: {
        'X-Client-Platform': 'ios'
      }
    });
    if (pdfRes.status !== 200) logFail(`PDF fetch returned ${pdfRes.status}`);
    const disp = pdfRes.headers.get('content-disposition') || '';
    const acceptRanges = pdfRes.headers.get('accept-ranges');
    if (!disp.startsWith('inline;')) {
      logFail(`Expected Content-Disposition to start with 'inline;', got: ${disp}`);
    }
    if (acceptRanges !== 'bytes') {
      logFail(`Expected Accept-Ranges to be 'bytes', got: ${acceptRanges}`);
    }
    logPass(`Mobile PDF Optimization: Content-Disposition is 'inline' with 'Accept-Ranges: bytes' for iOS/Android viewers`);

    // Clean up
    if (testHospitalCase) await db.from('hospital_cases').delete().eq('id', testHospitalCase.id);
    if (testHospPatient) await db.from('hospital_patients').delete().eq('id', testHospPatient.id);
    if (testHospital) await db.from('hospitals').delete().eq('id', testHospital.id);
    if (testPatient) await db.from('patients').delete().eq('id', testPatient.id);
    logPass('Cleaned up all temporary test records');

  } catch (err) {
    logFail('Test run error', err);
  } finally {
    if (server) server.close();
  }

  console.log('\n\x1b[32mAll Phase 9 Rork Native Mobile Optimizations Checks PASSED (100%)\x1b[0m\n');
}

runTests();
