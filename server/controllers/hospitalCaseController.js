// DEC-056: Hospital Patient & Case Management Controller
import crypto from 'crypto';
import multer from 'multer';
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { sanitizeHospitalCaseForRole } from '../lib/scope.js';
import { buildHospitalClinicVisitPdf } from '../services/pdfReportService.js';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const ALLOWED_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const CHECKIN_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateCheckinCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHECKIN_CHARS[Math.floor(Math.random() * CHECKIN_CHARS.length)];
  }
  return code;
}

async function getNextHospitalCaseNumber(hospitalId) {
  const { data: cases } = await db
    .from('hospital_cases')
    .select('case_number')
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (cases && cases.length && cases[0].case_number) {
    const parsed = parseInt(cases[0].case_number.replace(/\D/g, ''), 10);
    if (!isNaN(parsed)) nextNum = parsed + 1;
  }
  return `C-${String(nextNum).padStart(4, '0')}`;
}

/**
 * GET /api/v1/hospital/patients
 * List or search hospital patients
 */
export const listHospitalPatients = ah(async (req, res) => {
  const { q, mrn, phone } = req.query;

  let query = db
    .from('hospital_patients')
    .select('*')
    .eq('hospital_id', req.tenant.id)
    .order('created_at', { ascending: false });

  if (mrn) query = query.eq('mrn', String(mrn).trim());
  if (phone) query = query.like('phone', `%${String(phone).trim()}%`);
  if (q) query = query.ilike('full_name', `%${String(q).trim()}%`);

  const { data: patients, error } = await query.limit(50);
  if (error) throw httpError(500, error.message);

  res.json({ ok: true, patients });
});

/**
 * POST /api/v1/hospital/patients
 * Creates a new hospital patient record
 */
export const createHospitalPatient = ah(async (req, res) => {
  const { mrn, full_name, phone, dob, gender, address, medical_history } = req.body;

  if (!full_name || !String(full_name).trim()) throw httpError(400, 'Full name is required');
  if (!mrn || !String(mrn).trim()) throw httpError(400, 'MRN is required');

  const payload = {
    hospital_id: req.tenant.id,
    mrn: String(mrn).trim().toUpperCase(),
    full_name: String(full_name).trim(),
    phone: phone ? String(phone).trim() : null,
    dob: dob || null,
    gender: ['MALE', 'FEMALE', 'OTHER'].includes(gender) ? gender : null,
    address: address ? String(address).trim() : null,
    medical_history: medical_history || null
  };

  const { data: patient, error } = await db
    .from('hospital_patients')
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw httpError(409, `A patient with MRN ${mrn} already exists in this hospital`);
    throw httpError(500, error.message);
  }

  await audit(req, 'HOSPITAL_PATIENT_CREATED', {
    resourceType: 'hospital_patient',
    resourceId: patient.id,
    detail: { mrn: patient.mrn, name: patient.full_name },
    hospitalId: req.tenant.id
  });

  res.status(201).json({ ok: true, patient });
});

/**
 * GET /api/v1/hospital/cases
 * List hospital cases filtered by status, doctor, date
 */
export const listHospitalCases = ah(async (req, res) => {
  const { status, doctor_id, date, arrival_status } = req.query;

  let query = db
    .from('hospital_cases')
    .select(`
      id, case_number, checkin_code, queue_number, source, service_type,
      requested_specialty, status, arrival_status, arrived_at, in_clinic_at,
      assigned_doctor_id, appointment_date, appointment_time, created_at,
      hospital_patient_id, case_summary
    `)
    .eq('hospital_id', req.tenant.id)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (doctor_id) query = query.eq('assigned_doctor_id', doctor_id);
  if (date) query = query.eq('appointment_date', date);
  if (arrival_status) query = query.eq('arrival_status', arrival_status);

  // If doctor, default filter to own cases unless hospital_admin
  if (req.staff.role === 'doctor' && !doctor_id) {
    query = query.eq('assigned_doctor_id', req.staff.id);
  }

  const { data: cases, error } = await query.limit(100);
  if (error) throw httpError(500, error.message);

  // Enrich with patient and doctor info
  const pIds = [...new Set((cases || []).map(c => c.hospital_patient_id).filter(Boolean))];
  const dIds = [...new Set((cases || []).map(c => c.assigned_doctor_id).filter(Boolean))];

  const { data: patients } = pIds.length
    ? await db.from('hospital_patients').select('id, full_name, mrn, phone').in('id', pIds)
    : { data: [] };
  const { data: doctors } = dIds.length
    ? await db.from('staff_users').select('id, full_name, specialty').in('id', dIds)
    : { data: [] };

  const pMap = Object.fromEntries((patients || []).map(p => [p.id, p]));
  const dMap = Object.fromEntries((doctors || []).map(d => [d.id, d]));

  const sanitized = (cases || []).map(c => {
    const raw = {
      ...c,
      patient: pMap[c.hospital_patient_id] || null,
      doctor: dMap[c.assigned_doctor_id] || null
    };
    return sanitizeHospitalCaseForRole(raw, req.staff.role);
  });

  res.json({ ok: true, cases: sanitized });
});

/**
 * POST /api/v1/hospital/cases
 * Creates a walk-in hospital case
 */
export const createHospitalCase = ah(async (req, res) => {
  const {
    hospital_patient_id,
    assigned_doctor_id,
    requested_specialty,
    service_type,
    case_summary,
    patient_question,
    appointment_date,
    appointment_time
  } = req.body;

  if (!hospital_patient_id) throw httpError(400, 'hospital_patient_id is required');
  if (!case_summary || !String(case_summary).trim()) throw httpError(400, 'case_summary is required');

  const { data: patient, error: pErr } = await db
    .from('hospital_patients')
    .select('id, full_name')
    .eq('id', hospital_patient_id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (pErr || !patient) throw httpError(404, 'Hospital patient not found');

  const caseNumber = await getNextHospitalCaseNumber(req.tenant.id);
  const checkinCode = generateCheckinCode();

  const casePayload = {
    hospital_id: req.tenant.id,
    hospital_patient_id,
    case_number: caseNumber,
    checkin_code: checkinCode,
    source: 'hospital',
    service_type: service_type || 'in_person',
    requested_specialty: requested_specialty || null,
    assigned_doctor_id: assigned_doctor_id || null,
    case_summary: String(case_summary).trim(),
    patient_question: patient_question ? String(patient_question).trim() : null,
    status: 'new',
    arrival_status: 'scheduled',
    appointment_date: appointment_date || new Date().toISOString().split('T')[0],
    appointment_time: appointment_time || null,
    visit_type: 'visit'
  };

  const { data: created, error } = await db
    .from('hospital_cases')
    .insert(casePayload)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  // Timeline entry
  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: created.id,
    from_status: null,
    to_status: 'new',
    arrival_status: 'scheduled',
    actor_id: req.staff.id,
    actor_role: req.staff.role,
    note: 'Case initiated at hospital clinic'
  });

  await audit(req, 'HOSPITAL_CASE_CREATED', {
    resourceType: 'hospital_case',
    resourceId: created.id,
    detail: { case_number: caseNumber, checkin_code: checkinCode },
    hospitalId: req.tenant.id
  });

  res.status(201).json({ ok: true, case: created });
});

/**
 * GET /api/v1/hospital/cases/:id
 * Full case chart view, enriched with clinical sub-modules
 */
export const getHospitalCaseDetail = ah(async (req, res) => {
  const { id } = req.params;

  const { data: c, error } = await db
    .from('hospital_cases')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (error || !c) throw httpError(404, 'Case not found');

  // Related data
  const [patientRes, doctorRes, timelineRes, docsRes, labRes, medsRes] = await Promise.all([
    db.from('hospital_patients').select('*').eq('id', c.hospital_patient_id).maybeSingle(),
    c.assigned_doctor_id ? db.from('staff_users').select('id, full_name, specialty').eq('id', c.assigned_doctor_id).maybeSingle() : { data: null },
    db.from('hospital_case_timeline').select('*').eq('hospital_case_id', c.id).order('created_at', { ascending: false }),
    db.from('hospital_documents').select('*').eq('hospital_case_id', c.id).eq('is_deleted', false).order('created_at', { ascending: false }),
    db.from('hospital_lab_tests').select('*').eq('hospital_case_id', c.id).order('created_at', { ascending: false }),
    db.from('hospital_medications').select('*').eq('hospital_case_id', c.id).order('created_at', { ascending: false })
  ]);

  const raw = {
    ...c,
    patient: patientRes.data || null,
    doctor: doctorRes.data || null,
    timeline: timelineRes.data || [],
    documents: docsRes.data || [],
    lab_tests: labRes.data || [],
    medications: medsRes.data || []
  };

  const sanitized = sanitizeHospitalCaseForRole(raw, req.staff.role);
  res.json({ ok: true, case: sanitized });
});

/**
 * POST /api/v1/hospital/cases/:id/opinion
 * Doctor records consultation findings, diagnosis, and prescription completion
 */
export const saveDoctorOpinion = ah(async (req, res) => {
  const { id } = req.params;
  const { doctor_opinion, case_summary, follow_up, completed } = req.body;

  const { data: c, error: findErr } = await db
    .from('hospital_cases')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !c) throw httpError(404, 'Case not found');

  const updates = {};
  if (doctor_opinion !== undefined) updates.doctor_opinion = doctor_opinion;
  if (case_summary !== undefined) updates.case_summary = case_summary;
  if (follow_up !== undefined) updates.follow_up = follow_up;

  // Check if case can be marked completed
  if (completed) {
    const { data: pendingLabs } = await db
      .from('hospital_lab_tests')
      .select('id')
      .eq('hospital_case_id', id)
      .in('status', ['requested', 'collected', 'in_progress']);

    const { data: pendingMeds } = await db
      .from('hospital_medications')
      .select('id')
      .eq('hospital_case_id', id)
      .eq('dispense_status', 'prescribed');

    if (pendingLabs && pendingLabs.length) {
      updates.status = 'pending_lab';
    } else if (pendingMeds && pendingMeds.length) {
      updates.status = 'pending_pharmacy';
    } else {
      updates.status = 'completed';
    }
  } else if (c.status === 'new') {
    updates.status = 'in_consultation';
  }

  const { data: updated, error } = await db
    .from('hospital_cases')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: id,
    from_status: c.status,
    to_status: updated.status,
    actor_id: req.staff.id,
    actor_role: req.staff.role,
    note: completed ? 'Doctor completed consultation and recorded clinical opinion.' : 'Doctor updated clinical consultation notes.'
  });

  await audit(req, 'HOSPITAL_CASE_STATUS', {
    resourceType: 'hospital_case',
    resourceId: id,
    detail: { from: c.status, to: updated.status },
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, case: updated });
});

/**
 * POST /api/v1/hospital/cases/:id/documents
 * Uploads a document to private hospital storage
 */
export const uploadHospitalDocument = ah(async (req, res) => {
  const { id } = req.params;
  const { category } = req.body;

  if (!req.file) throw httpError(400, 'No file received');

  const { data: c, error: findErr } = await db
    .from('hospital_cases')
    .select('id, hospital_id')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !c) throw httpError(404, 'Case not found');

  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const mimeType = ALLOWED_MIME[ext];
  if (!mimeType) throw httpError(400, 'File type not supported. Allowed: PDF, JPG, PNG, DOCX.');

  const storagePath = `hospitals/${req.tenant.id}/${c.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage
    .from('case-documents')
    .upload(storagePath, req.file.buffer, { contentType: mimeType });

  if (upErr) throw httpError(500, `Storage upload failed: ${upErr.message}`);

  const { data: doc, error } = await db
    .from('hospital_documents')
    .insert({
      hospital_id: req.tenant.id,
      hospital_case_id: c.id,
      uploader_id: req.staff.id,
      uploader_role: req.staff.role,
      category: category || 'clinical_note',
      file_name: req.file.originalname,
      file_type: mimeType,
      file_size: req.file.size,
      storage_path: storagePath
    })
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  res.status(201).json({ ok: true, document: doc });
});

/**
 * GET /api/v1/hospital/cases/:id/report/pdf
 * Generates and downloads the official clinic visit summary PDF
 */
export const downloadClinicVisitPdf = ah(async (req, res) => {
  const c = req.hospitalCase;

  const [patRes, docRes, labRes, medRes] = await Promise.all([
    db.from('hospital_patients').select('*').eq('id', c.hospital_patient_id).maybeSingle(),
    c.assigned_doctor_id ? db.from('staff_users').select('*').eq('id', c.assigned_doctor_id).maybeSingle() : { data: null },
    db.from('hospital_lab_tests').select('*').eq('hospital_case_id', c.id).order('created_at'),
    db.from('hospital_medications').select('*').eq('hospital_case_id', c.id).order('created_at')
  ]);

  const isMobile = ['ios', 'android'].includes(req.clientInfo?.platform || req.headers['x-client-platform']);
  const inline = req.query.inline === 'true' || isMobile;
  const disposition = inline ? 'inline' : 'attachment';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="Clinic_Visit_${c.case_number || 'case'}.pdf"`);
  res.setHeader('Accept-Ranges', 'bytes');

  buildHospitalClinicVisitPdf({
    hospitalCaseData: c,
    hospitalData: req.tenant,
    patientData: patRes.data || {},
    doctorData: docRes.data || {},
    labTests: labRes.data || [],
    medications: medRes.data || [],
    streamRes: res
  });
});
