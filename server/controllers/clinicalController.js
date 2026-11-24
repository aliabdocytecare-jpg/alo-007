// Clinical domain — US-NUR-003/004, US-DOC-003..007, US-CRD-008/011, F-MEET, F-RX.
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { transition } from '../services/caseService.js';
import { notify, notifyCoordinators } from '../services/notificationService.js';
import { issueLink } from '../services/magicLinkService.js';

const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

// US-NUR-003: vitals saved with nurse + timestamp. US-NUR-004 AC3: read-only after routing.
export const saveVitals = ah(async (req, res) => {
  if (req.case.intake_completed) throw httpError(409, 'Intake is complete. This case is read-only for nursing.');
  const { blood_pressure, heart_rate, temperature, weight, height, spo2, nursing_notes } = req.body;
  const { data, error } = await db.from('vitals').insert({
    case_id: req.case.id, nurse_id: req.session.sub,
    blood_pressure: blood_pressure || null, heart_rate: heart_rate || null, temperature: temperature || null,
    weight: weight || null, height: height || null, spo2: spo2 || null, nursing_notes: nursing_notes || null
  }).select().single();
  if (error) throw httpError(500, error.message);
  await audit(req, 'VITALS_RECORDED', { resourceType: 'case', resourceId: req.case.id });
  res.status(201).json(data);
});

// US-NUR-004: route to coordinator; case becomes read-only for nurse.
export const completeIntake = ah(async (req, res) => {
  if (req.case.intake_completed) throw httpError(409, 'Intake already completed.');
  await db.from('cases').update({ intake_completed: true }).eq('id', req.case.id);
  await db.from('case_timeline').insert({
    case_id: req.case.id, from_status: req.case.status, to_status: req.case.status,
    actor_id: req.session.sub, actor_role: 'nurse', note: 'Clinical triage intake completed by ALO Nurse', patient_visible: false
  });
  await audit(req, 'INTAKE_COMPLETED', { resourceType: 'case', resourceId: req.case.id });
  await notifyCoordinators({ event: 'INTAKE_DONE', caseId: req.case.id, title: 'Intake completed', body: `Case ${req.case.case_number}: nursing intake complete. Ready for next step.` });
  res.json({ ok: true });
});

// Coordinator/Nurse scheduling -> APPOINTMENT_SCHEDULED + N-03. Supports Stream 2 Live Tripartite Video.
export const schedule = ah(async (req, res) => {
  const c = req.case;
  if (c.service_type !== 'CONSULTATION') throw httpError(409, 'Only consultation cases can be scheduled.');
  if (c.status !== 'SPECIALIST_ASSIGNED') throw httpError(409, 'Assign a doctor before scheduling.');
  const { scheduled_at, clinic_name, clinic_address, meet_url, is_tripartite, specialist_name, specialist_phone } = req.body;
  if (!scheduled_at || new Date(scheduled_at) <= new Date()) throw httpError(400, 'Appointment must be in the future.');
  const { data: assigns } = await db.from('case_assignments').select().eq('case_id', c.id);
  const doctor = (assigns || []).find(a => a.role === 'doctor');
  const type = c.service_subtype === 'IN_PERSON' ? 'IN_PERSON' : 'ONLINE';
  const { error } = await db.from('consultations').upsert({
    case_id: c.id, doctor_id: doctor?.staff_id || null, consultation_type: type,
    scheduled_at, clinic_name: clinic_name || null, clinic_address: clinic_address || null,
    meet_url: meet_url || null
  }, { onConflict: 'case_id' });
  if (error) throw httpError(500, error.message);

  let tokenResult = null;
  if (is_tripartite && specialist_name && specialist_phone) {
    try {
      tokenResult = await issueLink(c.id, specialist_name.trim(), specialist_phone, req.session.sub);
    } catch (e) {
      console.error('Tripartite specialist link dispatch error:', e?.message);
    }
  }

  await transition(c.id, 'APPOINTMENT_SCHEDULED', {
    actorId: req.session.sub,
    actorRole: req.session.role || 'nurse',
    note: `Appointment: ${scheduled_at}${is_tripartite ? ` (Live Tripartite Video: Saudi Doctor + ${specialist_name})` : ''}`
  });
  await notify({
    event: 'N-03',
    caseId: c.id,
    recipientType: 'patient',
    recipientId: c.patient_id,
    title: 'Appointment Confirmed',
    body: `Case ${c.case_number}: your appointment is confirmed for ${new Date(scheduled_at).toLocaleString()}.${meet_url ? ` Video room: ${meet_url}` : ''} Open AloDoc for details.`
  });
  res.json({
    ok: true,
    review_url: tokenResult ? `/review/${tokenResult.token}` : null,
    token: tokenResult?.token || null
  });
});

// F-MEET-01: strict Google Meet URL validation.
export const setMeetLink = ah(async (req, res) => {
  const url = (req.body.meet_url || '').trim();
  if (!MEET_RE.test(url)) throw httpError(400, 'Enter a valid Google Meet link (https://meet.google.com/xxx-xxxx-xxx).');
  const { data: cons } = await db.from('consultations').select().eq('case_id', req.case.id).maybeSingle();
  if (!cons) throw httpError(409, 'Schedule the appointment first.');
  await db.from('consultations').update({ meet_url: url }).eq('id', cons.id);
  await audit(req, 'MEET_LINK_SET', { resourceType: 'case', resourceId: req.case.id });
  res.json({ ok: true });
});

export const startConsultation = ah(async (req, res) => {
  let { data: cons } = await db.from('consultations').select().eq('case_id', req.case.id).maybeSingle();
  if (!cons) {
    const type = req.case.service_subtype === 'IN_PERSON' ? 'IN_PERSON' : 'ONLINE';
    await db.from('consultations').upsert({
      case_id: req.case.id,
      doctor_id: req.session.sub,
      consultation_type: type
    }, { onConflict: 'case_id' });
  }
  await transition(req.case.id, 'IN_PROGRESS', { actorId: req.session.sub, actorRole: 'doctor' });
  res.json({ ok: true });
});

// US-DOC-004: structured draft notes; visible to doctor + coordinator only (BR-014).
export const saveNotes = ah(async (req, res) => {
  let { data: cons } = await db.from('consultations').select().eq('case_id', req.case.id).maybeSingle();
  if (!cons) {
    const type = req.case.service_subtype === 'IN_PERSON' ? 'IN_PERSON' : 'ONLINE';
    const { data: newCons, error } = await db.from('consultations').upsert({
      case_id: req.case.id,
      doctor_id: req.session.sub,
      consultation_type: type
    }, { onConflict: 'case_id' }).select().single();
    if (error) throw httpError(500, error.message);
    cons = newCons;
  }
  const notes = {
    chief_complaint: req.body.chief_complaint || '', findings: req.body.findings || '',
    diagnosis: req.body.diagnosis || '', plan: req.body.plan || '', free_text: req.body.free_text || ''
  };
  await db.from('consultations').update({ notes_draft: notes, notes_updated_at: new Date().toISOString() }).eq('id', cons.id);
  res.json({ ok: true, saved_at: new Date().toISOString() });
});

// US-DOC-005/007: final report + follow-up recommendation -> REPORT_SUBMITTED, coordinator notified.
export const submitReport = ah(async (req, res) => {
  const c = req.case;
  const report = req.body.report?.trim();
  if (!report) throw httpError(400, 'Final report text is required.');
  let { data: cons } = await db.from('consultations').select().eq('case_id', c.id).maybeSingle();
  if (!cons) {
    const type = c.service_subtype === 'IN_PERSON' ? 'IN_PERSON' : 'ONLINE';
    const { data: newCons, error } = await db.from('consultations').upsert({
      case_id: c.id,
      doctor_id: req.session.sub,
      consultation_type: type
    }, { onConflict: 'case_id' }).select().single();
    if (error) throw httpError(500, error.message);
    cons = newCons;
  }
  if (cons.submitted_at) throw httpError(409, 'Final report already submitted.');
  const fu = !!req.body.follow_up_recommended;
  await db.from('consultations').update({
    final_report: report, submitted_at: new Date().toISOString(),
    follow_up_recommended: fu, follow_up_timeframe: req.body.follow_up_timeframe || null,
    follow_up_type: req.body.follow_up_type || null, follow_up_reason: req.body.follow_up_reason || null
  }).eq('id', cons.id);
  await db.from('cases').update({ follow_up_recommended: fu, follow_up_note: req.body.follow_up_reason || null }).eq('id', c.id);
  await transition(c.id, 'REPORT_SUBMITTED', { actorId: req.session.sub, actorRole: 'doctor' });
  await audit(req, 'REPORT_SUBMITTED', { resourceType: 'case', resourceId: c.id });
  await notifyCoordinators({ event: 'REPORT_READY', caseId: c.id, title: 'Report submitted', body: `Case ${c.case_number}: final report submitted. Review and release to patient.` });
  if (fu) await notify({ event: 'N-11', caseId: c.id, recipientType: 'patient', recipientId: c.patient_id, title: 'Follow-up Recommended', body: `Case ${c.case_number}: your doctor recommends a follow-up. Open your case to request it.` });
  res.json({ ok: true });
});

// US-CRD-008 / BR-015 / N-09: release makes report patient-visible; COMPLETED (+FOLLOW_UP).
export const releaseReport = ah(async (req, res) => {
  const c = req.case;
  if (c.status !== 'REPORT_SUBMITTED') throw httpError(409, 'No submitted report awaiting release.');
  const { data: cons } = await db.from('consultations').select().eq('case_id', c.id).maybeSingle();
  const { data: review } = await db.from('international_reviews').select().eq('case_id', c.id).maybeSingle();
  const now = new Date().toISOString();
  if (cons?.final_report && !cons.released_at) {
    await db.from('consultations').update({ released_at: now, released_by: req.session.sub }).eq('id', cons.id);
  } else if (review?.status === 'SUBMITTED' && !review.released_at) {
    await db.from('international_reviews').update({ released_at: now, released_by: req.session.sub }).eq('id', review.id);
  } else {
    throw httpError(409, 'No final report or opinion found to release.');
  }
  await transition(c.id, 'COMPLETED', { actorId: req.session.sub, actorRole: 'coordinator', note: 'Report released to patient' });
  if (c.follow_up_recommended) await transition(c.id, 'FOLLOW_UP', { actorRole: 'system', note: 'Follow-up recommended by doctor' });
  await audit(req, 'REPORT_RELEASED', { resourceType: 'case', resourceId: c.id });
  await notify({ event: 'N-09', caseId: c.id, recipientType: 'patient', recipientId: c.patient_id, title: 'Medical Opinion Is Ready', body: `Case ${c.case_number}: your medical report is now available in your AloDoc portal.` });
  res.json({ ok: true });
});

// F-RX-01 / BR-022: doctors see only active drugs; admin sees all with ?all=1.
export const listFormulary = ah(async (req, res) => {
  let q = db.from('drug_formulary').select().order('generic_name');
  if (!(req.session.role === 'admin' && req.query.all === '1')) q = q.eq('is_active', true);
  const { data } = await q;
  res.json(data || []);
});

// F-RX-02 / BR-021: prescriptions attach to the case; multiple allowed.
export const addPrescription = ah(async (req, res) => {
  const { drug_name, dosage, frequency, duration, route, special_instructions, source, formulary_id } = req.body;
  if (!drug_name?.trim()) throw httpError(400, 'Drug name is required.');
  if (!['FORMULARY', 'FREE_TEXT'].includes(source)) throw httpError(400, 'Invalid prescription source.');
  const { data, error } = await db.from('prescriptions').insert({
    case_id: req.case.id, doctor_id: req.session.sub,
    drug_name: drug_name.trim(), dosage: dosage || null, frequency: frequency || null,
    duration: duration || null, route: route || null, special_instructions: special_instructions || null,
    source, formulary_id: formulary_id || null
  }).select().single();
  if (error) throw httpError(500, error.message);
  await audit(req, 'PRESCRIPTION_ISSUED', { resourceType: 'case', resourceId: req.case.id, detail: { prescription_id: data.id } });
  res.status(201).json(data);
});

// Test C2 / US-DOC-002 AC3: prior consultation context for follow-up cases.
export const parentContext = ah(async (req, res) => {
  if (!req.case.parent_case_id) return res.json({ parent: null });
  const { data: parent } = await db.from('cases').select().eq('id', req.case.parent_case_id).maybeSingle();
  if (!parent) return res.json({ parent: null });
  const { data: cons } = await db.from('consultations').select().eq('case_id', parent.id).maybeSingle();
  const { data: review } = await db.from('international_reviews').select().eq('case_id', parent.id).maybeSingle();
  res.json({
    parent: {
      id: parent.id, case_number: parent.case_number, service_type: parent.service_type,
      specialty: parent.specialty, status: parent.status, reason: parent.reason,
      consultation: cons ? { notes_draft: cons.notes_draft, final_report: cons.final_report, submitted_at: cons.submitted_at } : null,
      review: review?.status === 'SUBMITTED' ? { findings: review.findings, recommendation: review.recommendation } : null
    }
  });
});