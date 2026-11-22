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
import { requireHospitalMember, requireHospitalRole, requireALOStaff } from './middleware/hospitalAuth.js';
import { loadHospitalCase } from './lib/scope.js';
import * as auth from './controllers/authController.js';
import * as cases from './controllers/caseController.js';
import * as docs from './controllers/documentController.js';
import * as clinical from './controllers/clinicalController.js';
import * as review from './controllers/reviewController.js';
import * as admin from './controllers/adminController.js';
import * as hospAuth from './controllers/hospitalAuthController.js';
import * as hospStaff from './controllers/hospitalStaffController.js';
import * as hospAdmin from './controllers/hospitalAdminController.js';
import * as hospSlots from './controllers/hospitalSlotController.js';
import * as reception from './controllers/receptionController.js';
import * as publicHosp from './controllers/publicHospitalController.js';
import * as hospCase from './controllers/hospitalCaseController.js';
import * as lab from './controllers/labController.js';
import * as pharmacy from './controllers/pharmacyController.js';
import * as caseEnhancements from './controllers/caseEnhancementsController.js';
import * as bridge from './controllers/bridgeController.js';
import { releaseExpiredFreeSlots } from './services/hospitalSlotService.js';
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

// ---- Auth (F-AUTH & DEC-056) ----
api.post('/auth/send-otp', authLimiter, auth.sendOtp);
api.post('/auth/verify-otp', authLimiter, auth.verifyOtp);
api.post('/auth/register', authLimiter, auth.register);
api.post('/auth/staff-login', authLimiter, auth.staffLogin);
api.get('/auth/me', auth.me);
api.patch('/auth/profile', requireRole('patient'), auth.updateProfile);
api.post('/auth/logout', auth.logout);

// ---- Hospital Staff Auth (WhatsApp OTP only — DEC-056) ----
api.post('/auth/staff/otp/send', authLimiter, hospAuth.sendStaffOtp);
api.post('/auth/staff/otp/verify', authLimiter, hospAuth.verifyStaffOtp);
api.post('/auth/choose-role', authLimiter, hospAuth.chooseRole);
api.post('/auth/staff/claim-phone', authLimiter, hospAuth.claimPhone);

// ---- Catalog & settings ----
api.get('/catalog', requireAuth, cases.catalog);
api.get('/settings/public', admin.publicSettings);

// ---- Remote Cases (Part 6 matrix enforced per route) ----
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

// ---- Remote Case Documents (F-CASE-05) ----
api.post('/cases/:id/documents', requireAuth, loadCase, requireCaseAccess, docs.upload.single('file'), docs.uploadDocument);
api.get('/cases/:id/documents/:docId', requireAuth, loadCase, requireCaseAccess, docs.viewDocument);
api.delete('/cases/:id/documents/:docId', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, docs.deleteDocument);

// ---- Remote Clinical Consultations (US-NUR / US-DOC / US-CRD) ----
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

// ---- Remote Magic-link review (no auth; token is the credential) ----
api.get('/review/:token', reviewLimiter, review.openReview);
api.post('/review/:token/draft', reviewLimiter, review.saveDraft);
api.post('/review/:token/submit', reviewLimiter, review.submitReview);
api.post('/review/:token/voice-note', reviewLimiter, review.voiceUpload.single('audio'), review.uploadVoiceNote);
api.post('/review/:token/request-info', reviewLimiter, review.requestInfo);
api.get('/review/:token/documents/:docId', reviewLimiter, review.reviewDocument);

// ---- Case Portal Enhancements (DEC-056: AI Summary, Reports Checklist, Multi-Round Reviews, Final Report) ----
api.post('/cases/:id/ai-summary/generate', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, caseEnhancements.generateAiSummary);
api.put('/cases/:id/ai-summary', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, caseEnhancements.updateAiSummary);
api.post('/cases/:id/ai-summary/approve', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, caseEnhancements.approveAiSummary);

api.post('/cases/:id/reports-requests', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, caseEnhancements.createReportsRequest);
api.get('/cases/:id/reports-requests', requireAuth, loadCase, requireCaseAccess, caseEnhancements.listReportsRequests);
api.patch('/cases/:id/reports-requests/:reqId/item', requireAuth, loadCase, requireCaseAccess, caseEnhancements.updateReportsRequestItem);

api.post('/cases/:id/reviews/dispatch', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, caseEnhancements.dispatchCaseReview);
api.get('/cases/:id/reviews', requireAuth, loadCase, requireCaseAccess, caseEnhancements.listCaseReviews);

api.put('/cases/:id/final-report', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, caseEnhancements.saveFinalReportDraft);
api.post('/cases/:id/final-report/publish', requireRole('coordinator', 'admin'), loadCase, requireCaseAccess, caseEnhancements.publishFinalReport);

// ---- Bridge 1: Online Intake ➔ In-person Clinic (DEC-056) ----
api.post('/cases/:id/refer-to-hospital', requireRole('coordinator', 'admin', 'nurse'), loadCase, requireCaseAccess, bridge.referToHospital);

// ---- ALO Admin (US-ADM) ----
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

// ---- Hospital Tenancy Management (ALO Admin scope — DEC-056) ----
api.get('/admin/hospitals', requireRole('admin'), hospAdmin.listHospitals);
api.post('/admin/hospitals', requireRole('admin'), hospAdmin.createHospital);
api.get('/admin/hospitals/:id', requireRole('admin'), hospAdmin.getHospital);
api.patch('/admin/hospitals/:id', requireRole('admin'), hospAdmin.updateHospital);
api.post('/admin/hospitals/:id/admins', requireRole('admin'), hospAdmin.createHospitalAdmin);
api.post('/admin/staff/:id/release-phone', requireRole('admin'), hospAdmin.releaseStaffPhone);
api.post('/admin/staff/:id/login-link', requireRole('admin'), hospAdmin.issueBreakGlassLink);

// ---- Hospital Staff Management (hospital_admin scope — DEC-056) ----
api.get('/hospital/staff', requireHospitalMember, requireHospitalRole('hospital_admin'), hospStaff.listHospitalStaff);
api.post('/hospital/staff', requireHospitalMember, requireHospitalRole('hospital_admin'), hospStaff.createHospitalStaff);
api.patch('/hospital/staff/:id', requireHospitalMember, requireHospitalRole('hospital_admin'), hospStaff.updateHospitalStaff);
api.patch('/hospital/staff/:id/active', requireHospitalMember, requireHospitalRole('hospital_admin'), hospStaff.toggleHospitalStaffActive);
api.get('/hospital/doctors', requireHospitalMember, hospStaff.listHospitalDoctors);

// ---- Hospital Slots & Templates (DEC-056) ----
api.get('/hospital/slots', requireHospitalMember, hospSlots.listHospitalSlots);
api.post('/hospital/slots/generate', requireHospitalMember, requireHospitalRole('hospital_admin', 'doctor'), hospSlots.triggerSlotGeneration);
api.post('/hospital/slots/:id/block', requireHospitalMember, requireHospitalRole('hospital_admin', 'doctor'), hospSlots.blockSlot);
api.post('/hospital/slots/:id/release', requireHospitalMember, requireHospitalRole('hospital_admin', 'doctor'), hospSlots.releaseSlot);
api.get('/hospital/slot-templates', requireHospitalMember, requireHospitalRole('hospital_admin'), hospSlots.listSlotTemplates);
api.post('/hospital/slot-templates', requireHospitalMember, requireHospitalRole('hospital_admin'), hospSlots.createSlotTemplate);
api.patch('/hospital/slot-templates/:id', requireHospitalMember, requireHospitalRole('hospital_admin'), hospSlots.updateSlotTemplate);

// ---- Hospital Reception & Check-in (DEC-056) ----
api.get('/hospital/reception/queue', requireHospitalMember, requireHospitalRole('reception', 'hospital_admin', 'doctor'), reception.getReceptionQueue);
api.post('/hospital/reception/checkin', requireHospitalMember, requireHospitalRole('reception', 'hospital_admin'), reception.checkinPatient);
api.post('/hospital/reception/arrival', requireHospitalMember, requireHospitalRole('reception', 'hospital_admin'), reception.updateArrivalStatus);
api.get('/hospital/appointment-requests', requireHospitalMember, requireHospitalRole('reception', 'hospital_admin'), reception.listAppointmentRequests);
api.post('/hospital/appointment-requests/:id/decision', requireHospitalMember, requireHospitalRole('reception', 'hospital_admin'), reception.makeAppointmentDecision);

// ---- Hospital Patients & Clinic Cases (DEC-056) ----
api.get('/hospital/patients', requireHospitalMember, hospCase.listHospitalPatients);
api.post('/hospital/patients', requireHospitalMember, requireHospitalRole('reception', 'doctor', 'hospital_admin'), hospCase.createHospitalPatient);
api.get('/hospital/cases', requireHospitalMember, hospCase.listHospitalCases);
api.post('/hospital/cases', requireHospitalMember, requireHospitalRole('reception', 'doctor', 'hospital_admin'), hospCase.createHospitalCase);
api.get('/hospital/cases/:id', requireHospitalMember, hospCase.getHospitalCaseDetail);
api.post('/hospital/cases/:id/opinion', requireHospitalMember, requireHospitalRole('doctor', 'hospital_admin'), hospCase.saveDoctorOpinion);
api.post('/hospital/cases/:id/documents', requireHospitalMember, hospCase.upload.single('file'), hospCase.uploadHospitalDocument);
api.post('/hospital/cases/:id/intl-opinion', requireHospitalMember, requireHospitalRole('doctor', 'hospital_admin'), loadHospitalCase, bridge.requestIntlOpinion);

// ---- Hospital Lab Module (DEC-056) ----
api.get('/hospital/test-catalogue', requireHospitalMember, lab.listTestCatalogue);
api.post('/hospital/test-catalogue', requireHospitalMember, requireHospitalRole('lab', 'hospital_admin'), lab.createTestCatalogueItem);
api.get('/hospital/lab/tests', requireHospitalMember, lab.listLabTests);
api.post('/hospital/lab/tests', requireHospitalMember, requireHospitalRole('doctor', 'hospital_admin'), lab.requestLabTest);
api.patch('/hospital/lab/tests/:id/status', requireHospitalMember, requireHospitalRole('lab', 'hospital_admin'), lab.updateLabTestStatus);
api.post('/hospital/lab/tests/:id/results', requireHospitalMember, requireHospitalRole('lab', 'hospital_admin'), lab.submitLabResults);
api.post('/hospital/lab/tests/:id/comments', requireHospitalMember, lab.addLabComment);

// ---- Hospital Pharmacy Module (DEC-056) ----
api.get('/hospital/pharmacy/queue', requireHospitalMember, requireHospitalRole('pharmacy', 'hospital_admin'), pharmacy.getPharmacyQueue);
api.post('/hospital/cases/:id/medications', requireHospitalMember, requireHospitalRole('doctor', 'hospital_admin'), pharmacy.prescribeMedication);
api.post('/hospital/pharmacy/medications/:id/dispense', requireHospitalMember, requireHospitalRole('pharmacy', 'hospital_admin'), pharmacy.dispenseMedication);

// ---- Public Kiosk, Screens & Patient Status (DEC-056 — no session required) ----
api.get('/public/kiosk/:pin', publicHosp.getKioskConfig);
api.post('/public/kiosk/:pin/checkin', publicHosp.kioskCheckin);
api.get('/public/case/:code', publicHosp.getPublicCaseStatus);
api.get('/public/screen/:pin/waiting', publicHosp.getWaitingScreenFeed);
api.get('/public/reports-request/:token', reviewLimiter, caseEnhancements.getPublicReportsRequest);
api.post('/public/reports-request/:token/upload', reviewLimiter, docs.upload.single('file'), caseEnhancements.uploadPublicReportsRequest);

// ---- Bridge 2: Saudi Hospital ➔ Global Specialist Second Opinion (DEC-056) ----
api.get('/staff/intl-opinions', requireAuth, requireRole('coordinator', 'admin'), requireALOStaff, bridge.listIntlOpinionsForStaff);
api.post('/staff/intl-opinions/:id/dispatch', requireRole('coordinator', 'admin'), requireALOStaff, bridge.dispatchIntlOpinion);
api.get('/staff/intl-specialists', requireAuth, requireRole('coordinator', 'admin'), requireALOStaff, bridge.listSpecialistDirectory);
api.post('/staff/intl-specialists', requireRole('coordinator', 'admin'), requireALOStaff, bridge.createSpecialistDirectoryItem);

api.get('/review/intl/:token', reviewLimiter, bridge.openIntlReview);
api.post('/review/intl/:token/submit', reviewLimiter, bridge.submitIntlReview);

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
  res.status(status).json({
    error: err.message || 'Internal server error',
    code: err.code || undefined,
    message_ar: err.message_ar || undefined
  });
});

// DEC-054: demo staff/test-patient seeding REMOVED. Supabase is the single source of
// truth, so known-password demo accounts (DEC-017/DEC-039/DEC-044) must never be written
// to it. First admin: scripts/create-admin.mjs (first-user-only). Everyone else: the
// authenticated, audited Admin console (US-ADM-001).

// ---- Background jobs: N-12 SLA breach, N-10 T-24h reminder, auto IN_PROGRESS, slot release sweep ----
let lastWaCategoryCheck = 0; // DEC-052: template category drift check (every 6h)
let lastSlotSweep = 0;       // DEC-056: hourly slot release sweep
async function tick() {
  try {
    const nowIso = new Date().toISOString();
    // 1. N-12: SLA breach alert (every tick)
    const { data: overdue } = await db.from('cases').select().eq('status', 'WAITING_FOR_REPORT').lt('sla_due_at', nowIso).eq('sla_alerted', false);
    for (const c of overdue || []) {
      await db.from('cases').update({ sla_alerted: true }).eq('id', c.id);
      await notifyCoordinators({
        event: 'SLA_BREACH', caseId: c.id, title: 'Case overdue',
        body: `Case ${c.case_number} has breached its SLA deadline. Immediate action required.`,
        channels: ['in-app', 'whatsapp']
      });
    }

    // 2. N-10: Appointment 24h reminder
    const tomorrowStart = new Date(Date.now() + 23 * 3600_000).toISOString();
    const tomorrowEnd = new Date(Date.now() + 25 * 3600_000).toISOString();
    const { data: upcoming } = await db.from('consultations').select()
      .gte('scheduled_at', tomorrowStart).lte('scheduled_at', tomorrowEnd).eq('reminder_sent', false);
    for (const con of upcoming || []) {
      await db.from('consultations').update({ reminder_sent: true }).eq('id', con.id);
      await notify({
        recipientType: 'patient', caseId: con.case_id, event: 'APPT_REMINDER_24H',
        title: 'Appointment tomorrow', body: `Your consultation is scheduled for tomorrow at ${con.scheduled_at}.`,
        channels: ['in-app', 'whatsapp']
      });
    }

    // 3. Auto-transition: APPOINTMENT_SCHEDULED -> IN_PROGRESS when scheduled time arrives
    const { data: dueAppts } = await db.from('consultations').select().lte('scheduled_at', nowIso);
    for (const con of dueAppts || []) {
      const { data: c } = await db.from('cases').select().eq('id', con.case_id).maybeSingle();
      if (c && c.status === 'APPOINTMENT_SCHEDULED') {
        try { await transition(c.id, 'IN_PROGRESS', { actorRole: 'system', note: 'Auto-started at scheduled appointment time.' }); }
        catch (e) { /* ignore concurrent */ }
      }
    }

    // 4. DEC-052: Template category drift watch (every 6h, enabled channels only)
    if (Date.now() - lastWaCategoryCheck > 6 * 3600_000) {
      lastWaCategoryCheck = Date.now();
      const waCfg = await getWhatsAppConfig();
      if (waCfg.otpEnabled || waCfg.notifyEnabled) {
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

    // 5. DEC-056: Hourly slot release sweep (free slots within 24 hours -> released)
    if (Date.now() - lastSlotSweep > 3600_000) {
      lastSlotSweep = Date.now();
      try {
        const released = await releaseExpiredFreeSlots();
        if (released.released > 0) {
          console.log(`[Slot Sweep] Released ${released.released} expired free slot(s).`);
        }
      } catch (err) {
        console.error('[Slot Sweep error]:', err.message);
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

export default app;
