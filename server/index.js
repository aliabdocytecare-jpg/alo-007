// AloDoc API — Blueprint §2 middleware pipeline:
// Helmet/CORS -> Rate limit -> Session resolver -> RBAC guard -> Controller.
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './config/db.js';
import { resolveSession, requireAuth, requireRole, loadCase, requireCaseAccess } from './middleware/auth.js';
import * as auth from './controllers/authController.js';
import * as cases from './controllers/caseController.js';
import * as docs from './controllers/documentController.js';
import * as clinical from './controllers/clinicalController.js';
import * as review from './controllers/reviewController.js';
import * as admin from './controllers/adminController.js';
import { transition } from './services/caseService.js';
import { notify, notifyCoordinators, notifyAdmins } from './services/notificationService.js';
import { getWhatsAppConfig, whatsappMode, checkTemplateDrift } from './services/whatsappService.js';
import { TERMINAL } from './services/stateMachine.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.set('trust proxy', 1); // Nginx/Traefik reverse proxy (Blueprint §6)
// DEC-049: CSP tuned so the same-origin React SPA works (inline styles/scripts, self API/PDF).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"]
    }
  }
}));
// DEC-047: CLIENT_ORIGIN may be comma-separated to allow dev + production frontends.
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: clientOrigins.length === 1 ? clientOrigins[0] : clientOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(resolveSession);

const api = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 60, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false }); // DEC-026: count failed attempts only (brute force); OTP lockout + resend caps remain account-level defenses
const reviewLimiter = rateLimit({ windowMs: 10 * 60_000, max: 30, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false }); // Test E9: only failed/abusive attempts count (DEC-024)

// ---- Auth (F-AUTH) ----
api.post('/auth/send-otp', authLimiter, auth.sendOtp);
api.post('/auth/verify-otp', authLimiter, auth.verifyOtp);
api.post('/auth/register', authLimiter, auth.register);
api.post('/auth/staff-login', authLimiter, auth.staffLogin);
api.get('/auth/me', auth.me);
api.patch('/auth/profile', requireRole('patient'), auth.updateProfile);
api.post('/auth/logout', auth.logout);

// ---- Catalog & settings ----
api.get('/catalog', requireAuth, cases.catalog);
api.get('/settings/public', admin.publicSettings);

// ---- Cases (Part 6 matrix enforced per route) ----
api.get('/cases', requireAuth, cases.listCases);
api.post('/cases', requireRole('patient'), cases.create);
api.get('/cases/:id', requireAuth, loadCase, requireCaseAccess, cases.getOne);
api.patch('/cases/:id/status', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, cases.patchStatus);
api.post('/cases/:id/confirm-payment', requireRole('coordinator'), loadCase, requireCaseAccess, cases.confirmPayment);
api.post('/cases/:id/request-documents', requireRole('coordinator'), loadCase, requireCaseAccess, cases.requestDocuments);
api.post('/cases/:id/assign', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, cases.assign);
api.post('/cases/:id/revoke-link', requireRole('coordinator'), loadCase, requireCaseAccess, cases.revokeLink);
api.post('/cases/:id/cancel', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, cases.cancel);
api.post('/cases/:id/escalate', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, cases.escalate);
api.get('/staff/directory', requireRole('coordinator', 'admin'), cases.staffDirectory);

// ---- Documents (F-CASE-05) ----
api.post('/cases/:id/documents', requireAuth, loadCase, requireCaseAccess, docs.upload.single('file'), docs.uploadDocument);
api.get('/cases/:id/documents/:docId', requireAuth, loadCase, requireCaseAccess, docs.viewDocument);
api.delete('/cases/:id/documents/:docId', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, docs.deleteDocument);

// ---- Clinical (US-NUR / US-DOC / US-CRD) ----
api.post('/cases/:id/vitals', requireRole('nurse'), loadCase, requireCaseAccess, clinical.saveVitals);
api.post('/cases/:id/intake-complete', requireRole('nurse'), loadCase, requireCaseAccess, clinical.completeIntake);
api.post('/cases/:id/schedule', requireRole('coordinator'), loadCase, requireCaseAccess, clinical.schedule);
api.patch('/cases/:id/meet-link', requireRole('coordinator'), loadCase, requireCaseAccess, clinical.setMeetLink);
api.post('/cases/:id/start', requireRole('doctor'), loadCase, requireCaseAccess, clinical.startConsultation);
api.post('/cases/:id/notes', requireRole('doctor'), loadCase, requireCaseAccess, clinical.saveNotes);
api.post('/cases/:id/report', requireRole('doctor'), loadCase, requireCaseAccess, clinical.submitReport);
api.post('/cases/:id/release', requireRole('coordinator'), loadCase, requireCaseAccess, clinical.releaseReport);
api.get('/cases/:id/parent-context', requireAuth, loadCase, requireCaseAccess, clinical.parentContext);
api.get('/formulary', requireRole('doctor', 'coordinator', 'admin'), clinical.listFormulary);
api.post('/cases/:id/prescriptions', requireRole('doctor'), loadCase, requireCaseAccess, clinical.addPrescription);

// ---- Magic-link review (no auth; token is the credential) ----
api.get('/review/:token', reviewLimiter, review.openReview);
api.post('/review/:token/draft', reviewLimiter, review.saveDraft);
api.post('/review/:token/submit', reviewLimiter, review.submitReview);
api.post('/review/:token/request-info', reviewLimiter, review.requestInfo);
api.get('/review/:token/documents/:docId', reviewLimiter, review.reviewDocument);

// ---- Admin (US-ADM) ----
api.get('/admin/staff', requireRole('admin'), admin.listStaff);
api.post('/admin/staff', requireRole('admin'), admin.createStaff);
api.patch('/admin/staff/:id/active', requireRole('admin'), admin.setStaffActive);
api.get('/admin/formulary', requireRole('admin'), admin.listFormularyAdmin);
api.post('/admin/formulary', requireRole('admin'), admin.createDrug);
api.patch('/admin/formulary/:id', requireRole('admin'), admin.updateDrug);
api.get('/admin/services', requireRole('admin'), admin.listServices);
api.patch('/admin/services/:id', requireRole('admin'), admin.updateService);
api.get('/admin/sla', requireRole('admin'), admin.listSla);
api.patch('/admin/sla/:status', requireRole('admin'), admin.updateSla);
// DEC-051: WhatsApp provider config — admin-only, sending OFF by default.
api.get('/admin/settings/whatsapp', requireRole('admin'), admin.getWhatsAppSettings);
api.patch('/admin/settings/whatsapp', requireRole('admin'), admin.updateWhatsAppSettings);
api.get('/admin/settings/whatsapp/templates', requireRole('admin'), admin.listWhatsAppTemplates);
api.post('/admin/settings/whatsapp/test', requireRole('admin'), admin.testWhatsApp);
api.get('/admin/audit-logs', requireRole('admin'), admin.listAudit);

// ---- Notifications (all roles) ----
api.get('/notifications', requireAuth, admin.listNotifications);
api.post('/notifications/:id/read', requireAuth, admin.readNotification);

app.use('/api/v1', api);
app.get('/health', (req, res) => res.json({ ok: true, driver: 'supabase' }));

// DEC-049: same-origin hosting (Option A) — serve the built React client + SPA fallback.
// Active only when a build exists (production/Docker); in dev, Vite serves the UI on :5173.
const staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(path.join(staticDir, 'index.html'))) {
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next(); // unknown API paths still 404 as JSON
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// Error handler: multer size limit + typed http errors.
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File exceeds the 50MB limit. Please compress the file or upload a smaller version.' });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// DEC-054: demo staff/test-patient seeding REMOVED. Supabase is the single source of
// truth, so known-password demo accounts (DEC-017/DEC-039/DEC-044) must never be written
// to it. First admin: scripts/create-admin.mjs (first-user-only). Everyone else: the
// authenticated, audited Admin console (US-ADM-001).

// ---- Background jobs: N-12 SLA breach, N-10 T-24h reminder, auto IN_PROGRESS ----
let lastWaCategoryCheck = 0; // DEC-052: template category drift check (every 6h)
async function tick() {
  try {
    const nowIso = new Date().toISOString();
    const { data: due } = await db.from('cases').select().lt('sla_due_at', nowIso).eq('sla_alerted', false);
    for (const c of (due || []).filter(x => !TERMINAL.includes(x.status))) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(c.sla_due_at).getTime()) / 60_000));
      await notifyCoordinators({ event: 'N-12', caseId: c.id, title: 'Case Requires Attention', body: `Case ${c.case_number} is ${mins} minute(s) past its target response time. Current status: ${c.status}.`, channels: ['in-app', 'email'] });
      await notifyAdmins({ event: 'N-12', caseId: c.id, title: 'SLA breach', body: `Case ${c.case_number} breached SLA (${c.status}).`, channels: ['in-app'] });
      await db.from('cases').update({ sla_alerted: true }).eq('id', c.id);
    }

    const { data: cons } = await db.from('consultations').select().eq('reminder_sent', false);
    for (const con of cons || []) {
      if (!con.scheduled_at) continue;
      const { data: c } = await db.from('cases').select().eq('id', con.case_id).maybeSingle();
      if (!c || c.status !== 'APPOINTMENT_SCHEDULED') continue;
      const t = new Date(con.scheduled_at).getTime();
      if (t > Date.now() && t - Date.now() <= 24 * 3600_000) {
        await notify({ event: 'N-10', caseId: con.case_id, recipientType: 'patient', recipientId: c.patient_id, title: 'Appointment Reminder', body: `Reminder: your appointment for case ${c.case_number} is at ${new Date(con.scheduled_at).toLocaleString()}.${con.meet_url ? ' Join: ' + con.meet_url : ''}` });
        await db.from('consultations').update({ reminder_sent: true }).eq('id', con.id);
      }
      if (t <= Date.now()) {
        await transition(con.case_id, 'IN_PROGRESS', { actorRole: 'system', note: 'Appointment start time reached' });
      }
    }

    // DEC-052: Meta can re-categorise an approved template to MARKETING with no
    // advance notice. Re-check the configured templates and alert admins in-app.
    if (Date.now() - lastWaCategoryCheck >= 6 * 3600_000) {
      lastWaCategoryCheck = Date.now();
      const waCfg = await getWhatsAppConfig();
      if (whatsappMode(waCfg, 'otp') === 'live' || whatsappMode(waCfg, 'notify') === 'live') {
        const drift = await checkTemplateDrift(waCfg);
        if (drift.length) {
          await notifyAdmins({
            event: 'WA_CATEGORY_DRIFT', title: 'WhatsApp template category changed',
            body: `Cost policy allows AUTHENTICATION/UTILITY only. ${drift.map(d => `${d.name} [${d.lang}]: ${d.issue} (expected ${d.expected})`).join('; ')}. Review Admin > WhatsApp.`,
            channels: ['in-app']
          });
        }
      }
    }
  } catch (e) { console.error('job tick error:', e.message); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`AloDoc API on http://localhost:${PORT} (database: Supabase — single source of truth, DEC-054)`);
  const { count } = await db.from('staff_users').select('*', { count: 'exact', head: true });
  if (!count) console.log('No staff yet. Bootstrap the first admin: node scripts/create-admin.mjs');
  setInterval(tick, 60_000);
  tick();
});