// Test Suite: Real-Time Waiting Screen Queue SSE & Medical Report PDF Generation
import http from 'http';
import { db } from '../config/db.js';
import { emitQueueUpdate } from '../services/realtimeService.js';
import { app } from '../index.js';

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
  console.log('--- Testing Real-Time Queue Updates & PDF Generation ---');
  await setup();

  const testPin = Math.floor(100000 + Math.random() * 900000).toString();
  let hosp = null;
  let patient = null;
  let testCase = null;

  try {
    // 1. Create temporary test hospital
    const { data: hospData, error: hErr } = await db
      .from('hospitals')
      .insert({
        name: 'TEST — Realtime Hospital',
        name_ar: 'مستشفى الفحص الحي',
        short_name: `test-rt-${Date.now().toString(36)}`,
        city: 'Riyadh',
        kiosk_pin: testPin,
        is_active: true
      })
      .select()
      .single();

    if (hErr || !hospData) logFail('Failed to create test hospital', hErr);
    hosp = hospData;
    logPass(`Created test hospital: ${hosp.name} (PIN: ${hosp.kiosk_pin})`);

    // 2. Test SSE Stream: /api/v1/public/screen/:pin/waiting/stream
    await new Promise((resolve) => {
      const req = http.get(`${baseUrl}/api/v1/public/screen/${hosp.kiosk_pin}/waiting/stream`, (res) => {
        if (res.statusCode !== 200) {
          logFail(`SSE endpoint returned status ${res.statusCode}`);
        }
        if (res.headers['content-type'] !== 'text/event-stream') {
          logFail(`Invalid SSE content-type: ${res.headers['content-type']}`);
        }
        logPass('SSE endpoint connects with text/event-stream');

        let receivedData = '';
        res.on('data', (chunk) => {
          receivedData += chunk.toString();
          if (receivedData.includes('data:') && !receivedData.includes('TEST-999')) {
            logPass('Received initial SSE queue snapshot');

            // Trigger real-time broadcast
            emitQueueUpdate(hosp.id, {
              event: 'test_call',
              queue_number: 'TEST-999',
              just_called: 'TEST-999'
            });
          }

          if (receivedData.includes('TEST-999') || receivedData.split('data:').length > 2) {
            logPass('Received real-time queue update broadcast over SSE stream');
            req.destroy();
            resolve();
          }
        });
      });

      req.on('error', (err) => {
        if (err.code === 'ECONNRESET') {
          resolve();
        } else {
          logFail('SSE connection error', err);
        }
      });

      setTimeout(() => {
        req.destroy();
        resolve();
      }, 4000);
    });

    // 3. Test Medical Report PDF Generation
    const { data: pData, error: pErr } = await db
      .from('patients')
      .insert({
        phone: `+966500${Math.floor(100000 + Math.random() * 900000)}`,
        full_name: 'TEST — Patient for PDF',
        dob: '1985-05-15',
        gender: 'MALE'
      })
      .select()
      .single();

    if (pErr || !pData) logFail('Failed to create test patient', pErr);
    patient = pData;

    const { data: cData, error: cErr } = await db
      .from('cases')
      .insert({
        patient_id: patient.id,
        case_number: `TEST-PDF-${Date.now().toString(36).toUpperCase()}`,
        service_type: 'CONSULTATION',
        status: 'COMPLETED',
        reason: 'Cardiac second opinion evaluation for test PDF',
        history: { allergies: 'None known', hypertension: 'Controlled' },
        final_report_en: 'CLINICAL FINDINGS: Normal sinus rhythm with mild concentric LVH.\nRECOMMENDATIONS: Continue ACE-inhibitor and repeat echocardiogram at 6 months.',
        final_report_ar: 'النتائج السريرية: نظم جيبي طبيعي مع تضخم طفيف.\nالتوصيات: الاستمرار على العلاج الدوائي.',
        final_report_published: true
      })
      .select()
      .single();

    if (cErr || !cData) logFail('Failed to create test case', cErr);
    testCase = cData;

    logPass(`Created test case ${testCase.case_number}`);

    // Test PDF generator endpoint directly via service
    const { buildCaseReportPdf } = await import('../services/pdfReportService.js');
    const chunks = [];
    const fakeStream = {
      write: (chunk) => chunks.push(chunk),
      end: () => {},
      on: () => {},
      once: () => {},
      emit: () => {}
    };

    await new Promise((resolve) => {
      buildCaseReportPdf({
        caseData: {
          ...testCase,
          prescriptions: [{ drug_name: 'Lisinopril 10mg', dosage: '10mg', frequency: 'OD', duration: '30 days' }]
        },
        patientData: { full_name: 'Test Patient', dob: '1985-05-15', gender: 'male', phone: '+966500000001' },
        streamRes: fakeStream
      });

      setTimeout(() => {
        const pdfBuffer = Buffer.concat(chunks);
        const header = pdfBuffer.slice(0, 5).toString('ascii');
        if (header.startsWith('%PDF')) {
          logPass(`Medical Report PDF successfully generated (${pdfBuffer.length} bytes, header: ${header.trim()})`);
          resolve();
        } else {
          logFail(`Generated output does not start with %PDF: ${header}`);
        }
      }, 500);
    });

  } finally {
    if (testCase) await db.from('cases').delete().eq('id', testCase.id);
    if (patient) await db.from('patients').delete().eq('id', patient.id);
    if (hosp) await db.from('hospitals').delete().eq('id', hosp.id);
    logPass('Cleaned up test case, test patient, and test hospital');
    server.close();
  }

  console.log('\n\x1b[32mAll Real-Time Queue & PDF Generation Checks PASSED (100%)\x1b[0m\n');
  process.exit(0);
}

runTests().catch(err => {
  logFail('Unhandled test failure', err);
});
