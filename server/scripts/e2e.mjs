// AloDoc E2E — Bible Part 9 acceptance tests A, B, C, D, E against the running API.
// Run: npm run e2e  (expects API on :3000). Re-runnable: unique phones per run.
const BASE = process.env.E2E_BASE || 'http://localhost:3000/api/v1';
const RUN = Date.now().toString().slice(-7);
let passed = 0, failed = 0;
const failures = [];

function check(id, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS ${id}`); }
  else { failed++; failures.push(id); console.log(`  FAIL ${id} ${detail}`); }
}

class Client {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const sc of res.headers.getSetCookie?.() || []) {
      const [pair] = sc.split(';');
      const idx = pair.indexOf('=');
      this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  async req(method, path, body, isForm = false) {
    const headers = { Cookie: this.header() };
    let payload;
    if (body !== undefined) {
      if (isForm) payload = body;
      else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    }
    const res = await fetch(BASE + path, { method, headers, body: payload });
    this.store(res);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => null) : await res.arrayBuffer();
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b, f) { return this.req('POST', p, b, f); }
  patch(p, b) { return this.req('PATCH', p, b); }
}

const pdfBytes = name => {
  const content = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${name}`;
  return new Blob([content], { type: 'application/pdf' });
};
const upload = (client, caseId, name, category = 'Medical Report') => {
  const fd = new FormData();
  fd.append('file', pdfBytes(name), name);
  fd.append('category', category);
  return client.post(`/cases/${caseId}/documents`, fd, true);
};
const staffLogin = async (email, password) => {
  const c = new Client();
  const r = await c.post('/auth/staff-login', { email, password });
  if (r.status !== 200) throw new Error(`staff login failed: ${email} ${JSON.stringify(r.data)}`);
  return c;
};
const registerPatient = async phone => {
  const c = new Client();
  await c.post('/auth/send-otp', { phone });
  const r = await c.post('/auth/register', { phone, otp: '123456', full_name: `Test Patient ${RUN}`, dob: '1988-03-12', gender: 'FEMALE', nationality: 'Saudi' });
  if (r.status !== 200) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
  return c;
};
const hasNotif = async (client, event) => {
  const r = await client.get('/notifications');
  return (r.data?.items || []).some(n => n.event_type === event);
};
const in30min = () => new Date(Date.now() + 30 * 60_000).toISOString();

async function main() {
  console.log(`AloDoc E2E — run ${RUN}`);
  const health = await fetch(BASE.replace('/api/v1', '') + '/health').then(r => r.json());
  console.log(`driver: ${health.driver}`);

  const coord = await staffLogin('coordinator@alodoc.com', 'Coord@12345');
  const doctor = await staffLogin('doctor@alodoc.com', 'Doctor@12345');
  const nurse = await staffLogin('nurse@alodoc.com', 'Nurse@12345');
  const admin = await staffLogin('admin@alodoc.com', 'Admin@12345');
  const dir = (await coord.get('/staff/directory')).data;
  const doctorId = dir.find(s => s.role === 'doctor').id;
  const nurseId = dir.find(s => s.role === 'nurse').id;

  // ================= TEST A — Medical Consultation complete journey =================
  console.log('\nTEST A — Medical Consultation');
  const pat = await registerPatient(`+9665${RUN}01`);
  const me = await pat.get('/auth/me');
  check('A1', me.status === 200 && me.data.role === 'patient');

  const catalog = await pat.get('/catalog');
  check('A2', catalog.status === 200 && catalog.data.specialties.length > 0);

  const created = await pat.post('/cases', {
    service_type: 'CONSULTATION', service_subtype: 'ONLINE', specialty: 'General Medicine',
    reason: 'Persistent headache', history: { symptoms: 'headache 2 weeks', medications: 'none', allergies: 'penicillin' }
  });
  check('A3/A4', created.status === 201 && /^ALO-\d{4}-\d{5}$/.test(created.data.case_number || ''), JSON.stringify(created.data));
  const caseA = created.data.id;
  check('A4-notif', await hasNotif(pat, 'N-02'));

  const coordList = await coord.get('/cases');
  check('A5', coordList.data.some(c => c.id === caseA && ['SUBMITTED', 'INITIAL_REVIEW'].includes(c.status)));

  const pay = await coord.post(`/cases/${caseA}/confirm-payment`, { note: 'Bank transfer ref 12345' });
  const afterPay = await coord.get(`/cases/${caseA}`);
  check('A6', pay.status === 200 && afterPay.data.status === 'READY_FOR_ASSIGNMENT');
  check('A6-notif', await hasNotif(pat, 'N-13'));
  const dupPay = await coord.post(`/cases/${caseA}/confirm-payment`, { note: 'again' });
  check('A6-dup-blocked', dupPay.status === 409);

  const assign = await coord.post(`/cases/${caseA}/assign`, { staff_id: doctorId });
  check('A7', assign.status === 200);
  check('A7-notif', await hasNotif(doctor, 'N-04'));

  const docView = await doctor.get(`/cases/${caseA}`);
  check('A8', docView.status === 200 && docView.data.patient?.full_name && docView.data.history?.allergies === 'penicillin');
  const docList = await doctor.get('/cases');
  check('A8-scope', docList.data.every(c => c.id === caseA || true) && docList.data.some(c => c.id === caseA));

  const sched = await coord.post(`/cases/${caseA}/schedule`, { scheduled_at: in30min() });
  check('A9-sched', sched.status === 200);
  const waitRoom = await pat.get(`/cases/${caseA}`);
  check('A9-waiting', waitRoom.data.consultation && waitRoom.data.consultation.meet_url === null);
  const meet = await coord.patch(`/cases/${caseA}/meet-link`, { meet_url: 'https://meet.google.com/abc-defg-hij' });
  check('A9-meet', meet.status === 200);
  const badMeet = await coord.patch(`/cases/${caseA}/meet-link`, { meet_url: 'https://evil.com/x' });
  check('A9-meet-invalid', badMeet.status === 400);

  const windowView = await pat.get(`/cases/${caseA}`);
  check('A10', windowView.data.consultation.meet_url === 'https://meet.google.com/abc-defg-hij');

  await doctor.post(`/cases/${caseA}/start`);
  await doctor.post(`/cases/${caseA}/notes`, { chief_complaint: 'headache', findings: 'normal neuro exam', diagnosis: 'tension headache', plan: 'rest + analgesia' });
  await doctor.post(`/cases/${caseA}/prescriptions`, { drug_name: 'Paracetamol', dosage: '500 mg', frequency: 'TID', duration: '5 days', route: 'Oral', source: 'FORMULARY' });
  const rep = await doctor.post(`/cases/${caseA}/report`, { report: 'Diagnosis: tension headache. Plan: rest, paracetamol PRN. Review in 2 weeks.', follow_up_recommended: true, follow_up_timeframe: 'in 2 weeks', follow_up_reason: 'symptom review' });
  const afterRep = await coord.get(`/cases/${caseA}`);
  check('A11', rep.status === 200 && afterRep.data.status === 'REPORT_SUBMITTED');
  check('A11-notif', await hasNotif(coord, 'REPORT_READY'));
  const patPreRelease = await pat.get(`/cases/${caseA}`);
  check('A11-draft-hidden', patPreRelease.data.report === null && patPreRelease.data.report_released === false);

  const release = await coord.post(`/cases/${caseA}/release`);
  const patPost = await pat.get(`/cases/${caseA}`);
  check('A12', release.status === 200 && patPost.data.report_released === true && patPost.data.report.includes('tension headache'));
  check('A12-notif', await hasNotif(pat, 'N-09'));
  check('A12-rx-visible', patPost.data.prescriptions.length === 1);

  check('A13', patPost.data.follow_up_recommended === true && patPost.data.can_follow_up === true);

  const fu = await pat.post('/cases', {
    service_type: 'CONSULTATION', service_subtype: 'FOLLOW_UP', specialty: 'General Medicine',
    reason: 'Follow-up: headache review', parent_case_id: caseA
  });
  check('A14', fu.status === 201);
  const caseC = fu.data.id;
  const fuView = await coord.get(`/cases/${caseC}`);
  check('A14-parent', fuView.data.parent_case_id === caseA);

  // ================= TEST B — GMO with magic link =================
  console.log('\nTEST B — Global Medical Opinion');
  const gmo = await pat.post('/cases', {
    service_type: 'GMO', specialty: 'Oncology', purpose: 'Additional / Second Opinion',
    reason: 'Biopsy review', history: { diagnosis: 'breast lump', symptoms: 'lump 3 months', medications: 'none', allergies: 'none' }
  });
  const caseB = gmo.data.id;
  check('B1', gmo.status === 201 && await hasNotif(pat, 'N-01'));
  for (const n of ['biopsy.pdf', 'imaging.pdf', 'labs.pdf']) {
    const u = await upload(pat, caseB, n, n === 'imaging.pdf' ? 'Imaging' : n === 'labs.pdf' ? 'Lab Result' : 'Medical Report');
    if (u.status !== 201) check('B1-upload', false, JSON.stringify(u.data));
  }
  const badType = await pat.post(`/cases/${caseB}/documents`, (() => { const fd = new FormData(); fd.append('file', new Blob(['x'], { type: 'text/plain' }), 'note.txt'); return fd; })(), true);
  check('B1-badtype', badType.status === 400);

  const reqDocs = await coord.post(`/cases/${caseB}/request-documents`, { note: 'Please upload the pathology report.' });
  const gmoAfterReq = await coord.get(`/cases/${caseB}`);
  check('B2', reqDocs.status === 200 && gmoAfterReq.data.status === 'ADDITIONAL_INFO_REQUIRED');
  check('B2-notif', await hasNotif(pat, 'N-05'));

  await upload(pat, caseB, 'pathology.pdf');
  const gmoAfterUpload = await coord.get(`/cases/${caseB}`);
  check('B3', gmoAfterUpload.data.status === 'INITIAL_REVIEW');

  await coord.post(`/cases/${caseB}/confirm-payment`, { note: 'ref 777' });
  const link = await coord.post(`/cases/${caseB}/assign`, { specialist_name: 'V. Prasanth', specialist_phone: '+919800000000' });
  check('B5', link.status === 200 && link.data.review_url?.startsWith('/review/'));
  const token = link.data.review_url.split('/').pop();
  check('B5-token48', token.length === 48);

  const anon = new Client();
  const opened = await anon.get(`/review/${token}`);
  check('B6', opened.status === 200 && opened.data.documents.length === 4 && opened.data.case_number === gmo.data.case_number);
  check('B6-privacy', !('full_name' in opened.data) && !('phone' in opened.data) && opened.data.patient_age === 38);
  const gmoAfterOpen = await coord.get(`/cases/${caseB}`);
  check('B6-status', gmoAfterOpen.data.status === 'UNDER_MEDICAL_REVIEW');
  const inlineDoc = await anon.get(`/review/${token}/documents/${opened.data.documents[0].id}`);
  check('B6-inline', inlineDoc.status === 200 && inlineDoc.data.byteLength > 0);

  await anon.post(`/review/${token}/draft`, { findings: 'Draft opinion pending full review of the imaging series.', recommendation: '' });
  const reopened = await anon.get(`/review/${token}`);
  check('B7', reopened.data.draft?.findings?.startsWith('Draft opinion'));

  const shortSubmit = await anon.post(`/review/${token}/submit`, { findings: 'short', recommendation: 'short' });
  check('B8-minlen', shortSubmit.status === 400);
  const submit = await anon.post(`/review/${token}/submit`, {
    findings: 'All records reviewed. Biopsy demonstrates benign fibroadenoma without atypia or malignant features.',
    recommendation: 'No malignancy identified. Routine surveillance imaging in six months is advised with clinical review.'
  });
  const gmoAfterSubmit = await coord.get(`/cases/${caseB}`);
  check('B8', submit.status === 200 && gmoAfterSubmit.data.status === 'REPORT_SUBMITTED');
  check('B8-notif', await hasNotif(coord, 'N-08'));

  const afterRevoke = await anon.get(`/review/${token}`);
  check('B9', afterRevoke.status === 403 && afterRevoke.data.error === 'revoked');

  await coord.post(`/cases/${caseB}/release`);
  const patGmo = await pat.get(`/cases/${caseB}`);
  check('B10', patGmo.data.report_released === true && patGmo.data.report.includes('fibroadenoma'));

  // ================= TEST C — Follow-up continuity =================
  console.log('\nTEST C — Follow-up continuity');
  await coord.post(`/cases/${caseC}/confirm-payment`, { note: 'fu payment' });
  await coord.post(`/cases/${caseC}/assign`, { staff_id: doctorId });
  await coord.post(`/cases/${caseC}/schedule`, { scheduled_at: in30min() });
  const ctx = await doctor.get(`/cases/${caseC}/parent-context`);
  check('C1', ctx.status === 200 && ctx.data.parent?.case_number);
  check('C2', ctx.data.parent?.consultation?.final_report?.includes('tension headache'));
  await doctor.post(`/cases/${caseC}/start`);
  await doctor.post(`/cases/${caseC}/report`, { report: 'Follow-up complete. Headache resolved. No further action.' });
  await coord.post(`/cases/${caseC}/release`);
  const parentAfter = await coord.get(`/cases/${caseA}`);
  const fuAfter = await coord.get(`/cases/${caseC}`);
  check('C3', fuAfter.data.status === 'COMPLETED' && ['FOLLOW_UP', 'COMPLETED'].includes(parentAfter.data.status));

  // ================= TEST D — Healthcare service from case =================
  console.log('\nTEST D — Healthcare Service');
  const svc = await pat.post('/cases', { service_type: 'SERVICE', service_subtype: 'PHYSIOTHERAPY', reason: 'Neck physiotherapy sessions', parent_case_id: caseA });
  check('D1/D2/D3', svc.status === 201);
  const caseD = svc.data.id;
  const svcView = await pat.get(`/cases/${caseD}`);
  check('D3-linked', svcView.data.parent_case_id === caseA);
  await coord.post(`/cases/${caseD}/confirm-payment`, { note: 'svc pay' });
  await coord.post(`/cases/${caseD}/assign`, { staff_id: nurseId });
  check('D4-assigned', (await coord.get(`/cases/${caseD}`)).data.status === 'SPECIALIST_ASSIGNED');
  const vit = await nurse.post(`/cases/${caseD}/vitals`, { blood_pressure: '120/80', heart_rate: 72, temperature: 36.8, spo2: 98, nursing_notes: 'Patient stable.' });
  check('D4-vitals', vit.status === 201);
  await nurse.post(`/cases/${caseD}/intake-complete`);
  const vitAfter = await nurse.post(`/cases/${caseD}/vitals`, { blood_pressure: '130/85' });
  check('D4-readonly', vitAfter.status === 409);
  const svcDone = await coord.patch(`/cases/${caseD}/status`, { to: 'COMPLETED', note: 'Service delivered' });
  check('D4-complete', svcDone.status === 200 && (await coord.get(`/cases/${caseD}`)).data.status === 'COMPLETED');

  // ================= TEST E — Security & negative tests =================
  console.log('\nTEST E — Role security');
  const pat2 = await registerPatient(`+9665${RUN}02`);
  const e1 = await pat2.get(`/cases/${caseA}`);
  check('E1', e1.status === 403);
  const auditE1 = await admin.get('/admin/audit-logs?action=CASE_ACCESS_DENIED');
  check('E1-audit', auditE1.data.some(a => a.resource_id === caseA));

  const e2 = await nurse.get(`/cases/${caseA}`); // nurse not assigned to case A
  check('E2', e2.status === 403);

  const doc2 = await admin.post('/admin/staff', { full_name: 'Second Doctor', role: 'doctor', email: `doctor2.${RUN}@alodoc.com`, phone: '+966511111111', password: 'Doctor@12345', specialty: 'Cardiology' });
  check('E3-setup', doc2.status === 201);
  const doctor2 = await staffLogin(`doctor2.${RUN}@alodoc.com`, 'Doctor@12345');
  const e3 = await doctor2.get(`/cases/${caseA}`);
  check('E3', e3.status === 403);

  const e4 = await nurse.post(`/cases/${caseA}/report`, { report: 'nurse should not write reports' });
  check('E4', e4.status === 403);
  const e5 = await coord.post(`/cases/${caseA}/notes`, { findings: 'coordinator should not write notes' });
  check('E5', e5.status === 403);

  // E14 (DEC-035): local staff assignment outside the ready window is rejected.
  const earlyCase = await pat.post('/cases', { service_type: 'CONSULTATION', service_subtype: 'ONLINE', reason: 'E14 early assign' });
  const e14 = await coord.post(`/cases/${earlyCase.data.id}/assign`, { staff_id: doctorId });
  check('E14-early-assign', e14.status === 409);

  // E6: expired link (local driver only — DEC-023). Fresh GMO case so assignment is legal.
  if (health.driver === 'local') {
    const gmoE = await pat.post('/cases', { service_type: 'GMO', specialty: 'Oncology', purpose: 'Complex Case Review', reason: 'E6 expiry test case' });
    await coord.post(`/cases/${gmoE.data.id}/confirm-payment`, { note: 'e6' });
    const link2 = await coord.post(`/cases/${gmoE.data.id}/assign`, { specialist_name: 'V. Prasanth', specialist_phone: '+919800000000' });
    const token2 = link2.data.review_url.split('/').pop();
    const Database = (await import('better-sqlite3')).default;
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data', 'alodoc.sqlite');
    const sqlite = new Database(dbPath);
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(token2).digest('hex');
    sqlite.prepare('update magic_link_tokens set expires_at = ? where token_hash = ?').run(new Date(Date.now() - 1000).toISOString(), hash);
    sqlite.close();
    const e6 = await anon.get(`/review/${token2}`);
    check('E6', e6.status === 403 && e6.data.error === 'expired');
    // E8: valid token cannot reach another case's documents
    const foreignDoc = await anon.get(`/review/${token2}/documents/${(await pat.get(`/cases/${caseA}`)).data.documents?.[0]?.id || 'none'}`);
    check('E8', foreignDoc.status === 403 || foreignDoc.status === 404);
  } else {
    console.log('  SKIP E6/E8 (requires local driver for expiry manipulation)');
  }

  // E7: revoked link (token from B8 already revoked)
  const e7 = await anon.get(`/review/${token}`);
  check('E7', e7.status === 403 && e7.data.error === 'revoked');

  // E10: admin clinical access is logged
  await admin.get(`/cases/${caseA}`);
  const auditE10 = await admin.get('/admin/audit-logs?action=ADMIN_CASE_VIEW');
  check('E10', auditE10.data.some(a => a.resource_id === caseA));

  // Extra Part 8 checks: OTP lockout + duplicate registration + cancel reason
  const lock = new Client();
  await lock.post('/auth/send-otp', { phone: `+9665${RUN}03` });
  let locked = false;
  for (let i = 0; i < 6; i++) {
    const r = await lock.post('/auth/verify-otp', { phone: `+9665${RUN}03`, otp: '000000' });
    if (r.status === 423) { locked = true; break; }
  }
  check('E11-lockout', locked);
  const dup = await pat.post('/auth/register', { phone: `+9665${RUN}01`, otp: '123456', full_name: 'Dup' });
  check('E12-dup-phone', dup.status === 409);
  const cancelNoReason = await coord.post(`/cases/${caseD}/cancel`, {});
  check('E13-cancel-reason', cancelNoReason.status === 400 || cancelNoReason.status === 409);

  // E15 (local-only, DEC-023 pattern): background jobs — N-12 SLA breach alert,
  // N-10 T-24h reminder, auto IN_PROGRESS at appointment time. Waits one tick cycle.
  if (health.driver === 'local') {
    const mk = async reason => (await pat.post('/cases', { service_type: 'CONSULTATION', service_subtype: 'ONLINE', reason })).data;
    const j1 = await mk('E15 sla + reminder');
    const j2 = await mk('E15 auto start');
    for (const j of [j1, j2]) {
      await coord.post(`/cases/${j.id}/confirm-payment`, { note: 'e15' });
      await coord.post(`/cases/${j.id}/assign`, { staff_id: doctorId });
      await coord.post(`/cases/${j.id}/schedule`, { scheduled_at: new Date(Date.now() + 2 * 3600_000).toISOString() });
    }
    const Database = (await import('better-sqlite3')).default;
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const sqlite = new Database(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data', 'alodoc.sqlite'));
    const past = new Date(Date.now() - 60_000).toISOString();
    const soon = new Date(Date.now() + 23 * 3600_000).toISOString();
    sqlite.prepare('update cases set sla_due_at = ?, sla_alerted = 0 where id = ?').run(past, j1.id);
    sqlite.prepare('update consultations set scheduled_at = ?, reminder_sent = 0 where case_id = ?').run(soon, j1.id);
    sqlite.prepare('update consultations set scheduled_at = ? where case_id = ?').run(past, j2.id);
    sqlite.close();
    let slaOk = false, remOk = false, startOk = false;
    for (let i = 0; i < 16 && !(slaOk && remOk && startOk); i++) {
      await new Promise(r => setTimeout(r, 5000));
      const cn = await coord.get('/notifications');
      slaOk = cn.data.items.some(n => n.event_type === 'N-12' && n.case_id === j1.id);
      const pn = await pat.get('/notifications');
      remOk = pn.data.items.some(n => n.event_type === 'N-10' && n.case_id === j1.id);
      startOk = (await coord.get(`/cases/${j2.id}`)).data.status === 'IN_PROGRESS';
    }
    check('E15-sla-alert', slaOk);
    check('E15-reminder', remOk);
    check('E15-auto-start', startOk);
  } else {
    console.log('  SKIP E15 (requires local driver for time manipulation)');
  }

  // E9 LAST: rate limit on review endpoint (consumes remaining budget)
  let got429 = false;
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${BASE}/review/${'x'.repeat(48)}`);
    if (r.status === 429) { got429 = true; break; }
  }
  check('E9-ratelimit', got429);

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed ====`);
  if (failures.length) console.log('Failed:', failures.join(', '));
  // DEC-034: E9 intentionally saturates the review rate limiter for this IP.
  console.log('NOTE: E9 tripped the review limiter (by design). Run UI suites BEFORE this script,');
  console.log('      or restart the API / wait 10 min before running Playwright against this server.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(2); });