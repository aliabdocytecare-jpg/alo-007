// DEC-016 / DEC-056: International & Specialist Magic-Link Review Controller
// Mobile-first specialist review with 4-box opinion schema, decision chips, voice notes & round diffing
import crypto from 'crypto';
import multer from 'multer';
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { verifyToken, hashToken } from '../services/magicLinkService.js';
import { transition } from '../services/caseService.js';
import { notifyCoordinators } from '../services/notificationService.js';

export const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max voice note
});

async function resolve(req) {
  const rawToken = req.params.token;
  if (!rawToken || rawToken.length !== 48) {
    throw httpError(403, 'invalid');
  }

  const tokenH = hashToken(rawToken);

  // 1. Check enhanced case_reviews table first
  const { data: rev } = await db
    .from('case_reviews')
    .select('*')
    .eq('magic_token_hash', tokenH)
    .maybeSingle();

  if (rev) {
    if (rev.status === 'revoked') {
      await audit(req, 'MAGIC_LINK_DENIED', { detail: { reason: 'revoked' }, actorRole: 'specialist' });
      throw httpError(403, 'revoked');
    }
    if (rev.token_expires_at && new Date(rev.token_expires_at).getTime() < Date.now()) {
      await audit(req, 'MAGIC_LINK_DENIED', { detail: { reason: 'expired' }, actorRole: 'specialist' });
      throw httpError(403, 'expired');
    }
    return {
      ...rev,
      isCaseReview: true,
      case_id: rev.case_id,
      specialist_name: rev.specialist_name,
      expires_at: rev.token_expires_at
    };
  }

  // 2. Fall back to classic magic_link_tokens table
  const v = await verifyToken(rawToken);
  if (!v.ok) {
    await audit(req, 'MAGIC_LINK_DENIED', { detail: { reason: v.reason, user_agent: req.get('user-agent') }, actorId: null, actorRole: 'international' });
    throw httpError(403, v.reason);
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

  // Fetch submitted previous rounds for "Then vs. Now" diffing
  const { data: prevRounds } = await db
    .from('case_reviews')
    .select(`
      id, round_number, specialist_name, request_type, request_note,
      decision_chips, clinical_findings, diagnostic_assessment, recommendations,
      follow_up_guidance, voice_note_path, submitted_at, case_snapshot
    `)
    .eq('case_id', c.id)
    .eq('status', 'submitted')
    .order('round_number', { ascending: true });

  const { data: legacyReview } = await db.from('international_reviews').select().eq('case_id', c.id).maybeSingle();

  const isCaseReview = !!t.isCaseReview;
  const findings = isCaseReview ? (t.clinical_findings || '') : (legacyReview?.findings || '');
  const rec = isCaseReview ? (t.recommendations || '') : (legacyReview?.recommendation || '');

  return {
    case_number: c.case_number,
    specialty: c.specialty,
    purpose: c.purpose,
    reason: c.reason,
    history: c.history,
    patient_age: ageFrom(p?.dob),
    patient_gender: p?.gender,
    documents: (docs || []).map(d => ({
      id: d.id,
      file_name: d.file_name,
      file_type: d.file_type,
      category: d.category,
      created_at: d.created_at
    })),

    // Enhanced Multi-Round & Decision Chips Context:
    round_number: isCaseReview ? t.round_number : 1,
    request_type: isCaseReview ? t.request_type : 'fresh_case',
    request_note: isCaseReview ? t.request_note : null,
    case_snapshot: isCaseReview ? t.case_snapshot : null,
    decision_chips: isCaseReview ? (t.decision_chips || {}) : {},
    clinical_findings: findings,
    diagnostic_assessment: isCaseReview ? (t.diagnostic_assessment || '') : '',
    recommendations: rec,
    follow_up_guidance: isCaseReview ? (t.follow_up_guidance || '') : '',
    voice_note_path: isCaseReview ? t.voice_note_path : null,
    previous_rounds: prevRounds || [],

    // Legacy draft/submitted format for existing UI
    draft: (isCaseReview ? (t.status === 'pending') : (legacyReview?.status === 'DRAFT'))
      ? {
          findings,
          recommendation: rec,
          diagnostic_assessment: isCaseReview ? (t.diagnostic_assessment || '') : '',
          follow_up_guidance: isCaseReview ? (t.follow_up_guidance || '') : '',
          decision_chips: isCaseReview ? (t.decision_chips || {}) : {},
          voice_note_path: isCaseReview ? t.voice_note_path : null
        }
      : null,
    submitted: isCaseReview ? (t.status === 'submitted') : (legacyReview?.status === 'SUBMITTED'),
    expires_at: t.expires_at || t.token_expires_at
  };
}

// US-INT-001: open review link; transitions to UNDER_MEDICAL_REVIEW
export const openReview = ah(async (req, res) => {
  const t = await resolve(req);
  const now = new Date().toISOString();

  if (t.isCaseReview) {
    if (!t.opened_at) {
      await db.from('case_reviews').update({ opened_at: now }).eq('id', t.id);
    }
  } else {
    if (!t.opened_at) {
      await db.from('magic_link_tokens').update({ opened_at: now }).eq('id', t.id);
    }
  }

  const { data: c } = await db.from('cases').select().eq('id', t.case_id).single();
  if (c.status === 'SPECIALIST_ASSIGNED') {
    await transition(t.case_id, 'UNDER_MEDICAL_REVIEW', {
      actorRole: 'system',
      note: `Specialist Dr. ${t.specialist_name || 'Doctor'} opened review link`
    });
  }

  await audit(req, 'MAGIC_LINK_OPENED', {
    resourceType: 'case',
    resourceId: t.case_id,
    detail: { user_agent: req.get('user-agent'), round: t.round_number || 1 },
    actorId: null,
    actorRole: 'specialist'
  });

  res.json(await reviewPayload(t));
});

// US-INT-003: Save draft (4-box opinion schema, decision chips, voice note)
export const saveDraft = ah(async (req, res) => {
  const t = await resolve(req);
  const {
    findings = '',
    recommendation = '',
    clinical_findings,
    diagnostic_assessment = '',
    recommendations,
    follow_up_guidance = '',
    decision_chips = {},
    opinion_ar = null
  } = req.body;

  const resolvedFindings = clinical_findings !== undefined ? clinical_findings : findings;
  const resolvedRecs = recommendations !== undefined ? recommendations : recommendation;
  const now = new Date().toISOString();

  if (t.isCaseReview) {
    await db.from('case_reviews').update({
      clinical_findings: resolvedFindings,
      diagnostic_assessment,
      recommendations: resolvedRecs,
      follow_up_guidance,
      decision_chips,
      opinion_ar: opinion_ar || t.opinion_ar,
      updated_at: now
    }).eq('id', t.id);
  }

  // Also maintain international_reviews for legacy sync
  await db.from('international_reviews').upsert({
    case_id: t.case_id,
    findings: resolvedFindings,
    recommendation: resolvedRecs,
    status: 'DRAFT',
    updated_at: now
  }, { onConflict: 'case_id' });

  if (!t.isCaseReview) {
    await db.from('magic_link_tokens').update({ draft_saved_at: now }).eq('id', t.id);
  }

  await notifyCoordinators({
    event: 'REVIEW_DRAFT',
    caseId: t.case_id,
    title: 'Specialist draft saved',
    body: `Dr. ${t.specialist_name || 'Specialist'} saved a draft opinion for case review.`
  });

  res.json({ ok: true });
});

// Mobile voice note upload pipeline
export const uploadVoiceNote = ah(async (req, res) => {
  const t = await resolve(req);
  if (!req.file) throw httpError(400, 'Audio file is required');

  const mime = req.file.mimetype || 'audio/webm';
  const ext = (req.file.originalname.split('.').pop() || 'webm').toLowerCase();
  const filePath = `voice-notes/${t.case_id}/${t.id || Date.now()}-${Date.now()}.${ext}`;

  const { error: upErr } = await db.storage
    .from('case-documents')
    .upload(filePath, req.file.buffer, { contentType: mime, upsert: true });

  if (upErr) throw httpError(500, `Audio storage failed: ${upErr.message}`);

  if (t.isCaseReview) {
    await db.from('case_reviews').update({
      voice_note_path: filePath,
      updated_at: new Date().toISOString()
    }).eq('id', t.id);
  }

  await audit(req, 'VOICE_NOTE_UPLOADED', {
    resourceType: 'case',
    resourceId: t.case_id,
    detail: { file_path: filePath, size: req.file.size }
  });

  res.json({ ok: true, voice_note_path: filePath });
});

// US-INT-004: Submit review opinion
export const submitReview = ah(async (req, res) => {
  const t = await resolve(req);
  const {
    findings = '',
    recommendation = '',
    clinical_findings,
    diagnostic_assessment = '',
    recommendations,
    follow_up_guidance = '',
    decision_chips = {},
    voice_note_path,
    opinion_ar = null
  } = req.body;

  const resolvedFindings = (clinical_findings !== undefined ? clinical_findings : findings).trim();
  const resolvedRecs = (recommendations !== undefined ? recommendations : recommendation).trim();
  const activeVoiceNote = voice_note_path || t.voice_note_path;

  // Validation: either 50 chars each for findings + recommendations, OR active voice note with summary
  const hasMinText = resolvedFindings.length >= 50 && resolvedRecs.length >= 50;
  const hasVoiceWithNote = !!activeVoiceNote && resolvedFindings.length >= 20;

  if (!hasMinText && !hasVoiceWithNote) {
    throw httpError(400, 'Clinical findings and recommendations are required (minimum 50 characters each, or minimum 20 characters with a voice note).');
  }

  const now = new Date().toISOString();

  if (t.isCaseReview) {
    const { error: revErr } = await db.from('case_reviews').update({
      clinical_findings: resolvedFindings,
      diagnostic_assessment,
      recommendations: resolvedRecs,
      follow_up_guidance,
      decision_chips,
      opinion_ar: opinion_ar || t.opinion_ar,
      voice_note_path: activeVoiceNote,
      status: 'submitted',
      submitted_at: now,
      updated_at: now
    }).eq('id', t.id);

    if (revErr) throw httpError(500, revErr.message);
  }

  // Also maintain international_reviews
  await db.from('international_reviews').upsert({
    case_id: t.case_id,
    findings: resolvedFindings,
    recommendation: resolvedRecs,
    status: 'SUBMITTED',
    submitted_at: now,
    updated_at: now
  }, { onConflict: 'case_id' });

  // Invalidate magic token
  await db.from('magic_link_tokens').update({
    revoked_at: now,
    used_at: now,
    submitted_at: now
  }).eq('case_id', t.case_id);

  const { data: c } = await db.from('cases').select().eq('id', t.case_id).single();
  if (c.status === 'SPECIALIST_ASSIGNED') {
    await transition(t.case_id, 'UNDER_MEDICAL_REVIEW', { actorRole: 'system' });
  }
  if (['SPECIALIST_ASSIGNED', 'UNDER_MEDICAL_REVIEW'].includes(c.status)) {
    await transition(t.case_id, 'REPORT_SUBMITTED', {
      actorRole: 'international',
      note: `Opinion submitted by Dr. ${t.specialist_name || 'Specialist'}`
    });
  }

  await audit(req, 'INTL_REVIEW_SUBMITTED', {
    resourceType: 'case',
    resourceId: t.case_id,
    detail: { round: t.round_number || 1, has_voice: !!activeVoiceNote },
    actorId: null,
    actorRole: 'specialist'
  });

  await notifyCoordinators({
    event: 'N-08',
    caseId: t.case_id,
    title: 'Review Submitted',
    body: `Case ${c.case_number}: Dr. ${t.specialist_name || 'Specialist'} submitted the consultation opinion. Review and release.`
  });

  res.json({ ok: true });
});

// US-INT-005: Request additional information from coordinator
export const requestInfo = ah(async (req, res) => {
  const t = await resolve(req);
  const message = (req.body.message || '').trim();
  if (!message) throw httpError(400, 'Please describe what information is needed.');

  await db.from('case_timeline').insert({
    case_id: t.case_id,
    from_status: null,
    to_status: null,
    actor_role: 'international',
    note: `Specialist Dr. ${t.specialist_name || 'Doctor'} requests more information: ${message}`,
    patient_visible: false
  });

  await audit(req, 'INTL_INFO_REQUESTED', {
    resourceType: 'case',
    resourceId: t.case_id,
    detail: { message },
    actorId: null,
    actorRole: 'specialist'
  });

  await notifyCoordinators({
    event: 'N-07',
    caseId: t.case_id,
    title: 'Case Information Needed',
    body: `Dr. ${t.specialist_name || 'Specialist'} requests: ${message}`,
    channels: ['in-app', 'email']
  });

  res.json({ ok: true });
});

// Inline document viewing
export const reviewDocument = ah(async (req, res) => {
  const t = await resolve(req);
  const { data: doc } = await db
    .from('documents')
    .select()
    .eq('id', req.params.docId)
    .eq('case_id', t.case_id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (!doc) throw httpError(404, 'Document not found');

  const { data, error } = await db.storage.from('case-documents').download(doc.storage_path);
  if (error) throw httpError(500, 'Could not retrieve file.');

  await audit(req, 'INTL_DOCUMENT_VIEWED', {
    resourceType: 'case',
    resourceId: t.case_id,
    detail: { document_id: doc.id },
    actorId: null,
    actorRole: 'specialist'
  });

  res.set('Content-Type', doc.file_type);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(doc.file_name)}"`);
  res.send(Buffer.from(await data.arrayBuffer()));
});
