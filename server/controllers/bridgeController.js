// DEC-056: The Two Native Bridges Controller
// Bridge 1 (Online Intake ➔ In-person Saudi Clinic)
// Bridge 2 (Saudi Hospital ➔ Global Specialist Second Opinion)
import crypto from 'crypto';
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { transition } from '../services/caseService.js';
import { notify, notifyCoordinators } from '../services/notificationService.js';

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const CHECKIN_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateCheckinCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHECKIN_CHARS[Math.floor(Math.random() * CHECKIN_CHARS.length)];
  }
  return code;
}

function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

// =========================================================================
// BRIDGE 1: Online Intake ➔ In-Person Saudi Clinic (Atomic Internal Referral)
// =========================================================================

export const referToHospital = ah(async (req, res) => {
  const c = req.case;
  const {
    hospital_id,
    slot_id,
    doctor_id,
    appointment_date,
    appointment_time,
    chief_complaint,
    nurse_interview_summary
  } = req.body;

  if (!hospital_id) throw httpError(400, 'hospital_id is required');

  // Verify hospital is active
  const { data: hosp, error: hospErr } = await db
    .from('hospitals')
    .select('id, name, short_name, city')
    .eq('id', hospital_id)
    .eq('is_active', true)
    .maybeSingle();

  if (hospErr || !hosp) throw httpError(404, 'Selected hospital not found or inactive');

  // Fetch patient profile
  const { data: patient, error: patErr } = await db
    .from('patients')
    .select('id, full_name, phone, dob, gender')
    .eq('id', c.patient_id)
    .single();

  if (patErr || !patient) throw httpError(404, 'Case patient profile not found');

  // 1. Slot Allocation
  let targetSlot = null;
  let targetDoctorId = doctor_id || null;
  let apptDate = appointment_date || null;
  let apptTime = appointment_time || null;

  if (slot_id) {
    const { data: slot, error: slotErr } = await db
      .from('hospital_slots')
      .select('*')
      .eq('id', slot_id)
      .eq('hospital_id', hospital_id)
      .eq('status', 'free')
      .maybeSingle();

    if (slotErr || !slot) throw httpError(409, 'The selected clinic slot is no longer available');
    targetSlot = slot;
    targetDoctorId = slot.doctor_id;
    apptDate = slot.date;
    apptTime = slot.time;
  } else if (apptDate && apptTime && targetDoctorId) {
    // Check if slot exists or create/book it
    const { data: existingSlot } = await db
      .from('hospital_slots')
      .select('*')
      .eq('hospital_id', hospital_id)
      .eq('doctor_id', targetDoctorId)
      .eq('date', apptDate)
      .eq('time', apptTime)
      .maybeSingle();

    if (existingSlot) {
      if (existingSlot.status !== 'free') throw httpError(409, 'The doctor is already booked for this slot');
      targetSlot = existingSlot;
    }
  }

  // 2. Resolve or Create hospital_patients record (MRN uniqueness scoped to hospital)
  let hospitalPatientId = null;
  const { data: existingHospPatient } = await db
    .from('hospital_patients')
    .select('id, mrn')
    .eq('hospital_id', hospital_id)
    .eq('phone', patient.phone)
    .maybeSingle();

  if (existingHospPatient) {
    hospitalPatientId = existingHospPatient.id;
  } else {
    const cleanDigits = (patient.phone || '').replace(/\D/g, '').slice(-6) || '000000';
    const mrn = `MRN-${cleanDigits}-${Date.now().toString(36).slice(-3).toUpperCase()}`;

    const { data: newHospPatient, error: newPatErr } = await db
      .from('hospital_patients')
      .insert({
        hospital_id,
        mrn,
        full_name: patient.full_name,
        phone: patient.phone,
        dob: patient.dob,
        gender: patient.gender,
        medical_history: c.history || null
      })
      .select()
      .single();

    if (newPatErr) throw httpError(500, `Failed to register hospital patient: ${newPatErr.message}`);
    hospitalPatientId = newHospPatient.id;
  }

  // 3. Generate Case Number & 6-character checkin_code
  const { data: lastCase } = await db
    .from('hospital_cases')
    .select('case_number')
    .eq('hospital_id', hospital_id)
    .order('created_at', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (lastCase && lastCase[0]?.case_number) {
    const parsed = parseInt(lastCase[0].case_number.replace(/\D/g, ''), 10);
    if (!isNaN(parsed)) nextNum = parsed + 1;
  }
  const caseNumber = `C-${String(nextNum).padStart(4, '0')}`;
  const checkinCode = generateCheckinCode();

  // 4. Create hospital_cases record
  const summaryText = chief_complaint || c.reason || 'Referred from online triage consultation';
  const nurseSummary = nurse_interview_summary || 'Nurse verified online intake and confirmed clinic slot booking.';

  const { data: hospCase, error: caseCreateErr } = await db
    .from('hospital_cases')
    .insert({
      hospital_id,
      hospital_patient_id: hospitalPatientId,
      alo_case_id: c.id,
      alo_case_number: c.case_number,
      case_number: caseNumber,
      checkin_code: checkinCode,
      source: 'alo_doctor',
      service_type: 'in_person',
      requested_specialty: c.specialty || null,
      status: 'new',
      arrival_status: 'scheduled',
      assigned_doctor_id: targetDoctorId,
      appointment_date: apptDate,
      appointment_time: apptTime,
      case_summary: summaryText,
      nurse_interview_summary: nurseSummary,
      general_consent: true
    })
    .select()
    .single();

  if (caseCreateErr) throw httpError(500, `Failed to create clinic case: ${caseCreateErr.message}`);

  // 5. Update slot to 'booked' and link to hospital_cases
  if (targetSlot) {
    await db
      .from('hospital_slots')
      .update({
        status: 'booked',
        hospital_case_id: hospCase.id,
        booked_at: new Date().toISOString()
      })
      .eq('id', targetSlot.id);
  }

  // 6. Record timeline event in hospital_case_timeline
  await db.from('hospital_case_timeline').insert({
    hospital_id,
    hospital_case_id: hospCase.id,
    from_status: null,
    to_status: 'new',
    arrival_status: 'scheduled',
    actor_id: req.session.sub,
    actor_role: req.session.role,
    note: `Referred from online case ${c.case_number}. Appointment confirmed for ${apptDate || 'TBD'} ${apptTime || ''}. Check-in code: ${checkinCode}`
  });

  // 7. Update remote case hospital_handoff
  const handoffRecord = {
    hospital_id,
    hospital_name: hosp.name,
    hospital_case_id: hospCase.id,
    hospital_case_number: hospCase.case_number,
    checkin_code: checkinCode,
    slot_id: targetSlot?.id || null,
    doctor_id: targetDoctorId,
    appointment_date: apptDate,
    appointment_time: apptTime,
    status: 'referred',
    referred_at: new Date().toISOString()
  };

  const currentHistory = Array.isArray(c.handoff_history) ? c.handoff_history : [];
  await db
    .from('cases')
    .update({
      hospital_handoff: handoffRecord,
      handoff_history: [...currentHistory, handoffRecord],
      updated_at: new Date().toISOString()
    })
    .eq('id', c.id);

  // 8. Patient WhatsApp Notification
  const appOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const patientStatusUrl = `${appOrigin}/p/${checkinCode}`;

  await notify({
    event: 'N-15',
    caseId: c.id,
    recipientType: 'patient',
    recipientId: patient.id,
    recipientPhone: patient.phone,
    channels: ['whatsapp'],
    title: 'Clinic Appointment Confirmed',
    body: `Dear ${patient.full_name}, your clinic appointment at ${hosp.name} is booked for ${apptDate} at ${apptTime}. Your Check-in Code is: *${checkinCode}*. Track arrival queue: ${patientStatusUrl}`
  });

  await audit(req, 'CASE_REFERRED_TO_HOSPITAL', {
    resourceType: 'case',
    resourceId: c.id,
    detail: { hospital_id, hospital_case_id: hospCase.id, checkin_code: checkinCode }
  });

  res.status(201).json({
    ok: true,
    hospital_case: hospCase,
    checkin_code: checkinCode,
    appointment_date: apptDate,
    appointment_time: apptTime,
    hospital: hosp,
    patient_status_url: patientStatusUrl
  });
});

// =========================================================================
// BRIDGE 2: Saudi Hospital Doctor Requests International Second Opinion
// =========================================================================

export const requestIntlOpinion = ah(async (req, res) => {
  const c = req.hospitalCase;
  const { specialty, clinical_question, consented_by_name, patient_consent, urgency } = req.body;

  if (!specialty?.trim() || !clinical_question?.trim()) {
    throw httpError(400, 'specialty and clinical_question are required');
  }

  if (!patient_consent || !consented_by_name?.trim()) {
    throw httpError(400, 'Explicit patient consent and the consenting person full name are required (Bridge 2 policy)');
  }

  const isUrgent = urgency === 'urgent';
  const dueHours = isUrgent ? 24 : 72;
  const dueAt = new Date(Date.now() + dueHours * 3600_000).toISOString();

  const { data: requestRecord, error: reqErr } = await db
    .from('international_opinion_requests')
    .insert({
      hospital_id: req.tenant.id,
      hospital_case_id: c.id,
      requested_by: req.staff.id,
      specialty: String(specialty).trim(),
      clinical_question: String(clinical_question).trim(),
      consented_by_name: String(consented_by_name).trim(),
      consented_at: new Date().toISOString(),
      due_at: dueAt,
      status: 'requested'
    })
    .select()
    .single();

  if (reqErr) throw httpError(500, reqErr.message);

  // Record timeline event in Saudi clinic case
  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: c.id,
    from_status: c.status,
    to_status: c.status,
    actor_id: req.staff.id,
    actor_role: 'doctor',
    note: `Doctor requested an International Second Opinion in ${specialty}. Patient consent recorded: ${consented_by_name}. SLA target: ${dueHours} hours.`
  });

  // Notify ALO platform coordinators
  await notifyCoordinators({
    event: 'INTL_OPINION_REQUESTED',
    caseId: c.id,
    title: `International Second Opinion Requested (${specialty})`,
    body: `Dr. ${req.staff.full_name} from ${req.tenant.name} requested an international specialist opinion for Case ${c.case_number}. SLA: ${dueHours}h.`
  });

  await audit(req, 'INTL_OPINION_REQUESTED', {
    resourceType: 'hospital_case',
    resourceId: c.id,
    detail: { request_id: requestRecord.id, specialty, due_at: dueAt }
  });

  res.status(201).json({
    ok: true,
    request: requestRecord,
    due_at: dueAt
  });
});

// Coordinator queue: List international opinion requests
export const listIntlOpinionsForStaff = ah(async (req, res) => {
  const { status } = req.query;

  let query = db
    .from('international_opinion_requests')
    .select(`
      id, hospital_id, hospital_case_id, specialty, clinical_question,
      consented_by_name, consented_at, status, due_at, created_at,
      opinion_text, recommendations, decision_chips,
      hospitals(id, name, city),
      staff_users!international_opinion_requests_requested_by_fkey(id, full_name, specialty),
      international_specialists(id, full_name, specialty, institution, country)
    `)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data: opinions, error } = await query.limit(100);
  if (error) throw httpError(500, error.message);

  res.json({ ok: true, opinions: opinions || [] });
});

// Coordinator action: Dispatch international opinion request to global specialist
export const dispatchIntlOpinion = ah(async (req, res) => {
  const { id } = req.params;
  const { specialist_name, specialist_phone, specialist_id } = req.body;

  if (!specialist_name?.trim()) throw httpError(400, 'Specialist name is required');
  if (!specialist_phone || !/^\+[1-9]\d{7,14}$/.test(specialist_phone)) {
    throw httpError(400, 'Specialist phone in international E.164 format is required');
  }

  const { data: opReq, error: opErr } = await db
    .from('international_opinion_requests')
    .select('*, hospitals(name)')
    .eq('id', id)
    .single();

  if (opErr || !opReq) throw httpError(404, 'International opinion request not found');

  const rawToken = crypto.randomBytes(36).toString('base64url'); // 48 chars
  const tokenHash = hashToken(rawToken);
  const expiresAt = opReq.due_at || new Date(Date.now() + 72 * 3600_000).toISOString();

  const { data: updated, error: updErr } = await db
    .from('international_opinion_requests')
    .update({
      assigned_specialist_id: specialist_id || null,
      alo_handler_id: req.session.sub,
      magic_token_hash: tokenHash,
      token_expires_at: expiresAt,
      status: 'sent',
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (updErr) throw httpError(500, updErr.message);

  const appOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const reviewUrl = `${appOrigin}/review/intl/${rawToken}`;

  // Notify specialist via WhatsApp
  await notify({
    event: 'N-06',
    caseId: opReq.hospital_case_id,
    recipientType: 'specialist',
    recipientPhone: specialist_phone,
    channels: ['whatsapp'],
    title: 'Hospital Case Specialist Opinion Request',
    body: `Dear Dr. ${specialist_name}, you have received a specialist consultation request in ${opReq.specialty} for an in-clinic hospital patient. Secure review link: ${reviewUrl} — expires in 72 hours.`
  });

  await audit(req, 'INTL_OPINION_DISPATCHED', {
    resourceType: 'intl_opinion_request',
    resourceId: id,
    detail: { specialist_name, specialist_phone, review_url: reviewUrl }
  });

  res.json({
    ok: true,
    request: updated,
    review_url: reviewUrl,
    token: rawToken,
    expires_at: expiresAt
  });
});

// =========================================================================
// BRIDGE 2: International Specialist Review Portal (/review/intl/:token)
// =========================================================================

export const openIntlReview = ah(async (req, res) => {
  const { token } = req.params;
  if (!token || token.length !== 48) throw httpError(403, 'invalid');

  const tokenH = hashToken(token);
  const { data: opReq, error } = await db
    .from('international_opinion_requests')
    .select(`
      id, hospital_id, hospital_case_id, specialty, clinical_question,
      status, due_at, token_expires_at, opinion_text, recommendations, decision_chips,
      hospitals(name, city),
      hospital_cases(case_number, hospital_patient_id)
    `)
    .eq('magic_token_hash', tokenH)
    .maybeSingle();

  if (error || !opReq) throw httpError(403, 'invalid');

  if (opReq.status === 'cancelled') throw httpError(403, 'revoked');
  if (opReq.token_expires_at && new Date(opReq.token_expires_at).getTime() < Date.now()) {
    throw httpError(403, 'expired');
  }

  // Fetch privacy-minimized patient demographics (Age & Gender only — zero names or phones)
  const patientId = opReq.hospital_cases?.hospital_patient_id;
  const { data: pat } = patientId
    ? await db.from('hospital_patients').select('dob, gender').eq('id', patientId).maybeSingle()
    : { data: null };

  // Fetch hospital documents permitted for external specialist review
  const { data: docs } = await db
    .from('hospital_documents')
    .select('id, file_name, file_type, category, created_at')
    .eq('hospital_case_id', opReq.hospital_case_id)
    .eq('is_deleted', false)
    .in('category', ['lab_report', 'radiology', 'clinical_note', 'other']);

  res.json({
    ok: true,
    request_id: opReq.id,
    case_number: opReq.hospital_cases?.case_number,
    hospital_name: opReq.hospitals?.name,
    hospital_city: opReq.hospitals?.city,
    specialty: opReq.specialty,
    clinical_question: opReq.clinical_question,
    patient_age: ageFrom(pat?.dob),
    patient_gender: pat?.gender || null,
    documents: docs || [],
    opinion_text: opReq.opinion_text || '',
    recommendations: opReq.recommendations || '',
    decision_chips: opReq.decision_chips || {},
    status: opReq.status,
    submitted: opReq.status === 'submitted',
    expires_at: opReq.token_expires_at
  });
});

export const submitIntlReview = ah(async (req, res) => {
  const { token } = req.params;
  const { opinion_text, recommendations, decision_chips } = req.body;

  if (!token || token.length !== 48) throw httpError(403, 'invalid');

  const opinionText = (opinion_text || '').trim();
  const recsText = (recommendations || '').trim();

  if (opinionText.length < 30 || recsText.length < 30) {
    throw httpError(400, 'Clinical opinion and recommendations are required (minimum 30 characters each).');
  }

  const tokenH = hashToken(token);
  const { data: opReq, error } = await db
    .from('international_opinion_requests')
    .select('*, hospital_cases(case_number, hospital_id)')
    .eq('magic_token_hash', tokenH)
    .maybeSingle();

  if (error || !opReq) throw httpError(403, 'invalid');
  if (opReq.status === 'submitted') throw httpError(409, 'Opinion has already been submitted');

  const now = new Date().toISOString();

  // 1. Update international opinion request
  const { data: completed, error: compErr } = await db
    .from('international_opinion_requests')
    .update({
      opinion_text: opinionText,
      recommendations: recsText,
      decision_chips: decision_chips || {},
      status: 'submitted',
      magic_token_hash: null, // Revoke token immediately upon submission
      updated_at: now
    })
    .eq('id', opReq.id)
    .select()
    .single();

  if (compErr) throw httpError(500, compErr.message);

  // 2. Append directly to Saudi clinic patient timeline & chart
  await db.from('hospital_case_timeline').insert({
    hospital_id: opReq.hospital_id,
    hospital_case_id: opReq.hospital_case_id,
    from_status: null,
    to_status: null,
    actor_id: null,
    actor_role: 'international',
    note: `International Second Opinion (${opReq.specialty}) received. Recommendations: "${recsText.slice(0, 150)}..."`
  });

  // 3. Notify Saudi clinic doctor & ALO platform coordinators
  await notify({
    event: 'INTL_OPINION_RECEIVED',
    caseId: opReq.hospital_case_id,
    recipientType: 'staff',
    recipientId: opReq.requested_by,
    title: 'International Second Opinion Arrived',
    body: `The requested international second opinion in ${opReq.specialty} for Case ${opReq.hospital_cases?.case_number} has arrived and is attached to the patient chart.`
  });

  await notifyCoordinators({
    event: 'INTL_OPINION_SUBMITTED',
    caseId: opReq.hospital_case_id,
    title: 'International Opinion Completed',
    body: `Global specialist submitted opinion for hospital case ${opReq.hospital_cases?.case_number} (${opReq.specialty}).`
  });

  await audit(req, 'INTL_OPINION_SUBMITTED', {
    resourceType: 'intl_opinion_request',
    resourceId: opReq.id,
    detail: { hospital_case_id: opReq.hospital_case_id }
  });

  res.json({ ok: true, request: completed });
});

// =========================================================================
// Specialist Directory Management (international_specialists)
// =========================================================================

export const listSpecialistDirectory = ah(async (req, res) => {
  const { specialty, country } = req.query;

  let query = db
    .from('international_specialists')
    .select('*')
    .eq('is_active', true)
    .order('full_name');

  if (specialty) query = query.ilike('specialty', `%${specialty}%`);
  if (country) query = query.eq('country', country);

  const { data: specialists, error } = await query;
  if (error) throw httpError(500, error.message);

  res.json({ ok: true, specialists: specialists || [] });
});

export const createSpecialistDirectoryItem = ah(async (req, res) => {
  const { full_name, specialty, sub_specialty, institution, country, phone_e164, phone, email, languages, notes } = req.body;
  const rawPhone = phone_e164 || phone;

  if (!full_name?.trim() || !rawPhone?.trim()) {
    throw httpError(400, 'Consultant name and mobile number are required');
  }

  let normalizedPhone = String(rawPhone).trim().replace(/[\s()-]/g, '');
  if (!normalizedPhone.startsWith('+')) {
    normalizedPhone = normalizedPhone.length === 10 ? `+91${normalizedPhone}` : `+${normalizedPhone}`;
  }

  const payload = {
    full_name: String(full_name).trim(),
    specialty: specialty?.trim() || 'General Medicine',
    sub_specialty: sub_specialty ? String(sub_specialty).trim() : null,
    institution: institution ? String(institution).trim() : null,
    country: country?.trim() || 'India',
    phone_e164: normalizedPhone,
    email: email ? String(email).trim() : null,
    languages: Array.isArray(languages) ? languages : ['en'],
    notes: notes || null,
    is_active: true
  };

  const { data: item, error } = await db
    .from('international_specialists')
    .insert(payload)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  res.status(201).json({ ok: true, specialist: item });
});

export const deleteSpecialistDirectoryItem = ah(async (req, res) => {
  const { id } = req.params;
  const { error } = await db
    .from('international_specialists')
    .update({ is_active: false })
    .eq('id', id);

  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
});

/**
 * GET /api/v1/review/intl/:token/documents/:docId
 * Stream attached scan or lab report for international specialist review
 */
export const reviewIntlDocument = ah(async (req, res) => {
  const { token, docId } = req.params;
  if (!token || token.length !== 48) throw httpError(403, 'invalid');

  const tokenH = hashToken(token);
  const { data: opReq, error: reqErr } = await db
    .from('international_opinion_requests')
    .select('id, hospital_id, hospital_case_id, status, token_expires_at')
    .eq('magic_token_hash', tokenH)
    .maybeSingle();

  if (reqErr || !opReq) throw httpError(403, 'invalid');
  if (opReq.status === 'cancelled') throw httpError(403, 'revoked');
  if (opReq.token_expires_at && new Date(opReq.token_expires_at).getTime() < Date.now()) {
    throw httpError(403, 'expired');
  }

  // Fetch document ensuring it belongs to the hospital case
  const { data: doc, error: docErr } = await db
    .from('hospital_documents')
    .select('*')
    .eq('id', docId)
    .eq('hospital_case_id', opReq.hospital_case_id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (docErr || !doc) throw httpError(404, 'Document not found');

  const { data: fileData, error: dlErr } = await db.storage
    .from('case-documents')
    .download(doc.storage_path);

  if (dlErr || !fileData) throw httpError(500, 'Could not retrieve scan file');

  await audit(req, 'INTL_SCAN_VIEWED', {
    resourceType: 'hospital_document',
    resourceId: doc.id,
    detail: { hospital_case_id: opReq.hospital_case_id, file_name: doc.file_name }
  });

  res.set('Content-Type', doc.file_type || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(doc.file_name)}"`);
  res.send(Buffer.from(await fileData.arrayBuffer()));
});
