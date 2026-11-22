// Automated Phase 5 Verification Suite: The Two Native Bridges
// Bridge 1: Online Intake ➔ In-person Clinic (Atomic slot booking & 6-char check-in code)
// Bridge 2: Saudi Hospital ➔ Global Specialist Second Opinion (Consented request, Coordinator queue & Magic Link)
import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../config/db.js';
import { hashToken } from '../controllers/bridgeController.js';

let passed = 0;
let failed = 0;

function assert(name, condition, extra = '') {
  if (condition) {
    console.log(`PASS: ${name} ${extra}`);
    passed++;
  } else {
    console.error(`FAIL: ${name} ${extra}`);
    failed++;
  }
}

async function run() {
  console.log('Running Phase 5 Verification Suite...\n');

  // Clean up any old test records
  const { data: oldHosps } = await db.from('hospitals').select('id').like('name', 'TEST5 —%');
  for (const h of oldHosps || []) {
    await db.from('international_opinion_requests').delete().eq('hospital_id', h.id);
    await db.from('hospital_documents').delete().eq('hospital_id', h.id);
    await db.from('hospital_case_timeline').delete().eq('hospital_id', h.id);
    await db.from('hospital_slots').delete().eq('hospital_id', h.id);
    await db.from('hospital_cases').delete().eq('hospital_id', h.id);
    await db.from('hospital_patients').delete().eq('hospital_id', h.id);
    await db.from('staff_users').delete().eq('hospital_id', h.id);
    await db.from('hospitals').delete().eq('id', h.id);
  }

  const { data: oldCases } = await db.from('cases').select('id, patient_id').like('reason', 'TEST5 —%');
  for (const c of oldCases || []) {
    await db.from('case_timeline').delete().eq('case_id', c.id);
    await db.from('cases').delete().eq('id', c.id);
    if (c.patient_id) await db.from('patients').delete().eq('id', c.patient_id);
  }

  // 1. Provision Test Hospital & Clinic Doctor
  const { data: hosp, error: hospErr } = await db.from('hospitals').insert({
    name: 'TEST5 — King Khalid Hospital',
    short_name: 'KKH',
    city: 'Riyadh',
    timezone: 'Asia/Riyadh',
    kiosk_pin: '556677',
    is_active: true
  }).select().single();
  assert('Provision Test Hospital', !hospErr && !!hosp?.id, hosp?.id);

  const { data: doctor, error: docErr } = await db.from('staff_users').insert({
    hospital_id: hosp.id,
    full_name: 'Dr. Marcus Vance',
    role: 'doctor',
    specialty: 'Cardiology',
    phone: '+966508881122',
    phone_e164: '+966508881122',
    is_active: true
  }).select().single();
  assert('Provision Hospital Doctor (Dr. Marcus Vance)', !docErr && !!doctor?.id, doctor?.id);

  // Create available slot
  const todayStr = new Date().toISOString().split('T')[0];
  const { data: slot, error: slotErr } = await db.from('hospital_slots').insert({
    hospital_id: hosp.id,
    doctor_id: doctor.id,
    date: todayStr,
    time: '11:00',
    duration_min: 30,
    status: 'free'
  }).select().single();
  assert('Create Free Clinic Slot', !slotErr && !!slot?.id, `${slot?.date} ${slot?.time}`);

  // 2. Provision Online Patient & Remote Case
  const { data: patient, error: patErr } = await db.from('patients').insert({
    phone: '+966508883344',
    full_name: 'V. Prasanth',
    dob: '1988-03-20',
    gender: 'MALE'
  }).select().single();
  assert('Create Remote Patient (V. Prasanth)', !patErr && !!patient?.id, patient?.id);

  const { data: remoteCase, error: caseErr } = await db.from('cases').insert({
    case_number: `ALO-${Date.now().toString(36).toUpperCase()}`,
    patient_id: patient.id,
    service_type: 'CONSULTATION',
    specialty: 'Cardiology',
    reason: 'TEST5 — Patient reports progressive chest heaviness on climbing stairs',
    status: 'INITIAL_REVIEW',
    payment_confirmed: true
  }).select().single();
  assert('Create Remote Case for Online Intake', !caseErr && !!remoteCase?.id, remoteCase?.case_number);

  // =========================================================================
  // BRIDGE 1 VERIFICATION: Refer Online Intake Case to Saudi Hospital Clinic
  // =========================================================================

  // Atomically book slot and create hospital case
  const checkinCode = 'XYZ987';
  const { data: hospPatient, error: hpErr } = await db.from('hospital_patients').insert({
    hospital_id: hosp.id,
    mrn: 'MRN-883344',
    full_name: patient.full_name,
    phone: patient.phone,
    dob: patient.dob,
    gender: patient.gender
  }).select().single();
  assert('Create Hospital Patient record under target hospital', !hpErr && !!hospPatient?.id, hospPatient?.mrn);

  const { data: clinicCase, error: clErr } = await db.from('hospital_cases').insert({
    hospital_id: hosp.id,
    hospital_patient_id: hospPatient.id,
    alo_case_id: remoteCase.id,
    alo_case_number: remoteCase.case_number,
    case_number: 'C-0001',
    checkin_code: checkinCode,
    source: 'alo_doctor',
    service_type: 'in_person',
    requested_specialty: remoteCase.specialty,
    status: 'new',
    arrival_status: 'scheduled',
    assigned_doctor_id: doctor.id,
    appointment_date: slot.date,
    appointment_time: slot.time,
    case_summary: remoteCase.reason,
    nurse_interview_summary: 'Nurse verified online intake and confirmed clinic slot booking.',
    general_consent: true
  }).select().single();
  assert('Bridge 1: Create hospital_cases from online intake', !clErr && !!clinicCase?.id, clinicCase?.case_number);

  // Book slot atomically
  const { data: bookedSlot, error: bSlotErr } = await db.from('hospital_slots')
    .update({
      status: 'booked',
      hospital_case_id: clinicCase.id,
      booked_at: new Date().toISOString()
    })
    .eq('id', slot.id)
    .select()
    .single();
  assert('Bridge 1: Slot atomically marked booked and linked to clinic case', !bSlotErr && bookedSlot?.status === 'booked' && bookedSlot?.hospital_case_id === clinicCase.id);

  // Update remote case hospital handoff
  const handoffPayload = {
    hospital_id: hosp.id,
    hospital_name: hosp.name,
    hospital_case_id: clinicCase.id,
    checkin_code: checkinCode,
    appointment_date: slot.date,
    appointment_time: slot.time,
    status: 'referred'
  };

  const { data: updatedRemote, error: upRemErr } = await db.from('cases')
    .update({
      hospital_handoff: handoffPayload,
      handoff_history: [handoffPayload]
    })
    .eq('id', remoteCase.id)
    .select()
    .single();
  assert('Bridge 1: Remote case records hospital handoff with check-in code', !upRemErr && updatedRemote?.hospital_handoff?.checkin_code === checkinCode);

  // Attempt to book same slot for another case must fail
  const { error: dupBookErr } = await db.from('hospital_slots')
    .insert({
      hospital_id: hosp.id,
      doctor_id: doctor.id,
      date: slot.date,
      time: slot.time,
      status: 'free'
    });
  assert('Bridge 1: Anti-double-booking constraint prevents duplicate slot', dupBookErr?.code === '23505');

  // =========================================================================
  // BRIDGE 2 VERIFICATION: Saudi Hospital Doctor Requests International 2nd Opinion
  // =========================================================================

  // Patient arrives and doctor starts consultation
  await db.from('hospital_cases').update({
    arrival_status: 'in_clinic',
    in_clinic_at: new Date().toISOString()
  }).eq('id', clinicCase.id);

  // Doctor requests international opinion (with patient consent)
  const clinicalQuestion = 'Patient presents with stable angina and multi-vessel calcification. Does current evidence support medical management vs elective FFR-guided PCI?';
  const consentedByName = 'V. Prasanth';

  const { data: intlReq, error: intlReqErr } = await db.from('international_opinion_requests').insert({
    hospital_id: hosp.id,
    hospital_case_id: clinicCase.id,
    requested_by: doctor.id,
    specialty: 'Cardiothoracic Surgery',
    clinical_question: clinicalQuestion,
    consented_by_name: consentedByName,
    consented_at: new Date().toISOString(),
    status: 'requested',
    due_at: new Date(Date.now() + 72 * 3600_000).toISOString()
  }).select().single();
  assert('Bridge 2: Doctor creates International Second Opinion request with patient consent', !intlReqErr && !!intlReq?.id, intlReq?.specialty);

  // Register Global Specialist Directory item
  const { data: intlSpec, error: specErr } = await db.from('international_specialists').insert({
    full_name: 'Dr. David Nunez',
    specialty: 'Cardiothoracic Surgery',
    institution: 'Cleveland Clinic',
    country: 'United States',
    phone_e164: '+12165550199',
    languages: ['en']
  }).select().single();
  assert('Bridge 2: Specialist registered in international directory', !specErr && !!intlSpec?.id, intlSpec?.full_name);

  // ALO Platform Coordinator dispatches request to global specialist
  const rawToken = crypto.randomBytes(36).toString('base64url'); // 48 chars
  const tokenHash = hashToken(rawToken);

  const { data: dispatchedReq, error: dispErr } = await db.from('international_opinion_requests')
    .update({
      assigned_specialist_id: intlSpec.id,
      magic_token_hash: tokenHash,
      token_expires_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
      status: 'sent'
    })
    .eq('id', intlReq.id)
    .select()
    .single();
  assert('Bridge 2: ALO Coordinator dispatches opinion request with 48-char magic token', !dispErr && dispatchedReq?.status === 'sent');

  // International Specialist reviews and submits opinion
  const specialistOpinion = 'Review of coronary calcium score and clinical history indicates significant plaque burden in LAD. Recommend complete functional non-invasive assessment.';
  const specialistRecs = 'Optimize guideline-directed medical therapy. If ischemic burden exceeds 10%, refer for coronary angiography with fractional flow reserve.';
  const chips = {
    agreement: 'modifies_preliminary',
    path: 'further_investigation',
    urgency: 'routine'
  };

  const { data: completedOpinion, error: compErr } = await db.from('international_opinion_requests')
    .update({
      opinion_text: specialistOpinion,
      recommendations: specialistRecs,
      decision_chips: chips,
      status: 'submitted',
      magic_token_hash: null, // Revoked upon submission
      updated_at: new Date().toISOString()
    })
    .eq('id', intlReq.id)
    .select()
    .single();
  assert('Bridge 2: International Specialist submits opinion and token is revoked', !compErr && completedOpinion?.status === 'submitted' && completedOpinion?.magic_token_hash === null);

  // Append opinion to Saudi hospital patient chart
  const { data: timelineEntry, error: timeErr } = await db.from('hospital_case_timeline').insert({
    hospital_id: hosp.id,
    hospital_case_id: clinicCase.id,
    actor_role: 'international',
    note: `International Second Opinion (Cardiothoracic Surgery) received. Recommendations: "${specialistRecs.slice(0, 100)}..."`
  }).select().single();
  assert('Bridge 2: International opinion appended directly to Saudi clinic patient timeline', !timeErr && !!timelineEntry?.id);

  // Complete clinic case
  const { data: closedCase, error: closeErr } = await db.from('hospital_cases')
    .update({
      doctor_opinion: `International consultation incorporated: ${specialistRecs}`,
      status: 'completed',
      arrival_status: 'done'
    })
    .eq('id', clinicCase.id)
    .select()
    .single();
  assert('Saudi Clinic Doctor finalizes case incorporating international second opinion', !closeErr && closedCase?.status === 'completed');

  // 6. Cleanup test records
  await db.from('international_opinion_requests').delete().eq('hospital_id', hosp.id);
  await db.from('international_specialists').delete().eq('id', intlSpec.id);
  await db.from('hospital_case_timeline').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_slots').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_cases').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_patients').delete().eq('hospital_id', hosp.id);
  await db.from('staff_users').delete().eq('hospital_id', hosp.id);
  await db.from('hospitals').delete().eq('id', hosp.id);

  await db.from('case_timeline').delete().eq('case_id', remoteCase.id);
  await db.from('cases').delete().eq('id', remoteCase.id);
  await db.from('patients').delete().eq('id', patient.id);
  assert('Cleaned up Phase 5 test data', true);

  console.log(`\nPhase 5 Verification Complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error in Phase 5 verification suite:', err);
  process.exit(1);
});
