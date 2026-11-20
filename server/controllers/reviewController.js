// US-INT-001..005 / F-AUTH-04. No login; token validated on every request.
// DEC-016: privacy-minimized payload (age + gender, no name/DOB/phone).
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { verifyToken } from '../services/magicLinkService.js';
import { transition } from '../services/caseService.js';
import { notifyCoordinators } from '../services/notificationService.js';

async function resolve(req) {
  const v = await verifyToken(req.params.token);
  if (!v.ok) {
    // Part 8.1: altered/expired/revoked attempts logged with IP + user agent.
    await audit(req, 'MAGIC_LINK_DENIED', { detail: { reason: v.reason, user_agent: req.get('user-agent') }, actorId: null, actorRole: 'international' });
    throw httpError(403, v.reason); // client maps reason -> friendly screen, no case data
  }
  return v.token;
}

function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

async function reviewPayload(t) {
  const { data: c } = await db.from('cases').select().eq('id', t.case_id).single();
  const { data: p } = await db.from('patients').select().eq('id', c.patient_id).single();
  const { data: docs } = await db.from('documents').select().eq('case_id', c.id).eq('is_deleted', false).order('created_at');
  const { data: review } = await db.from('international_reviews').select().eq('case_id', c.id).maybeSingle();
  return {
    case_number: c.case_number, specialty: c.specialty, purpose: c.purpose,
    reason: c.reason, history: c.history,
    patient_age: ageFrom(p.dob), patient_gender: p.gender,
    documents: (docs || []).map(d => ({ id: d.id, file_name: d.file_name, file_type: d.file_type, category: d.category, created_at: d.created_at })),
    draft: review?.status === 'DRAFT' ? { findings: review.findings, recommendation: review.recommendation } : null,
    submitted: review?.status === 'SUBMITTED',
    expires_at: t.expires_at
  };
}

// US-INT-001: open link; Bible 5.3: SPECIALIST_ASSIGNED -> UNDER_MEDICAL_REVIEW (system).
export const openReview = ah(async (req, res) => {
  const t = await resolve(req);
  if (!t.opened_at) await db.from('magic_link_tokens').update({ opened_at: new Date().toISOString() }).eq('id', t.id);
  const { data: c } = await db.from('cases').select().eq('id', t.case_id).single();
  if (c.status === 'SPECIALIST_ASSIGNED') {
    await transition(t.case_id, 'UNDER_MEDICAL_REVIEW', { actorRole: 'system', note: 'Specialist opened review link' });
  }
  await audit(req, 'MAGIC_LINK_OPENED', { resourceType: 'case', resourceId: t.case_id, detail: { user_agent: req.get('user-agent') }, actorId: null, actorRole: 'international' });
  res.json(await reviewPayload(t));
});

// US-INT-003: server-side draft (resilient to device change; restored on new link per 8.2).
export const saveDraft = ah(async (req, res) => {
  const t = await resolve(req);
  const { findings = '', recommendation = '' } = req.body;
  const { error: draftErr } = await db.from('international_reviews').upsert({
    case_id: t.case_id, findings, recommendation, status: 'DRAFT', updated_at: new Date().toISOString()
  }, { onConflict: 'case_id' });
  if (draftErr) throw httpError(500, draftErr.message);
  await db.from('magic_link_tokens').update({ draft_saved_at: new Date().toISOString() }).eq('id', t.id);
  await notifyCoordinators({ event: 'REVIEW_DRAFT', caseId: t.case_id, title: 'Specialist draft saved', body: 'A draft opinion was saved for a case review.' });
  res.json({ ok: true });
});

// US-INT-004: min 50 chars each field; BR-008 immediate revoke; N-08 coordinator alert.
export const submitReview = ah(async (req, res) => {
  const t = await resolve(req);
  const findings = (req.body.findings || '').trim();
  const recommendation = (req.body.recommendation || '').trim();
  if (findings.length < 50 || recommendation.length < 50) {
    throw httpError(400, 'Clinical findings and final recommendation are required before submitting (minimum 50 characters each).');
  }
  const now = new Date().toISOString();
  const { error: subErr } = await db.from('international_reviews').upsert({
    case_id: t.case_id, findings, recommendation, status: 'SUBMITTED', submitted_at: now, updated_at: now
  }, { onConflict: 'case_id' });
  if (subErr) throw httpError(500, subErr.message);
  await db.from('magic_link_tokens').update({ revoked_at: now, used_at: now, submitted_at: now }).eq('id', t.id);
  const { data: c } = await db.from('cases').select().eq('id', t.case_id).single();
  if (c.status === 'SPECIALIST_ASSIGNED') await transition(t.case_id, 'UNDER_MEDICAL_REVIEW', { actorRole: 'system' });
  if (['SPECIALIST_ASSIGNED', 'UNDER_MEDICAL_REVIEW'].includes(c.status)) {
    await transition(t.case_id, 'REPORT_SUBMITTED', { actorRole: 'international', note: `Opinion by ${t.specialist_name}` });
  }
  await audit(req, 'INTL_REVIEW_SUBMITTED', { resourceType: 'case', resourceId: t.case_id, actorId: null, actorRole: 'international' });
  await notifyCoordinators({ event: 'N-08', caseId: t.case_id, title: 'Review Submitted', body: `Case ${c.case_number}: international specialist submitted the final opinion. Review and release.` });
  res.json({ ok: true });
});

// US-INT-005 / N-07: request more info -> coordinator in-app + email, audited.
export const requestInfo = ah(async (req, res) => {
  const t = await resolve(req);
  const message = (req.body.message || '').trim();
  if (!message) throw httpError(400, 'Please describe what information is needed.');
  await db.from('case_timeline').insert({
    case_id: t.case_id, from_status: null, to_status: null, actor_role: 'international',
    note: `Specialist requests more information: ${message}`, patient_visible: false
  });
  await audit(req, 'INTL_INFO_REQUESTED', { resourceType: 'case', resourceId: t.case_id, detail: { message }, actorId: null, actorRole: 'international' });
  await notifyCoordinators({ event: 'N-07', caseId: t.case_id, title: 'Case Information Needed', body: `Specialist requests: ${message}`, channels: ['in-app', 'email'] });
  res.json({ ok: true });
});

// US-INT-002 AC3: inline document viewing, case-scoped by token (BR-006).
export const reviewDocument = ah(async (req, res) => {
  const t = await resolve(req);
  const { data: doc } = await db.from('documents').select()
    .eq('id', req.params.docId).eq('case_id', t.case_id).eq('is_deleted', false).maybeSingle();
  if (!doc) throw httpError(404, 'Document not found');
  const { data, error } = await db.storage.from('case-documents').download(doc.storage_path);
  if (error) throw httpError(500, 'Could not retrieve file.');
  await audit(req, 'INTL_DOCUMENT_VIEWED', { resourceType: 'case', resourceId: t.case_id, detail: { document_id: doc.id }, actorId: null, actorRole: 'international' });
  res.set('Content-Type', doc.file_type);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(doc.file_name)}"`);
  res.send(Buffer.from(await data.arrayBuffer()));
});