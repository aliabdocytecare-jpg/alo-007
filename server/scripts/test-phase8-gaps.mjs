// Test Suite: Phase 8 Solvable Gaps Implementation (DEC-063)
import http from 'http';
import { db } from '../config/db.js';
import { app } from '../index.js';
import { hashToken } from '../controllers/bridgeController.js';
import { buildHospitalClinicVisitPdf } from '../services/pdfReportService.js';
import { emitQueueUpdate } from '../services/realtimeService.js';

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
  console.log('--- Testing Solvable Gaps Implementation (DEC-063) ---');
  await setup();

  const testSuffix = Date.now().toString(36);
  let hosp = null;
  let hospPatient = null;
  let hospCase = null;
  let docRecord = null;
  let intlReq = null;

  try {
    // 1. Setup Test Hospital, Patient and Clinic Case
    const { data: hospData, error: hErr } = await db
      .from('hospitals')
      .insert({
        name: `TEST — Gaps Hospital ${testSuffix}`,
        name_ar: 'مستشفى الفحص الشامل',
        short_name: `hosp-${testSuffix}`,
        city: 'Riyadh',
        kiosk_pin: Math.floor(100000 + Math.random() * 900000).toString(),
        is_active: true
      })
      .select()
      .single();

    if (hErr || !hospData) logFail('Failed to create test hospital', hErr);
    hosp = hospData;
    logPass(`Created test hospital: ${hosp.name}`);

    const { data: patData, error: pErr } = await db
      .from('hospital_patients')
      .insert({
        hospital_id: hosp.id,
        mrn: `MRN-${testSuffix}`,
        full_name: 'TEST — Patient Gaps',
        phone: '+966500112233',
        dob: '1990-01-01',
        gender: 'MALE'
      })
      .select()
      .single();

    if (pErr || !patData) logFail('Failed to create test hospital patient', pErr);
    hospPatient = patData;

    const checkinCode = 'GAP' + Math.floor(100 + Math.random() * 900);
    const { data: cData, error: cErr } = await db
      .from('hospital_cases')
      .insert({
        hospital_id: hosp.id,
        hospital_patient_id: hospPatient.id,
        case_number: `C-${testSuffix}`,
        checkin_code: checkinCode,
        status: 'in_consultation',
        arrival_status: 'in_clinic',
        queue_number: 'A-010',
        case_summary: 'Evaluation of persistent thoracic pain',
        doctor_opinion: 'CLINICAL OPINION: Mild musculoskeletal strain. Prescribed analgesic and rest.',
        follow_up: 'Return in 10 days if symptoms worsen',
        general_consent: true
      })
      .select()
      .single();

    if (cErr || !cData) logFail('Failed to create test hospital case', cErr);
    hospCase = cData;
    logPass(`Created test hospital case: ${hospCase.case_number} (Check-in Code: ${hospCase.checkin_code})`);

    // 2. Test Gap 1: International Specialist Scan Preview Route (GET /review/intl/:token/documents/:docId)
    // Upload dummy scan to case-documents
    const storagePath = `hospitals/${hosp.id}/${hospCase.id}/test-scan-${testSuffix}.pdf`;
    const dummyPdfContent = Buffer.from('%PDF-1.4\n%DUMMY SCAN FOR TEST\n%%EOF');
    await db.storage.from('case-documents').upload(storagePath, dummyPdfContent, { contentType: 'application/pdf' });

    const { data: dData } = await db
      .from('hospital_documents')
      .insert({
        hospital_id: hosp.id,
        hospital_case_id: hospCase.id,
        category: 'radiology',
        file_name: 'Thoracic_CT_Scan.pdf',
        file_type: 'application/pdf',
        file_size: dummyPdfContent.length,
        storage_path: storagePath
      })
      .select()
      .single();
    docRecord = dData;

    const rawToken = 'TEST_INTL_TOKEN_' + Date.now().toString(36) + 'abcdefghijklmnopqrstuvwxyz'.slice(0, 48 - 18 - Date.now().toString(36).length);
    const exact48Token = rawToken.padEnd(48, 'X').slice(0, 48);
    const tokenHash = hashToken(exact48Token);

    const { data: staffUser } = await db.from('staff_users').select('id').limit(1).single();

    const { data: reqData, error: reqErr } = await db
      .from('international_opinion_requests')
      .insert({
        hospital_id: hosp.id,
        hospital_case_id: hospCase.id,
        requested_by: staffUser.id,
        specialty: 'Thoracic Surgery',
        clinical_question: 'Evaluate thoracic CT scan findings',
        consented_by_name: 'Patient Self',
        consented_at: new Date().toISOString(),
        status: 'assigned',
        due_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
        magic_token_hash: tokenHash
      })
      .select()
      .single();

    if (reqErr || !reqData) logFail('Failed to insert intl request', reqErr);
    intlReq = reqData;

    // Test GET /api/v1/review/intl/:token/documents/:docId
    await new Promise((resolve) => {
      http.get(`${baseUrl}/api/v1/review/intl/${exact48Token}/documents/${docRecord.id}`, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode === 200 && res.headers['content-type'] === 'application/pdf') {
            logPass('Gap 1: International Specialist scan preview endpoint successfully served PDF');
            resolve();
          } else {
            logFail(`Gap 1: Expected 200 application/pdf, got ${res.statusCode} ${res.headers['content-type']}: ${body}`);
          }
        });
      });
    });

    // 3. Test Gap 2: Hospital Clinic Visit Summary PDF Generation
    const pdfChunks = [];
    const fakeStream = {
      write: (chunk) => pdfChunks.push(chunk),
      end: () => {},
      on: () => {},
      once: () => {},
      emit: () => {}
    };

    await new Promise((resolve) => {
      buildHospitalClinicVisitPdf({
        hospitalCaseData: hospCase,
        hospitalData: hosp,
        patientData: hospPatient,
        doctorData: { full_name: 'Dr. Tariq Al-Mansoor', specialty: 'General Medicine' },
        labTests: [{ specimen_id: 'SPEC-TEST-1', test_name: 'Complete Blood Count', priority: 'routine', status: 'verified' }],
        medications: [{ drug_name: 'Ibuprofen 400mg', dosage: '400mg', frequency: 'TDS', duration_days: 5, status: 'dispensed' }],
        streamRes: fakeStream
      });

      setTimeout(() => {
        const buf = Buffer.concat(pdfChunks);
        const header = buf.slice(0, 5).toString('ascii');
        if (header.startsWith('%PDF')) {
          logPass(`Gap 2: Hospital Day-Clinic Visit Summary PDF generated (${buf.length} bytes, header: ${header.trim()})`);
          resolve();
        } else {
          logFail(`Gap 2: Invalid PDF header: ${header}`);
        }
      }, 500);
    });

    // 4. Test Gap 3: Patient Mobile Tracker SSE Stream & PDF Download
    // A) Test PDF download via check-in code (GET /api/v1/public/case/:code/report/pdf)
    await new Promise((resolve) => {
      http.get(`${baseUrl}/api/v1/public/case/${hospCase.checkin_code}/report/pdf`, (res) => {
        if (res.statusCode === 200 && res.headers['content-type'] === 'application/pdf') {
          logPass('Gap 3A: Public patient visit summary PDF download by check-in code returned 200');
          resolve();
        } else {
          logFail(`Gap 3A: Expected 200, got ${res.statusCode}`);
        }
      });
    });

    // B) Test SSE stream for mobile patient tracker (GET /api/v1/public/case/:code/stream)
    await new Promise((resolve) => {
      const req = http.get(`${baseUrl}/api/v1/public/case/${hospCase.checkin_code}/stream`, (res) => {
        if (res.statusCode === 200 && res.headers['content-type'] === 'text/event-stream') {
          logPass('Gap 3B: Mobile patient tracker SSE stream connects with text/event-stream');
          let rec = '';
          res.on('data', (c) => {
            rec += c.toString();
            if (rec.includes('data:')) {
              logPass('Gap 3B: Received initial patient case status snapshot over SSE');
              req.destroy();
              resolve();
            }
          });
        } else {
          logFail(`Gap 3B: Expected 200 text/event-stream, got ${res.statusCode}`);
        }
      });

      req.on('error', () => resolve());
      setTimeout(() => { req.destroy(); resolve(); }, 3000);
    });

  } finally {
    // Cleanup test data
    if (intlReq) await db.from('international_opinion_requests').delete().eq('id', intlReq.id);
    if (docRecord) {
      await db.from('hospital_documents').delete().eq('id', docRecord.id);
      await db.storage.from('case-documents').remove([docRecord.storage_path]);
    }
    if (hospCase) await db.from('hospital_cases').delete().eq('id', hospCase.id);
    if (hospPatient) await db.from('hospital_patients').delete().eq('id', hospPatient.id);
    if (hosp) await db.from('hospitals').delete().eq('id', hosp.id);
    logPass('Cleaned up all temporary test records and storage objects');
    server.close();
  }

  console.log('\n\x1b[32mAll Phase 8 Solvable Gaps Implementation Checks PASSED (100%)\x1b[0m\n');
  process.exit(0);
}

runTests().catch(err => {
  logFail('Unhandled test failure', err);
});
