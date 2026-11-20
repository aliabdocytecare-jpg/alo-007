// F-CASE-05 / BR-013 / Part 8.2 file edge cases. Storage via driver (DEC-003).
import multer from 'multer';
import crypto from 'crypto';
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { transition } from '../services/caseService.js';
import { notifyCoordinators } from '../services/notificationService.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const ALLOWED = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

export const uploadDocument = ah(async (req, res) => {
  const c = req.case;
  const role = req.session.role;
  // 6.3: patient own case; nurse/coordinator assigned cases only (access already guarded).
  if (!['patient', 'nurse', 'coordinator'].includes(role)) throw httpError(403, 'Forbidden');
  if (!req.file) throw httpError(400, 'No file received.');
  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  if (!ALLOWED[ext]) throw httpError(400, 'File type not supported. Please upload PDF, JPG, PNG, or DOCX.');

  const { data: existing } = await db.from('documents').select().eq('case_id', c.id).eq('is_deleted', false);
  const total = (existing || []).reduce((s, d) => s + Number(d.file_size || 0), 0);
  if (total + req.file.size > 500 * 1024 * 1024) throw httpError(400, 'This case has reached the 500MB document limit.');

  const path = `${c.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from('case-documents').upload(path, req.file.buffer, { contentType: ALLOWED[ext] });
  if (upErr) throw httpError(500, `Storage upload failed: ${upErr.message}`);

  const { data: doc, error } = await db.from('documents').insert({
    case_id: c.id, uploader_id: req.session.sub, uploader_role: role,
    category: req.body.category || 'Other',
    file_name: req.file.originalname, file_type: ALLOWED[ext], file_size: req.file.size, storage_path: path
  }).select().single();
  if (error) throw httpError(500, error.message);
  await audit(req, 'DOCUMENT_UPLOADED', { resourceType: 'case', resourceId: c.id, detail: { file_name: doc.file_name, category: doc.category } });

  // Bible 5.3: patient uploads requested docs -> system returns case to INITIAL_REVIEW.
  if (role === 'patient' && c.status === 'ADDITIONAL_INFO_REQUIRED') {
    await transition(c.id, 'INITIAL_REVIEW', { actorRole: 'system', note: 'Patient uploaded requested documents' });
    await notifyCoordinators({ event: 'DOCS_UPLOADED', caseId: c.id, title: 'Requested documents uploaded', body: `Case ${c.case_number}: patient uploaded requested documents. Ready for review.` });
  }
  res.status(201).json(doc);
});

// Access logged for every view (F-CASE-05, BR-025, Test E10).
export const viewDocument = ah(async (req, res) => {
  const { data: doc } = await db.from('documents').select()
    .eq('id', req.params.docId).eq('case_id', req.case.id).eq('is_deleted', false).maybeSingle();
  if (!doc) throw httpError(404, 'Document not found');
  const { data, error } = await db.storage.from('case-documents').download(doc.storage_path);
  if (error) throw httpError(500, 'Could not retrieve file.');
  await audit(req, 'DOCUMENT_VIEWED', { resourceType: 'case', resourceId: req.case.id, detail: { document_id: doc.id, file_name: doc.file_name } });
  res.set('Content-Type', doc.file_type);
  const inline = ['application/pdf', 'image/jpeg', 'image/png'].includes(doc.file_type);
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.file_name)}"`);
  res.send(Buffer.from(await data.arrayBuffer()));
});

// BR-013: soft delete only; physical removal is a separate admin action (deferred, audited).
export const deleteDocument = ah(async (req, res) => {
  const { data: doc } = await db.from('documents').select().eq('id', req.params.docId).eq('case_id', req.case.id).maybeSingle();
  if (!doc) throw httpError(404, 'Document not found');
  await db.from('documents').update({ is_deleted: true }).eq('id', doc.id);
  await audit(req, 'DOCUMENT_SOFT_DELETED', { resourceType: 'case', resourceId: req.case.id, detail: { document_id: doc.id } });
  res.json({ ok: true });
});