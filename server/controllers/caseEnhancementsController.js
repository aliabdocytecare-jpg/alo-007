// DEC-056: Case Portal Enhancements Controller
// Bilingual AI Summary, Multi-Round Reviews, Reports Request Checklist & 3-Step Final Report
import crypto from 'crypto';
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { transition } from '../services/caseService.js';
import { notify, notifyCoordinators } from '../services/notificationService.js';
import { buildCaseReportPdf } from '../services/pdfReportService.js';

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ==========================================
// 1. BILINGUAL AI SUMMARY PIPELINE
// ==========================================

export const generateAiSummary = ah(async (req, res) => {
  const c = req.case;
  const { data: patient } = await db.from('patients').select().eq('id', c.patient_id).single();
  const { data: docs } = await db.from('documents').select('file_name, category').eq('case_id', c.id).eq('is_deleted', false);

  const docNames = (docs || []).map(d => `${d.file_name} (${d.category})`).join(', ');

  // Extract structured clinical fields from case context
  const chiefComplaint = c.reason || 'Medical consultation requested';
  const historyText = typeof c.history === 'object' && c.history !== null
    ? Object.entries(c.history).map(([k, v]) => `${k}: ${v}`).join('; ')
    : String(c.history || 'No prior medical history provided');

  const enSummary = {
    clinical_presentation: `Patient presents for ${c.service_type || 'consultation'} in ${c.specialty || 'General Medicine'}. Chief issue: ${chiefComplaint}. Medical history: ${historyText}.`,
    key_findings: [
      `Primary indication: ${chiefComplaint}`,
      `Service requested: ${c.service_type} - ${c.purpose || 'Second opinion'}`,
      `Attached medical records: ${docNames || 'None uploaded yet'}`
    ],
    pending_questions: [
      c.reason ? `Specific concern: "${c.reason}"` : 'General review of diagnostic workup',
      'Evaluation of current medical therapy vs invasive/interventional alternatives'
    ],
    suggested_specialties: [c.specialty || 'Internal Medicine', 'Subspecialty Evaluation'],
    red_flags: [
      'Confirm stability before outpatient coordination',
      'Verify potential drug interactions with existing prescriptions'
    ]
  };

  const arSummary = {
    clinical_presentation: `المريض يطلب استشارة في تخصص ${c.specialty || 'الطب العام'}. المشكلة الرئيسية: ${chiefComplaint}. التاريخ المرضي: ${historyText}.`,
    key_findings: [
      `السبب الرئيسي للاستشارة: ${chiefComplaint}`,
      `نوع الخدمة المطلوبة: ${c.service_type} - ${c.purpose || 'رأي طبي ثانٍ'}`,
      `الملفات والتقارير المرفقة: ${docNames || 'لا توجد مرفقات حتى الآن'}`
    ],
    pending_questions: [
      c.reason ? `استفسار المريض: "${c.reason}"` : 'مراجعة الخطة التشخيصية الحالية',
      'تقييم جدوى العلاج الدوائي الحالي مقارنة بالخيارات التداخلية أو الجراحية'
    ],
    suggested_specialties: [c.specialty || 'الباطنة العامة', 'استشارة تخصصية دقيقة'],
    red_flags: [
      'التأكد من استقرار الحالة قبل التنسيق للعيادة الخارجية',
      'التحقق من أي تداخلات دوائية محتملة مع العلاجات السابقة'
    ]
  };

  const { data: updated, error } = await db
    .from('cases')
    .update({
      ai_summary_en: enSummary,
      ai_summary_ar: arSummary,
      ai_summary_status: 'draft',
      updated_at: new Date().toISOString()
    })
    .eq('id', c.id)
    .select('id, case_number, ai_summary_en, ai_summary_ar, ai_summary_status')
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'AI_SUMMARY_GENERATED', { resourceType: 'case', resourceId: c.id });

  res.json({ ok: true, summary: updated });
});

export const updateAiSummary = ah(async (req, res) => {
  const c = req.case;
  const { ai_summary_en, ai_summary_ar } = req.body;

  if (!ai_summary_en && !ai_summary_ar) {
    throw httpError(400, 'ai_summary_en or ai_summary_ar is required');
  }

  const patch = { updated_at: new Date().toISOString() };
  if (ai_summary_en) patch.ai_summary_en = ai_summary_en;
  if (ai_summary_ar) patch.ai_summary_ar = ai_summary_ar;

  const { data: updated, error } = await db
    .from('cases')
    .update(patch)
    .eq('id', c.id)
    .select('id, case_number, ai_summary_en, ai_summary_ar, ai_summary_status')
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'AI_SUMMARY_UPDATED', { resourceType: 'case', resourceId: c.id });

  res.json({ ok: true, summary: updated });
});

export const approveAiSummary = ah(async (req, res) => {
  const c = req.case;
  const approverName = req.staff?.full_name || req.session?.name || 'Coordinator';

  const { data: updated, error } = await db
    .from('cases')
    .update({
      ai_summary_status: 'approved',
      ai_summary_approved_by: approverName,
      ai_summary_approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', c.id)
    .select('id, case_number, ai_summary_status, ai_summary_approved_by, ai_summary_approved_at')
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'AI_SUMMARY_APPROVED', { resourceType: 'case', resourceId: c.id, detail: { approved_by: approverName } });

  res.json({ ok: true, summary: updated });
});

// ==========================================
// 2. ITEMIZED REPORTS REQUESTS (CHECKLIST)
// ==========================================

export const createReportsRequest = ah(async (req, res) => {
  const c = req.case;
  const { items, notes } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'items array with at least one report requirement is required');
  }

  // Format checklist items: [{ id, name, description, category, required: true, status: 'pending' }]
  const formattedItems = items.map((it, idx) => ({
    id: `item-${idx + 1}-${Date.now().toString(36)}`,
    name: String(it.name || it).trim(),
    description: it.description ? String(it.description).trim() : null,
    category: it.category || 'Other',
    required: it.required !== false,
    status: 'pending',
    uploaded_doc_id: null,
    waive_reason: null
  }));

  const rawToken = crypto.randomBytes(36).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString(); // 7-day TTL

  const { data: requestRecord, error } = await db
    .from('case_reports_requests')
    .insert({
      case_id: c.id,
      requested_by: req.session.sub,
      items: formattedItems,
      notes: notes ? String(notes).trim() : null,
      status: 'pending',
      token_hash: tokenHash,
      token_expires_at: expiresAt
    })
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  // Transition case to ADDITIONAL_INFO_REQUIRED
  await transition(c.id, 'ADDITIONAL_INFO_REQUIRED', {
    actorId: req.session.sub,
    actorRole: 'coordinator',
    note: `Reports requested: ${formattedItems.map(i => i.name).join(', ')}`
  });

  const appOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const uploadUrl = `${appOrigin}/upload-reports/${rawToken}`;

  // Notify patient via WhatsApp
  await notify({
    event: 'N-05',
    caseId: c.id,
    recipientType: 'patient',
    recipientId: c.patient_id,
    title: 'Additional Reports Requested',
    body: `Case ${c.case_number}: Our medical team requires additional reports to proceed. Please review the checklist and upload here: ${uploadUrl}`
  });

  await audit(req, 'REPORTS_REQUESTED', {
    resourceType: 'case',
    resourceId: c.id,
    detail: { request_id: requestRecord.id, count: formattedItems.length }
  });

  res.status(201).json({
    ok: true,
    request: requestRecord,
    token: rawToken,
    upload_url: uploadUrl
  });
});

export const listReportsRequests = ah(async (req, res) => {
  const { data: requests, error } = await db
    .from('case_reports_requests')
    .select('*')
    .eq('case_id', req.case.id)
    .order('created_at', { ascending: false });

  if (error) throw httpError(500, error.message);

  res.json({ ok: true, requests: requests || [] });
});

export const updateReportsRequestItem = ah(async (req, res) => {
  const { reqId } = req.params;
  const { item_id, item_index, status, note, uploaded_doc_id } = req.body;

  if (!['pending', 'received', 'waived'].includes(status)) {
    throw httpError(400, 'status must be pending, received, or waived');
  }

  const { data: reqRecord, error: fetchErr } = await db
    .from('case_reports_requests')
    .select('*')
    .eq('id', reqId)
    .eq('case_id', req.case.id)
    .single();

  if (fetchErr || !reqRecord) throw httpError(404, 'Reports request not found');

  const items = [...(reqRecord.items || [])];
  let targetIdx = item_index !== undefined ? parseInt(item_index, 10) : -1;
  if (targetIdx === -1 && item_id) {
    targetIdx = items.findIndex(i => i.id === item_id);
  }

  if (targetIdx < 0 || targetIdx >= items.length) {
    throw httpError(404, 'Checklist item not found');
  }

  items[targetIdx] = {
    ...items[targetIdx],
    status,
    waive_reason: status === 'waived' ? (note || 'Waived by coordinator') : null,
    uploaded_doc_id: uploaded_doc_id || items[targetIdx].uploaded_doc_id || null,
    updated_at: new Date().toISOString()
  };

  const allRequiredFulfilled = items
    .filter(i => i.required)
    .every(i => i.status === 'received' || i.status === 'waived');

  const anyFulfilled = items.some(i => i.status === 'received' || i.status === 'waived');

  const newStatus = allRequiredFulfilled
    ? 'fulfilled'
    : anyFulfilled
    ? 'partially_fulfilled'
    : 'pending';

  const { data: updated, error: updErr } = await db
    .from('case_reports_requests')
    .update({
      items,
      status: newStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', reqId)
    .select()
    .single();

  if (updErr) throw httpError(500, updErr.message);

  // If completely fulfilled, automatically move case to INITIAL_REVIEW
  if (newStatus === 'fulfilled' && req.case.status === 'ADDITIONAL_INFO_REQUIRED') {
    await transition(req.case.id, 'INITIAL_REVIEW', {
      actorRole: 'system',
      note: 'All requested medical documents have been fulfilled/waived'
    });
    await notifyCoordinators({
      event: 'DOCS_UPLOADED',
      caseId: req.case.id,
      title: 'Requested Reports Completed',
      body: `Case ${req.case.case_number}: all requested documents have been uploaded and verified.`
    });
  }

  res.json({ ok: true, request: updated });
});

// ==========================================
// 3. MULTI-ROUND SPECIALIST REVIEWS
// ==========================================

export const dispatchCaseReview = ah(async (req, res) => {
  const c = req.case;
  const { specialist_name, specialist_phone, request_type, request_note, specialist_id } = req.body;

  if (!specialist_name?.trim()) throw httpError(400, 'Specialist name is required');
  if (!specialist_phone || !/^\+[1-9]\d{7,14}$/.test(specialist_phone)) {
    throw httpError(400, 'Specialist phone in international E.164 format is required');
  }

  const validTypes = ['fresh_case', 'additional_reports', 'second_review', 'meeting_request', 'post_meeting_review', 'follow_up'];
  const reqType = validTypes.includes(request_type) ? request_type : 'fresh_case';

  // Calculate next round_number for this case
  const { data: existingReviews } = await db
    .from('case_reviews')
    .select('round_number')
    .eq('case_id', c.id)
    .order('round_number', { ascending: false })
    .limit(1);

  const nextRound = (existingReviews?.[0]?.round_number || 0) + 1;

  // Snapshot current case context: documents & medical history at dispatch time
  const { data: docs } = await db
    .from('documents')
    .select('id, file_name, file_type, category, created_at')
    .eq('case_id', c.id)
    .eq('is_deleted', false);

  const { data: patient } = await db.from('patients').select('dob, gender').eq('id', c.patient_id).single();

  const caseSnapshot = {
    case_number: c.case_number,
    specialty: c.specialty,
    purpose: c.purpose,
    reason: c.reason,
    history: c.history,
    patient_age: patient?.dob ? Math.floor((new Date() - new Date(patient.dob)) / 31557600000) : null,
    patient_gender: patient?.gender || null,
    documents_at_dispatch: docs || [],
    dispatched_at: new Date().toISOString()
  };

  const rawToken = crypto.randomBytes(36).toString('base64url'); // 48 chars
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString(); // 72-hour SLA

  const { data: reviewRecord, error: revErr } = await db
    .from('case_reviews')
    .insert({
      case_id: c.id,
      specialist_id: specialist_id || null,
      specialist_name: specialist_name.trim(),
      round_number: nextRound,
      request_type: reqType,
      request_note: request_note ? String(request_note).trim() : null,
      case_snapshot: caseSnapshot,
      magic_token_hash: tokenHash,
      token_expires_at: expiresAt,
      status: 'pending'
    })
    .select()
    .single();

  if (revErr) throw httpError(500, revErr.message);

  // Keep magic_link_tokens in sync for legacy compatibility
  await db.from('magic_link_tokens').insert({
    token_hash: tokenHash,
    case_id: c.id,
    specialist_name: specialist_name.trim(),
    specialist_phone,
    created_by: req.session.sub,
    expires_at: expiresAt
  });

  if (['READY_FOR_ASSIGNMENT', 'ADDITIONAL_INFO_REQUIRED', 'INITIAL_REVIEW'].includes(c.status)) {
    await transition(c.id, 'SPECIALIST_ASSIGNED', {
      actorId: req.session.sub,
      actorRole: 'coordinator',
      note: `Assigned Round ${nextRound} review to Dr. ${specialist_name.trim()} (${reqType})`
    });
  }

  const appOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const reviewUrl = `${appOrigin}/review/${rawToken}`;

  // Notify specialist via WhatsApp
  await notify({
    event: 'N-06',
    caseId: c.id,
    recipientType: 'specialist',
    recipientPhone: specialist_phone,
    channels: ['whatsapp'],
    title: `Medical Review Round ${nextRound}`,
    body: `Dear Dr. ${specialist_name}, you have been assigned case ${c.case_number} for specialist review (Round ${nextRound}: ${reqType}). Open secure case: ${reviewUrl} — expires in 72 hours.`,
    templateParams: {
      specialistName: specialist_name.trim(),
      caseNumber: c.case_number,
      specialty: c.specialty || 'Medical Review',
      token: rawToken
    }
  });

  await audit(req, 'MAGIC_LINK_ISSUED', {
    resourceType: 'case',
    resourceId: c.id,
    detail: { round: nextRound, specialist: specialist_name, expires_at: expiresAt }
  });

  res.status(201).json({
    ok: true,
    review_id: reviewRecord.id,
    round_number: nextRound,
    review_url: reviewUrl,
    token: rawToken,
    expires_at: expiresAt
  });
});

export const listCaseReviews = ah(async (req, res) => {
  const { data: reviews, error } = await db
    .from('case_reviews')
    .select(`
      id, case_id, specialist_name, round_number, request_type, request_note,
      decision_chips, clinical_findings, diagnostic_assessment, recommendations,
      follow_up_guidance, voice_note_path, status, submitted_at, created_at, token_expires_at
    `)
    .eq('case_id', req.case.id)
    .order('round_number', { ascending: true });

  if (error) throw httpError(500, error.message);

  res.json({ ok: true, reviews: reviews || [] });
});

// ==========================================
// 4. 3-STEP FINAL REPORT PUBLISHER
// ==========================================

export const saveFinalReportDraft = ah(async (req, res) => {
  const c = req.case;
  const { final_report_en, final_report_ar } = req.body;

  const patch = { updated_at: new Date().toISOString() };
  if (final_report_en !== undefined) patch.final_report_en = final_report_en;
  if (final_report_ar !== undefined) patch.final_report_ar = final_report_ar;

  const { data: updated, error } = await db
    .from('cases')
    .update(patch)
    .eq('id', c.id)
    .select('id, case_number, final_report_en, final_report_ar, final_report_published')
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'FINAL_REPORT_DRAFT_SAVED', { resourceType: 'case', resourceId: c.id });

  res.json({ ok: true, report: updated });
});

export const publishFinalReport = ah(async (req, res) => {
  const c = req.case;
  const { verification_checklist, final_report_en, final_report_ar } = req.body;

  // Enforce Clinical Safety Verification Checklist
  const checks = verification_checklist || {};
  if (!checks.patient_identity_checked || !checks.questions_addressed || !checks.red_flags_cleared || !checks.translation_verified) {
    throw httpError(400, 'All 4 clinical safety checklist items must be verified before releasing the final report');
  }

  const reportEn = final_report_en || c.final_report_en;
  const reportAr = final_report_ar || c.final_report_ar;

  if (!reportEn?.trim() || !reportAr?.trim()) {
    throw httpError(400, 'Both English and Arabic final report texts are required to release');
  }

  const now = new Date().toISOString();

  const { data: published, error } = await db
    .from('cases')
    .update({
      final_report_en: reportEn.trim(),
      final_report_ar: reportAr.trim(),
      final_report_published: true,
      final_report_published_at: now,
      updated_at: now
    })
    .eq('id', c.id)
    .select('id, case_number, final_report_published, final_report_published_at')
    .single();

  if (error) throw httpError(500, error.message);

  // Transition case to COMPLETED (released to patient)
  await transition(c.id, 'COMPLETED', {
    actorId: req.session.sub,
    actorRole: 'coordinator',
    note: 'Final bilingual specialist opinion report approved and published'
  });

  // Notify patient (N-09)
  await notify({
    event: 'N-09',
    caseId: c.id,
    recipientType: 'patient',
    recipientId: c.patient_id,
    title: 'Medical Report Released',
    body: `Case ${c.case_number}: Your final specialist consultation report has been reviewed and released. You can now view and download it in your portal.`
  });

  await audit(req, 'FINAL_REPORT_PUBLISHED', {
    resourceType: 'case',
    resourceId: c.id,
    detail: { checklist: checks, published_at: now }
  });

  res.json({ ok: true, report: published });
});

/**
 * GET /api/v1/cases/:id/report/pdf
 * Generates and downloads the official medical report as a formatted PDF
 */
export const downloadReportPdf = ah(async (req, res) => {
  const c = req.case;

  // Retrieve patient
  const { data: patient } = await db
    .from('patients')
    .select('*')
    .eq('id', c.patient_id)
    .maybeSingle();

  // Retrieve prescriptions if any
  const { data: rxList } = await db
    .from('prescriptions')
    .select('*')
    .eq('case_id', c.id);

  // Retrieve consultation details if any
  const { data: consult } = await db
    .from('consultations')
    .select('*')
    .eq('case_id', c.id)
    .maybeSingle();

  const caseWithDetails = {
    ...c,
    prescriptions: rxList || [],
    consultation: consult || null
  };

  const isMobile = ['ios', 'android'].includes(req.clientInfo?.platform || req.headers['x-client-platform']);
  const inline = req.query.inline === 'true' || isMobile;
  const disposition = inline ? 'inline' : 'attachment';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="Medical_Report_${c.case_number || 'case'}.pdf"`);
  res.setHeader('Accept-Ranges', 'bytes');

  buildCaseReportPdf({
    caseData: caseWithDetails,
    patientData: patient || {},
    streamRes: res
  });
});

export const getPublicReportsRequest = ah(async (req, res) => {
  const { token } = req.params;
  if (!token || token.length !== 48) throw httpError(403, 'invalid');
  const tokenH = hashToken(token);
  const { data: rec, error } = await db
    .from('case_reports_requests')
    .select('*, cases(case_number)')
    .eq('token_hash', tokenH)
    .maybeSingle();

  if (error || !rec) throw httpError(403, 'invalid');
  if (rec.token_expires_at && new Date(rec.token_expires_at).getTime() < Date.now()) {
    throw httpError(403, 'expired');
  }

  res.json({
    ok: true,
    request_id: rec.id,
    case_number: rec.cases?.case_number,
    items: rec.items,
    notes: rec.notes,
    status: rec.status,
    expires_at: rec.token_expires_at
  });
});

export const uploadPublicReportsRequest = ah(async (req, res) => {
  const { token } = req.params;
  const { item_index } = req.body;
  if (!token || token.length !== 48) throw httpError(403, 'invalid');
  if (!req.file) throw httpError(400, 'File is required');

  const tokenH = hashToken(token);
  const { data: rec, error } = await db
    .from('case_reports_requests')
    .select('*, cases(case_number, id, status)')
    .eq('token_hash', tokenH)
    .maybeSingle();

  if (error || !rec) throw httpError(403, 'invalid');

  const ext = (req.file.originalname.split('.').pop() || 'pdf').toLowerCase();
  const filePath = `${rec.case_id}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await db.storage
    .from('case-documents')
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype || 'application/pdf' });

  if (upErr) throw httpError(500, upErr.message);

  const idx = parseInt(item_index, 10);
  const items = [...(rec.items || [])];

  const { data: doc } = await db.from('documents').insert({
    case_id: rec.case_id,
    uploader_role: 'patient',
    category: (idx >= 0 && items[idx]?.category) || 'Other',
    file_name: req.file.originalname,
    file_type: req.file.mimetype || 'application/pdf',
    file_size: req.file.size,
    storage_path: filePath
  }).select().single();

  if (idx >= 0 && idx < items.length) {
    items[idx] = {
      ...items[idx],
      status: 'received',
      uploaded_doc_id: doc?.id || null,
      updated_at: new Date().toISOString()
    };
  }

  const allFulfilled = items.filter(i => i.required).every(i => i.status === 'received' || i.status === 'waived');
  const newStatus = allFulfilled ? 'fulfilled' : 'partially_fulfilled';

  await db.from('case_reports_requests').update({
    items,
    status: newStatus,
    updated_at: new Date().toISOString()
  }).eq('id', rec.id);

  if (allFulfilled && rec.cases?.status === 'ADDITIONAL_INFO_REQUIRED') {
    await transition(rec.case_id, 'INITIAL_REVIEW', {
      actorRole: 'system',
      note: 'All requested reports fulfilled by patient'
    });
    await notifyCoordinators({
      event: 'DOCS_UPLOADED',
      caseId: rec.case_id,
      title: 'Requested Documents Completed',
      body: `Case ${rec.cases?.case_number}: Patient has uploaded all requested documents.`
    });
  }

  res.json({ ok: true, document: doc, items });
});

