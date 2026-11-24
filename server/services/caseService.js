// Case engine — F-CASE-01..04, Part 5 state machine, BR-001/002/012/029, DEC-011 locking.
import { db } from '../config/db.js';
import { httpError, audit } from '../lib/helpers.js';
import { LABELS, NEXT_STEP, assertTransition, TERMINAL } from './stateMachine.js';
import { notify, notifyCoordinators } from './notificationService.js';
import { computeCaseWorkflow } from '../lib/caseWorkflowEngine.js';

async function slaMinutes(status) {
  const { data } = await db.from('sla_config').select().eq('status', status).maybeSingle();
  return data?.target_minutes ?? null;
}

// F-CASE-03 ownership rules per stage.
function ownershipPatch(to, actorId, actorRole) {
  if (to === 'INITIAL_REVIEW') return { owner_role: 'coordinator', owner_id: actorRole === 'coordinator' ? actorId : null };
  if (['REPORT_SUBMITTED', 'COMPLETED', 'FOLLOW_UP'].includes(to)) return { owner_role: 'coordinator' };
  return {};
}

// BR-029: every transition recorded. Optimistic lock per Part 8.2 (DEC-011).
export async function transition(caseId, to, { actorId = null, actorRole = 'system', note = null, patientVisible = true, expectedVersion = null } = {}) {
  const { data: c } = await db.from('cases').select().eq('id', caseId).maybeSingle();
  if (!c) throw httpError(404, 'Case not found');
  if (!assertTransition(c.status, to, actorRole)) throw httpError(409, `Invalid transition: ${c.status} -> ${to}`);

  const minutes = await slaMinutes(to);
  const patch = {
    status: to,
    sla_due_at: minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
    sla_alerted: false,
    version: c.version + 1,
    ...ownershipPatch(to, actorId, actorRole)
  };
  if (to === 'CANCELLED') patch.cancel_reason = note;

  const { data: updated } = await db.from('cases').update(patch)
    .eq('id', caseId).eq('version', expectedVersion ?? c.version).select();
  if (!updated?.length) throw httpError(409, 'This case was just updated. Please refresh.');

  await db.from('case_timeline').insert({
    case_id: caseId, from_status: c.status, to_status: to,
    actor_id: actorId, actor_role: actorRole, note,
    patient_visible: patientVisible,
    message_en: LABELS[to]?.en || to, message_ar: LABELS[to]?.ar || to
  });
  await audit(null, 'CASE_STATUS_CHANGE', {
    resourceType: 'case', resourceId: caseId,
    detail: { from: c.status, to, note }, actorId, actorRole
  });
  return updated[0];
}

// F-CASE-01 / BR-001: immutable ALO-YYYY-##### number; SUBMITTED -> INITIAL_REVIEW automatic.
export async function createCase({ patient, service_type, service_subtype, specialty, purpose, reason, history, parent_case_id = null }, req) {
  if (parent_case_id) {
    const { data: parent } = await db.from('cases').select().eq('id', parent_case_id).maybeSingle();
    if (!parent || parent.patient_id !== patient.id) throw httpError(403, 'Forbidden');
    // Part 8.4: no follow-up from cancelled case.
    if (parent.status === 'CANCELLED') throw httpError(409, 'A follow-up cannot be created from a cancelled case. Please start a new service.');
  }
  const { data: num } = await db.rpc('next_case_number');
  const { data: c, error } = await db.from('cases').insert({
    case_number: num, patient_id: patient.id, service_type, service_subtype, specialty, purpose, reason,
    history: history || {}, parent_case_id, status: 'SUBMITTED', owner_role: 'system'
  }).select().single();
  if (error) throw httpError(500, error.message);

  await db.from('case_timeline').insert({
    case_id: c.id, from_status: null, to_status: 'SUBMITTED', actor_id: patient.id, actor_role: 'patient',
    message_en: 'Your case was received.', message_ar: 'تم استلام حالتك.'
  });
  await transition(c.id, 'INITIAL_REVIEW', { actorRole: 'system' });
  await audit(req, 'CASE_CREATED', { resourceType: 'case', resourceId: c.id, detail: { service_type, case_number: c.case_number } });

  // N-01 / N-02 — no PHI in body (BR-017).
  await notify({
    event: service_type === 'GMO' ? 'N-01' : 'N-02', caseId: c.id,
    recipientType: 'patient', recipientId: patient.id,
    title: service_type === 'GMO' ? 'Medical Case Received' : 'Case Received',
    body: `Case ID: ${c.case_number}. Status: Received. Track your case in the AloDoc portal.`
  });
  await notifyCoordinators({
    event: 'CASE_NEW', caseId: c.id, title: 'New case submitted',
    body: `Case ${c.case_number} (${service_type}) is awaiting review.`
  });
  return c;
}

async function attachListExtras(rows) {
  if (!rows.length) return rows;
  const patientIds = [...new Set(rows.map(r => r.patient_id))];
  const caseIds = rows.map(r => r.id);
  const [{ data: patients }, { data: cons }] = await Promise.all([
    db.from('patients').select().in('id', patientIds),
    db.from('consultations').select().in('case_id', caseIds)
  ]);
  const pMap = Object.fromEntries((patients || []).map(p => [p.id, p]));
  const cMap = Object.fromEntries((cons || []).map(c => [c.case_id, c]));
  return rows.map(r => ({
    ...r,
    patients: pMap[r.patient_id] ? { full_name: pMap[r.patient_id].full_name, phone: pMap[r.patient_id].phone } : null,
    consultations: cMap[r.id] ? { scheduled_at: cMap[r.id].scheduled_at, consultation_type: cMap[r.id].consultation_type, doctor_id: cMap[r.id].doctor_id } : null,
    workflow: computeCaseWorkflow(r, 'en')
  }));
}

// Role-scoped listing: BR-003/004/005 (P2 Least Exposure).
// DEC-022: Bible Part 5 defines no completion path for SERVICE cases (Test D4 requires
// "tracked through to completion"). Coordinator/admin may complete an assigned service case.
export async function completeService(caseId, { actorId, actorRole, note = null }) {
  const { data: c } = await db.from('cases').select().eq('id', caseId).maybeSingle();
  if (!c) throw httpError(404, 'Case not found');
  if (c.service_type !== 'SERVICE' || !['SPECIALIST_ASSIGNED', 'IN_PROGRESS'].includes(c.status)) {
    throw httpError(409, 'Service case must be assigned before completion.');
  }
  const { data: updated } = await db.from('cases').update({
    status: 'COMPLETED', sla_due_at: null, sla_alerted: false, version: c.version + 1, owner_role: 'coordinator'
  }).eq('id', caseId).eq('version', c.version).select();
  if (!updated?.length) throw httpError(409, 'This case was just updated. Please refresh.');
  await db.from('case_timeline').insert({
    case_id: caseId, from_status: c.status, to_status: 'COMPLETED', actor_id: actorId, actor_role: actorRole,
    note, message_en: LABELS.COMPLETED.en, message_ar: LABELS.COMPLETED.ar
  });
  await audit(null, 'CASE_STATUS_CHANGE', { resourceType: 'case', resourceId: caseId, detail: { from: c.status, to: 'COMPLETED', note }, actorId, actorRole });
  return updated[0];
}

export async function listCasesForRole(session) {
  if (session.role === 'patient') {
    const { data } = await db.from('cases').select()
      .eq('patient_id', session.sub).order('updated_at', { ascending: false });
    return (data || []).map(c => ({
      ...c,
      workflow: computeCaseWorkflow(c, 'en')
    }));
  }
  if (session.role === 'nurse' || session.role === 'doctor') {
    const { data: assigns } = await db.from('case_assignments').select().eq('staff_id', session.sub);
    const ids = (assigns || []).map(a => a.case_id);
    if (!ids.length) return [];
    const { data } = await db.from('cases').select().in('id', ids).order('updated_at', { ascending: false });
    return attachListExtras(data || []);
  }
  const { data } = await db.from('cases').select().order('updated_at', { ascending: false }).limit(500);
  return attachListExtras(data || []);
}

async function caseBundle(c) {
  const [docs, timeline, assigns, vitals, consultation, review, tokens, rx, patient] = await Promise.all([
    db.from('documents').select().eq('case_id', c.id).eq('is_deleted', false).order('created_at'),
    db.from('case_timeline').select().eq('case_id', c.id).order('created_at'),
    db.from('case_assignments').select().eq('case_id', c.id),
    db.from('vitals').select().eq('case_id', c.id).order('created_at', { ascending: false }),
    db.from('consultations').select().eq('case_id', c.id).maybeSingle(),
    db.from('international_reviews').select().eq('case_id', c.id).maybeSingle(),
    db.from('magic_link_tokens').select().eq('case_id', c.id).order('created_at', { ascending: false }),
    db.from('prescriptions').select().eq('case_id', c.id).order('created_at'),
    db.from('patients').select().eq('id', c.patient_id).maybeSingle()
  ]);
  const staffIds = [...new Set((assigns.data || []).map(a => a.staff_id))];
  let staff = [];
  if (staffIds.length) {
    const { data } = await db.from('staff_users').select().in('id', staffIds);
    staff = data || [];
  }
  return {
    documents: docs.data || [], timeline: timeline.data || [],
    assignments: (assigns.data || []).map(a => ({
      ...a, staff: staff.find(s => s.id === a.staff_id)
        ? { id: a.staff_id, full_name: staff.find(s => s.id === a.staff_id).full_name, role: staff.find(s => s.id === a.staff_id).role, specialty: staff.find(s => s.id === a.staff_id).specialty }
        : null
    })),
    vitals: vitals.data || [], consultation: consultation.data || null,
    review: review.data || null,
    // Never expose token hashes (DEC-015).
    magic_links: (tokens.data || []).map(t => ({
      id: t.id, specialist_name: t.specialist_name, specialist_phone: t.specialist_phone,
      created_at: t.created_at, expires_at: t.expires_at, opened_at: t.opened_at,
      draft_saved_at: t.draft_saved_at, submitted_at: t.submitted_at, revoked_at: t.revoked_at
    })),
    prescriptions: rx.data || [], patient: patient.data || null
  };
}

// BR-016: patient never sees internal terminology. BR-014/015: draft/release gating.
export async function getCaseForRole(c, session, lang = 'en') {
  const b = await caseBundle(c);
  const base = {
    id: c.id, case_number: c.case_number, service_type: c.service_type, service_subtype: c.service_subtype,
    specialty: c.specialty, purpose: c.purpose, reason: c.reason, history: c.history,
    status: c.status, created_at: c.created_at, updated_at: c.updated_at, version: c.version,
    parent_case_id: c.parent_case_id, follow_up_recommended: c.follow_up_recommended, follow_up_note: c.follow_up_note
  };

  if (session.role === 'patient') {
    const released = b.consultation?.released_at || b.review?.released_at;
    const report = b.consultation?.released_at ? b.consultation.final_report
      : b.review?.released_at ? `FINDINGS:\n${b.review.findings}\n\nRECOMMENDATION:\n${b.review.recommendation}` : null;
    // F-MEET-02 / BR-023: patient sees Meet link only inside visibility window.
    let meetUrl = null, joinable = false;
    if (b.consultation?.meet_url && b.consultation.scheduled_at) {
      const { data: setting } = await db.from('system_settings').select().eq('key', 'meet_visibility_hours').maybeSingle();
      const hours = Number(setting?.value || 2);
      const t = new Date(b.consultation.scheduled_at).getTime();
      if (Date.now() >= t - hours * 3600_000) meetUrl = b.consultation.meet_url;
      joinable = Date.now() >= t - 5 * 60_000;
    }
    return {
      ...base,
      status_label: LABELS[c.status]?.[lang] || LABELS[c.status]?.en,
      next_step: NEXT_STEP[c.status]?.[lang] || NEXT_STEP[c.status]?.en,
      timeline: b.timeline.filter(t => t.patient_visible),
      documents: b.documents,
      document_request_note: c.status === 'ADDITIONAL_INFO_REQUIRED' ? c.document_request_note : null,
      payment_confirmed: c.payment_confirmed,
      consultation: b.consultation ? {
        scheduled_at: b.consultation.scheduled_at, consultation_type: b.consultation.consultation_type,
        clinic_name: b.consultation.clinic_name, clinic_address: b.consultation.clinic_address,
        doctor_name: b.assignments.find(a => a.role === 'doctor')?.staff?.full_name || null,
        meet_url: meetUrl, joinable
      } : null,
      report, report_released: !!released,
      prescriptions: released ? b.prescriptions : [],
      can_follow_up: ['COMPLETED', 'FOLLOW_UP'].includes(c.status) || c.follow_up_recommended,
      can_request_service: c.status !== 'CANCELLED',
      workflow: computeCaseWorkflow({ ...c, ...b }, lang)
    };
  }

  // Staff view (nurse / doctor / coordinator / admin)
  const out = {
    ...base, patient: b.patient, documents: b.documents, timeline: b.timeline,
    assignments: b.assignments, vitals: b.vitals, prescriptions: b.prescriptions,
    payment_confirmed: c.payment_confirmed, payment_note: c.payment_note,
    document_request_note: c.document_request_note, intake_completed: c.intake_completed,
    escalated: c.escalated, cancel_reason: c.cancel_reason,
    sla_due_at: c.sla_due_at, owner_id: c.owner_id, owner_role: c.owner_role,
    magic_links: b.magic_links,
    workflow: computeCaseWorkflow({ ...c, ...b }, lang),
    review: session.role === 'nurse' ? null : b.review, // 6.4: nurse has no clinical-report access
    consultation: b.consultation ? {
      ...b.consultation,
      notes_draft: ['doctor', 'coordinator', 'admin'].includes(session.role) ? b.consultation.notes_draft : undefined
    } : null
  };
  // BR-025 / US-ADM-007: admin case access is always logged.
  if (session.role === 'admin') await audit(null, 'ADMIN_CASE_VIEW', { resourceType: 'case', resourceId: c.id, actorId: session.sub, actorRole: 'admin' });
  return out;
}