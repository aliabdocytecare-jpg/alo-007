// Case routes — Part 6 permission matrix enforced via middleware in index.js.
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { createCase, transition, completeService, listCasesForRole, getCaseForRole } from '../services/caseService.js';
import { issueLink, revokeActiveLinks } from '../services/magicLinkService.js';
import { notify, notifyAdmins } from '../services/notificationService.js';

export const listCases = ah(async (req, res) => {
  res.json(await listCasesForRole(req.session));
});

// F-CASE-01: only patients create cases (6.2). BR-028: no self-assignment.
export const create = ah(async (req, res) => {
  const { service_type, service_subtype, specialty, purpose, reason, history, parent_case_id } = req.body;
  if (!['CONSULTATION', 'GMO', 'SERVICE'].includes(service_type)) throw httpError(400, 'Invalid service type.');
  if (!reason?.trim()) throw httpError(400, 'Please describe the reason for your request.');
  if (service_type === 'GMO' && !purpose) throw httpError(400, 'Please select the purpose of the opinion.');
  if (service_type === 'CONSULTATION' && !['ONLINE', 'IN_PERSON', 'FOLLOW_UP'].includes(service_subtype)) throw httpError(400, 'Invalid consultation type.');
  const { data: patient } = await db.from('patients').select().eq('id', req.session.sub).single();
  const c = await createCase({ patient, service_type, service_subtype, specialty, purpose, reason, history, parent_case_id }, req);
  res.status(201).json({ id: c.id, case_number: c.case_number });
});

export const getOne = ah(async (req, res) => {
  const lang = req.query.lang === 'ar' ? 'ar' : 'en';
  res.json(await getCaseForRole(req.case, req.session, lang));
});

export const patchStatus = ah(async (req, res) => {
  const { to, note, version } = req.body;
  if (req.case.service_type === 'SERVICE' && to === 'COMPLETED') {
    const c = await completeService(req.case.id, { actorId: req.session.sub, actorRole: req.session.role, note });
    return res.json({ ok: true, status: c.status, version: c.version });
  }
  const c = await transition(req.case.id, to, {
    actorId: req.session.sub, actorRole: req.session.role, note, expectedVersion: version ?? null
  });
  res.json({ ok: true, status: c.status, version: c.version });
});

// US-CRD-004 / N-13. Part 8.2: duplicate confirmation blocked.
export const confirmPayment = ah(async (req, res) => {
  const c = req.case;
  if (c.payment_confirmed) throw httpError(409, 'Payment has already been confirmed for this case.');
  if (!['SUBMITTED', 'INITIAL_REVIEW'].includes(c.status)) throw httpError(409, 'Payment can only be confirmed during initial review.');
  const note = req.body.note || '';
  await db.from('cases').update({ payment_confirmed: true, payment_note: note }).eq('id', c.id);
  if (c.status === 'INITIAL_REVIEW') {
    await transition(c.id, 'READY_FOR_ASSIGNMENT', { actorId: req.session.sub, actorRole: 'coordinator', note: `Payment confirmed. ${note}` });
  }
  await audit(req, 'PAYMENT_CONFIRMED', { resourceType: 'case', resourceId: c.id, detail: { note } });
  await notify({ event: 'N-13', caseId: c.id, recipientType: 'patient', recipientId: c.patient_id, title: 'Payment Confirmed', body: `Case ${c.case_number}: payment confirmed — your case will now proceed.` });
  res.json({ ok: true });
});

// US-CRD-003 / N-05.
export const requestDocuments = ah(async (req, res) => {
  const note = req.body.note?.trim();
  if (!note) throw httpError(400, 'Please specify which documents are needed.');
  await db.from('cases').update({ document_request_note: note }).eq('id', req.case.id);
  await transition(req.case.id, 'ADDITIONAL_INFO_REQUIRED', { actorId: req.session.sub, actorRole: 'coordinator', note });
  await notify({ event: 'N-05', caseId: req.case.id, recipientType: 'patient', recipientId: req.case.patient_id, title: 'Additional Information Required', body: `Case ${req.case.case_number}: additional documents are needed. Please open your case to see the list.` });
  res.json({ ok: true });
});

// US-CRD-002 (local staff) / US-CRD-005 (international, BR-009 GMO-only).
export const assign = ah(async (req, res) => {
  const c = req.case;
  const { staff_id, specialist_name, specialist_phone } = req.body;

  if (specialist_phone) {
    if (c.service_type !== 'GMO') throw httpError(409, 'International specialist review is only available for GMO cases.');
    if (!['READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status)) throw httpError(409, 'Case must be ready for assignment first.');
    if (!specialist_name?.trim()) throw httpError(400, 'Specialist name is required.');
    if (!/^\+[1-9]\d{7,14}$/.test(specialist_phone)) throw httpError(400, 'Specialist WhatsApp number must be in international format.');
    const { token, record } = await issueLink(c.id, specialist_name.trim(), specialist_phone, req.session.sub);
    if (c.status === 'READY_FOR_ASSIGNMENT') {
      await transition(c.id, 'SPECIALIST_ASSIGNED', { actorId: req.session.sub, actorRole: 'coordinator', note: `International specialist: ${specialist_name}` });
    }
    // DEC-047: magic links point at the primary frontend origin (first CLIENT_ORIGIN entry).
    const appOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
    const reviewUrl = `${appOrigin}/review/${token}`;
    // N-06: WhatsApp only, no PHI (BR-017).
    await notify({
      event: 'N-06', caseId: c.id, recipientType: 'specialist', channels: ['whatsapp'],
      title: 'Medical Case Review',
      body: `Dear Dr. ${specialist_name}, you have been assigned case ${c.case_number} for specialist review. Open secure case: ${reviewUrl} — link expires in 72 hours.`
    });
    await audit(req, 'MAGIC_LINK_ISSUED', { resourceType: 'case', resourceId: c.id, detail: { specialist_name, specialist_phone, expires_at: record.expires_at } });
    return res.json({ ok: true, review_url: `/review/${token}`, expires_at: record.expires_at });
  }

  if (!staff_id) throw httpError(400, 'Select a staff member to assign.');
  // DEC-035: same status gate as the international branch — no silent owner changes
  // outside the assignment window (was possible from INITIAL_REVIEW/terminal states).
  if (!['READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status)) throw httpError(409, 'Case must be ready for assignment first.');
  const { data: staff } = await db.from('staff_users').select().eq('id', staff_id).eq('is_active', true).maybeSingle();
  if (!staff) throw httpError(404, 'Staff member not found or inactive.');
  const { error: assignErr } = await db.from('case_assignments').upsert({ case_id: c.id, staff_id, role: staff.role, assigned_by: req.session.sub }, { onConflict: 'case_id,staff_id' });
  if (assignErr) throw httpError(500, assignErr.message);
  await db.from('cases').update({ owner_id: staff_id, owner_role: staff.role }).eq('id', c.id);
  if (c.status === 'READY_FOR_ASSIGNMENT') {
    await transition(c.id, 'SPECIALIST_ASSIGNED', { actorId: req.session.sub, actorRole: 'coordinator', note: `Assigned ${staff.role}: ${staff.full_name}` });
  }
  await audit(req, 'CASE_ASSIGNED', { resourceType: 'case', resourceId: c.id, detail: { staff_id, role: staff.role } });
  // N-04: assigned staff notified.
  await notify({ event: 'N-04', caseId: c.id, recipientType: 'staff', recipientId: staff_id, title: 'New case assigned', body: `Case ${c.case_number} has been assigned to you. Open AloDoc to view details.` });
  res.json({ ok: true });
});

// US-CRD-007 AC1.
export const revokeLink = ah(async (req, res) => {
  await revokeActiveLinks(req.case.id);
  await audit(req, 'MAGIC_LINK_REVOKED', { resourceType: 'case', resourceId: req.case.id });
  await db.from('case_timeline').insert({
    case_id: req.case.id, from_status: req.case.status, to_status: req.case.status,
    actor_id: req.session.sub, actor_role: 'coordinator', note: 'Specialist review link revoked', patient_visible: false
  });
  res.json({ ok: true });
});

// BR-020 / US-CRD-010: mandatory reason, archive not delete, N-14.
export const cancel = ah(async (req, res) => {
  const reason = req.body.reason?.trim();
  if (!reason) throw httpError(400, 'A cancellation reason is required.');
  await transition(req.case.id, 'CANCELLED', { actorId: req.session.sub, actorRole: req.session.role, note: reason });
  await notify({ event: 'N-14', caseId: req.case.id, recipientType: 'patient', recipientId: req.case.patient_id, title: 'Case Cancelled', body: `Case ${req.case.case_number} has been cancelled. Reason: ${reason}` });
  res.json({ ok: true });
});

// US-CRD-009 AC2: escalate notifies admin.
export const escalate = ah(async (req, res) => {
  const note = req.body.note?.trim() || 'Escalated by coordinator';
  await db.from('cases').update({ escalated: true }).eq('id', req.case.id);
  await db.from('case_timeline').insert({
    case_id: req.case.id, from_status: req.case.status, to_status: req.case.status,
    actor_id: req.session.sub, actor_role: req.session.role, note: `ESCALATED: ${note}`, patient_visible: false
  });
  await audit(req, 'CASE_ESCALATED', { resourceType: 'case', resourceId: req.case.id, detail: { note } });
  await notifyAdmins({ event: 'CASE_ESCALATED', caseId: req.case.id, title: 'Case escalated', body: `Case ${req.case.case_number} was escalated: ${note}` });
  res.json({ ok: true });
});

// Patient catalog: BR-026 (off services hidden; coming-soon visible but not bookable).
export const catalog = ah(async (req, res) => {
  const [specialties, services, doctors, settings] = await Promise.all([
    db.from('specialties').select().eq('is_active', true).order('name_en'),
    db.from('services').select().order('name_en'),
    db.from('staff_users').select().eq('role', 'doctor').eq('is_active', true),
    db.from('system_settings').select()
  ]);
  const settingsMap = Object.fromEntries((settings.data || []).map(s => [s.key, s.value]));
  res.json({
    specialties: specialties.data || [],
    services: (services.data || []).filter(s => s.is_active || s.coming_soon),
    doctors: (doctors.data || []).map(d => ({ id: d.id, full_name: d.full_name, specialty: d.specialty })),
    settings: settingsMap
  });
});

export const staffDirectory = ah(async (req, res) => {
  const { data } = await db.from('staff_users').select().eq('is_active', true).order('full_name');
  res.json((data || []).map(s => ({ id: s.id, full_name: s.full_name, role: s.role, specialty: s.specialty })));
});