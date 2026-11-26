// Admin domain — US-ADM-001..007, BR-018/022/026/030. Plus notifications for all roles.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db, MOCK_WHATSAPP } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { sendStaffActivationEmail } from '../services/mailService.js';
import { getWhatsAppConfig, whatsappMode, isConfigured, sendOtpTemplate, listTemplates, validateConfiguredTemplates } from '../services/whatsappService.js';

const PW_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/; // F-AUTH-03 policy
const WA_ID_RE = /^\d{5,30}$/;
const WA_VERSION_RE = /^v\d{1,4}\.\d{1,2}$/;
const WA_TEMPLATE_RE = /^[a-z0-9_]{1,512}$/i;
const WA_LANG_RE = /^[a-z]{2}(_[A-Z]{2})?$/;

export const listStaff = ah(async (req, res) => {
  const { data } = await db.from('staff_users').select().order('created_at');
  res.json((data || []).map(({ password_hash, ...s }) => s));
});

// DEC-067: Staff account creation via secure invitation email (Option A - Industry Best Practice)
export const createStaff = ah(async (req, res) => {
  const { full_name, role, email, phone, specialty } = req.body;
  if (!full_name?.trim() || !email?.trim()) throw httpError(400, 'Full name and email are required.', 'INVALID_INPUT');
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw httpError(400, 'Enter a valid email address.', 'INVALID_EMAIL');
  if (!['nurse', 'coordinator', 'doctor', 'admin'].includes(role)) throw httpError(400, 'Invalid staff role.', 'INVALID_ROLE');

  // Check for duplicate staff email
  const { data: existing } = await db.from('staff_users').select('id, email, email_verified').eq('email', cleanEmail).maybeSingle();
  if (existing) {
    throw httpError(409, 'A staff account with this email already exists.', 'EMAIL_EXISTS');
  }

  // Generate 32-byte cryptographic token (24-hour expiration)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  const { data, error } = await db.from('staff_users').insert({
    full_name: full_name.trim(),
    role,
    email: cleanEmail,
    phone: phone?.trim() || null,
    specialty: specialty || null,
    password_hash: 'PENDING_ACTIVATION',
    email_verified: false,
    activation_token_hash: tokenHash,
    activation_expires_at: expiresAt,
    is_active: true
  }).select().single();

  if (error) throw httpError(500, error.message);

  // Send invitation email via SMTP
  try {
    await sendStaffActivationEmail({
      to: cleanEmail,
      fullName: full_name.trim(),
      role,
      token: rawToken
    });
  } catch (mailErr) {
    console.error('[MailService] Failed to send activation email:', mailErr.message);
  }

  await audit(req, 'STAFF_INVITED', { resourceType: 'staff', resourceId: data.id, detail: { role, email: data.email } });
  const { password_hash, activation_token_hash, ...safe } = data;
  res.status(201).json(safe);
});

// Resend staff invitation email
export const resendStaffInvite = ah(async (req, res) => {
  const { id } = req.params;
  const { data: s } = await db.from('staff_users').select().eq('id', id).maybeSingle();
  if (!s) throw httpError(404, 'Staff account not found.', 'STAFF_NOT_FOUND');
  if (s.email_verified) throw httpError(400, 'This staff account is already verified and active.', 'ALREADY_VERIFIED');

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  const { error } = await db.from('staff_users').update({
    activation_token_hash: tokenHash,
    activation_expires_at: expiresAt
  }).eq('id', id);

  if (error) throw httpError(500, error.message);

  try {
    await sendStaffActivationEmail({
      to: s.email,
      fullName: s.full_name,
      role: s.role,
      token: rawToken
    });
  } catch (mailErr) {
    console.error('[MailService] Failed to resend activation email:', mailErr.message);
    throw httpError(500, `Failed to send email: ${mailErr.message}`);
  }

  await audit(req, 'STAFF_INVITE_RESENT', { resourceType: 'staff', resourceId: id, detail: { email: s.email } });
  res.json({ ok: true, message: `Activation invitation resent to ${s.email}` });
});

// DEC-067: Permanently delete a staff account from database
export const deleteStaff = ah(async (req, res) => {
  const { id } = req.params;
  if (id === req.session.sub) {
    throw httpError(400, 'Cannot delete your own admin account (lockout protection).', 'CANNOT_DELETE_SELF');
  }

  const { data: target } = await db.from('staff_users').select('id, email, full_name, role').eq('id', id).maybeSingle();
  if (!target) throw httpError(404, 'Staff member not found.', 'STAFF_NOT_FOUND');

  // Lockout protection: Never delete the last active admin
  if (target.role === 'admin') {
    const { data: admins } = await db.from('staff_users').select('id').eq('role', 'admin');
    const otherAdmins = (admins || []).filter(a => a.id !== id);
    if (otherAdmins.length === 0) {
      throw httpError(409, 'Cannot delete the last admin account on the platform.', 'LAST_ADMIN');
    }
  }

  // Clean up references and assignments
  await db.from('case_assignments').delete().eq('staff_id', id);
  await db.from('cases').update({ owner_id: null, owner_role: null }).eq('owner_id', id);
  await db.from('notifications').delete().eq('recipient_id', id);

  const { error } = await db.from('staff_users').delete().eq('id', id);
  if (error) {
    // If foreign key constraint is violated (e.g. historical legal clinical notes)
    if (error.code === '23503') {
      throw httpError(409, 'This staff member is linked to historical medical records and cannot be permanently deleted. Please use Deactivate instead.', 'STAFF_HAS_RECORDS');
    }
    throw httpError(500, error.message);
  }

  await audit(req, 'STAFF_DELETED', { resourceType: 'staff', resourceId: id, detail: { email: target.email, full_name: target.full_name } });
  res.json({ ok: true, message: `Staff member ${target.full_name} (${target.email}) was permanently deleted.` });
});

// US-ADM-001 AC3: deactivate without deleting.
export const setStaffActive = ah(async (req, res) => {
  const { is_active } = req.body;
  // DEC-045: lockout protection — never deactivate the last active admin.
  if (!is_active) {
    const { data: target } = await db.from('staff_users').select().eq('id', req.params.id).maybeSingle();
    if (target?.role === 'admin' && target.is_active) {
      const { data: admins } = await db.from('staff_users').select().eq('role', 'admin');
      const otherActive = (admins || []).filter(a => a.is_active && a.id !== req.params.id);
      if (otherActive.length === 0) throw httpError(409, 'Cannot deactivate the last active admin (lockout protection).');
    }
  }
  await db.from('staff_users').update({ is_active: !!is_active }).eq('id', req.params.id);
  await audit(req, is_active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED', { resourceType: 'staff', resourceId: req.params.id });
  res.json({ ok: true });
});

export const listFormularyAdmin = ah(async (req, res) => {
  const { data } = await db.from('drug_formulary').select().order('generic_name');
  res.json(data || []);
});

export const createDrug = ah(async (req, res) => {
  const { generic_name, brand_name, common_dosages, route } = req.body;
  if (!generic_name?.trim()) throw httpError(400, 'Generic name is required.');
  const { data, error } = await db.from('drug_formulary').insert({
    generic_name: generic_name.trim(), brand_name: brand_name || null,
    common_dosages: common_dosages || [], route: route || null
  }).select().single();
  if (error) throw httpError(500, error.message);
  await audit(req, 'FORMULARY_ADDED', { resourceType: 'drug', resourceId: data.id });
  res.status(201).json(data);
});

// BR-022: deactivation hides drug immediately; existing prescriptions untouched.
export const updateDrug = ah(async (req, res) => {
  const patch = {};
  for (const k of ['generic_name', 'brand_name', 'common_dosages', 'route', 'is_active']) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  await db.from('drug_formulary').update(patch).eq('id', req.params.id);
  await audit(req, 'FORMULARY_UPDATED', { resourceType: 'drug', resourceId: req.params.id, detail: patch });
  res.json({ ok: true });
});

// DEC-069: Permanently delete a drug from formulary
export const deleteDrug = ah(async (req, res) => {
  const { id } = req.params;
  const { data: drug } = await db.from('drug_formulary').select('id, generic_name, brand_name').eq('id', id).maybeSingle();
  if (!drug) throw httpError(404, 'Drug not found in formulary.', 'DRUG_NOT_FOUND');

  const { error } = await db.from('drug_formulary').delete().eq('id', id);
  if (error) throw httpError(500, error.message);

  await audit(req, 'FORMULARY_DELETED', { resourceType: 'drug', resourceId: id, detail: { generic_name: drug.generic_name, brand_name: drug.brand_name } });
  res.json({ ok: true, message: `Drug "${drug.generic_name}" was permanently deleted.` });
});

export const listServices = ah(async (req, res) => {
  const { data } = await db.from('services').select().order('name_en');
  res.json(data || []);
});

// US-ADM-003 / BR-026: catalog toggles incl. Coming Soon.
export const updateService = ah(async (req, res) => {
  const patch = {};
  if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
  if (req.body.coming_soon !== undefined) patch.coming_soon = !!req.body.coming_soon;
  await db.from('services').update(patch).eq('id', req.params.id);
  await audit(req, 'SERVICE_UPDATED', { resourceType: 'service', resourceId: req.params.id, detail: patch });
  res.json({ ok: true });
});

// DEC-066: Medical Specialties Management (Admin CRUD + public active directory)
export const listSpecialtiesAdmin = ah(async (req, res) => {
  const { data } = await db.from('specialties').select().order('name_en');
  res.json(data || []);
});

export const listPublicSpecialties = ah(async (req, res) => {
  const { data } = await db.from('specialties').select().eq('is_active', true).order('name_en');
  res.json(data || []);
});

export const createSpecialty = ah(async (req, res) => {
  const { name_en, name_ar } = req.body;
  if (!name_en?.trim() || !name_ar?.trim()) {
    throw httpError(400, 'Both English and Arabic specialty names are required.', 'INVALID_SPECIALTY');
  }
  const cleanEn = name_en.trim();
  const cleanAr = name_ar.trim();
  const { data: existing } = await db.from('specialties').select('id').ilike('name_en', cleanEn).maybeSingle();
  if (existing) {
    throw httpError(409, 'Specialty with this English name already exists.', 'DUPLICATE_SPECIALTY');
  }
  const { data, error } = await db.from('specialties').insert({
    name_en: cleanEn,
    name_ar: cleanAr,
    is_active: true
  }).select().single();
  if (error) throw httpError(500, error.message);
  await audit(req, 'SPECIALTY_CREATED', { resourceType: 'specialty', resourceId: data.id, detail: { name_en: cleanEn, name_ar: cleanAr } });
  res.status(201).json({ ok: true, specialty: data });
});

export const updateSpecialty = ah(async (req, res) => {
  const patch = {};
  if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
  if (req.body.name_en?.trim()) patch.name_en = req.body.name_en.trim();
  if (req.body.name_ar?.trim()) patch.name_ar = req.body.name_ar.trim();
  if (Object.keys(patch).length === 0) throw httpError(400, 'No updates provided');
  const { error } = await db.from('specialties').update(patch).eq('id', req.params.id);
  if (error) throw httpError(500, error.message);
  await audit(req, 'SPECIALTY_UPDATED', { resourceType: 'specialty', resourceId: req.params.id, detail: patch });
  res.json({ ok: true });
});

export const listSla = ah(async (req, res) => {
  const { data } = await db.from('sla_config').select().order('status');
  res.json(data || []);
});

// US-ADM-005: changes audited; apply to cases entering the status afterwards.
export const updateSla = ah(async (req, res) => {
  const minutes = Number(req.body.target_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) throw httpError(400, 'Target minutes must be a positive number.');
  await db.from('sla_config').update({ target_minutes: minutes, updated_by: req.session.sub, updated_at: new Date().toISOString() }).eq('status', req.params.status);
  await audit(req, 'SLA_UPDATED', { detail: { status: req.params.status, target_minutes: minutes } });
  res.json({ ok: true });
});

// US-ADM-004 / BR-018: read-only, filterable. No update/delete endpoints exist.
export const listAudit = ah(async (req, res) => {
  let q = db.from('audit_log').select().order('created_at', { ascending: false }).limit(200);
  if (req.query.action) q = q.eq('action', req.query.action);
  if (req.query.actor_role) q = q.eq('actor_role', req.query.actor_role);
  if (req.query.resource_id) q = q.eq('resource_id', req.query.resource_id);
  if (req.query.from) q = q.gte('created_at', req.query.from);
  if (req.query.to) q = q.lte('created_at', req.query.to);
  const { data } = await q;
  res.json(data || []);
});

export const listNotifications = ah(async (req, res) => {
  const type = req.session.kind === 'patient' ? 'patient' : 'staff';
  const { data } = await db.from('notifications').select()
    .eq('recipient_type', type).eq('recipient_id', req.session.sub)
    .order('created_at', { ascending: false }).limit(100);
  const rows = data || [];
  res.json({ items: rows, unread: rows.filter(n => !n.is_read).length });
});

export const readNotification = ah(async (req, res) => {
  await db.from('notifications').update({ is_read: true })
    .eq('id', req.params.id).eq('recipient_id', req.session.sub);
  res.json({ ok: true });
});

export const publicSettings = ah(async (req, res) => {
  const { data } = await db.from('system_settings').select();
  const map = Object.fromEntries((data || []).map(s => [s.key, s.value]));
  res.json({ meet_visibility_hours: Number(map.meet_visibility_hours || 2) });
});

// ---- DEC-051/053: WhatsApp Cloud API settings (both channels OFF by default) ----
// field -> [system_settings key, validator, error message, may be blank]
const WA_FIELDS = {
  waba_id: ['whatsapp_waba_id', WA_ID_RE, 'WABA ID must be numeric.', true],
  phone_number_id: ['whatsapp_phone_number_id', WA_ID_RE, 'Phone Number ID must be numeric.', false],
  api_version: ['whatsapp_api_version', WA_VERSION_RE, 'Graph API version must look like v27.0.', false],
  otp_template: ['whatsapp_otp_template', WA_TEMPLATE_RE, 'Template names use letters, digits and underscores only.', false],
  otp_template_lang: ['whatsapp_otp_template_lang', WA_LANG_RE, 'Template language must look like en_US or ar.', false],
  notify_template: ['whatsapp_notify_template', WA_TEMPLATE_RE, 'Template names use letters, digits and underscores only.', true],
  notify_template_lang: ['whatsapp_notify_template_lang', WA_LANG_RE, 'Template language must look like en_US or ar.', false]
};

export const getWhatsAppSettings = ah(async (req, res) => {
  const cfg = await getWhatsAppConfig();
  res.json({
    otp_enabled: cfg.otpEnabled,
    notify_enabled: cfg.notifyEnabled,
    otp_mode: whatsappMode(cfg, 'otp'),
    notify_mode: whatsappMode(cfg, 'notify'),
    // Badges reflect the toggles, not the local kill switch: mock mode is an
    // environment override, reported separately so OFF still reads as OFF.
    configured: isConfigured(cfg),
    mock_switch: MOCK_WHATSAPP,
    waba_id: cfg.wabaId,
    phone_number_id: cfg.phoneNumberId,
    api_version: cfg.apiVersion,
    otp_template: cfg.otpTemplate,
    otp_template_lang: cfg.otpLang,
    otp_profile_lang: cfg.otpProfileLang,
    notify_template: cfg.notifyTemplate,
    notify_template_lang: cfg.notifyLang,
    // BR-018: the token is write-only — never returned to the browser.
    token_set: !!cfg.token,
    token_hint: cfg.token ? `…${cfg.token.slice(-4)}` : ''
  });
});

export const updateWhatsAppSettings = ah(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.otp_enabled !== undefined) patch.whatsapp_otp_enabled = b.otp_enabled ? 'true' : 'false';
  if (b.notify_enabled !== undefined) patch.whatsapp_notify_enabled = b.notify_enabled ? 'true' : 'false';
  if (b.otp_profile_lang !== undefined) patch.whatsapp_otp_profile_lang = b.otp_profile_lang ? 'true' : 'false';
  for (const [field, [key, re, msg, optional]] of Object.entries(WA_FIELDS)) {
    if (b[field] === undefined) continue;
    const v = String(b[field] ?? '').trim();
    if (!v && optional) { patch[key] = ''; continue; }
    if (!re.test(v)) throw httpError(400, msg);
    patch[key] = v;
  }
  // Blank or masked token keeps the stored one (never wipe a secret by accident);
  // an explicit null clears it (decommission / rotation hygiene).
  if (b.token === null) patch.whatsapp_token = '';
  else if (typeof b.token === 'string' && b.token.trim() && !b.token.startsWith('…')) patch.whatsapp_token = b.token.trim();
  if (!Object.keys(patch).length) throw httpError(400, 'Nothing to update.');

  const current = await getWhatsAppConfig();
  const next = {
    otpEnabled: patch.whatsapp_otp_enabled !== undefined ? patch.whatsapp_otp_enabled === 'true' : current.otpEnabled,
    notifyEnabled: patch.whatsapp_notify_enabled !== undefined ? patch.whatsapp_notify_enabled === 'true' : current.notifyEnabled,
    phoneNumberId: patch.whatsapp_phone_number_id ?? current.phoneNumberId,
    token: patch.whatsapp_token ?? current.token
  };
  const notifyTemplate = patch.whatsapp_notify_template ?? current.notifyTemplate;
  if ((next.otpEnabled || next.notifyEnabled) && !isConfigured(next)) {
    throw httpError(400, 'WhatsApp cannot be ON without a Phone Number ID and Access Token.');
  }
  if (next.notifyEnabled && !notifyTemplate) {
    throw httpError(400, 'Set a status-update (UTILITY) template before enabling WhatsApp notifications.');
  }

  // DEC-052/053: verify categories against Meta only for the channel being enabled
  // or whose template actually changed. The UI posts the whole form, so unchanged
  // templates must not trigger a lookup; turning OFF or rotating a token needs none.
  const changed = (keys, props) => keys.some((k, i) => k in patch && patch[k] !== current[props[i]]);
  const needOtp = patch.whatsapp_otp_enabled === 'true'
    || changed(['whatsapp_otp_template', 'whatsapp_otp_template_lang'], ['otpTemplate', 'otpLang']);
  const needNotify = patch.whatsapp_notify_enabled === 'true'
    || changed(['whatsapp_notify_template', 'whatsapp_notify_template_lang'], ['notifyTemplate', 'notifyLang']);
  if ((needOtp || needNotify) && isConfigured(next)) {
    const wabaId = patch.whatsapp_waba_id ?? current.wabaId;
    if (!wabaId) throw httpError(400, 'Add the WABA ID so template categories can be verified (AUTHENTICATION/UTILITY only).');
    try {
      await validateConfiguredTemplates({
        ...current,
        wabaId,
        phoneNumberId: next.phoneNumberId,
        token: next.token,
        otpTemplate: patch.whatsapp_otp_template ?? current.otpTemplate,
        otpLang: patch.whatsapp_otp_template_lang ?? current.otpLang,
        notifyTemplate,
        notifyLang: patch.whatsapp_notify_template_lang ?? current.notifyLang
      }, { otp: needOtp, notify: needNotify });
    } catch (err) {
      throw httpError(err.status || 400, err.message);
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    const { error } = await db.from('system_settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw httpError(500, error.message);
  }
  await audit(req, 'WHATSAPP_SETTINGS_UPDATED', {
    detail: { keys: Object.keys(patch), otp_enabled: next.otpEnabled, notify_enabled: next.notifyEnabled }
  });
  res.json({ ok: true });
});

// Read-only: lets the admin see approved templates and their variable counts before
// wiring an event. Safe to call while sending is OFF (no message is ever sent).
export const listWhatsAppTemplates = ah(async (req, res) => {
  const cfg = await getWhatsAppConfig();
  if (!cfg.wabaId || !isConfigured(cfg)) throw httpError(409, 'Save the WABA ID, Phone Number ID and Access Token first.');
  try {
    res.json({ items: await listTemplates(cfg) });
  } catch (err) {
    throw httpError(502, err.message);
  }
});

// Sends one real OTP template so the admin can verify the wiring end-to-end.
export const testWhatsApp = ah(async (req, res) => {
  const { to } = req.body;
  if (!/^\+[1-9]\d{7,14}$/.test(to || '')) throw httpError(400, 'Enter the test number in international format, e.g. +9665XXXXXXXX.');
  const cfg = await getWhatsAppConfig();
  const mode = whatsappMode(cfg, 'otp');
  if (mode === 'disabled') throw httpError(409, 'WhatsApp OTP is OFF. Enable "WhatsApp OTP for login" and save before sending a test.');
  if (mode === 'not_configured') throw httpError(409, 'Add the Phone Number ID and Access Token before testing.');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  if (mode === 'mock') {
    console.log(`[WhatsApp mock -> ${to}] test OTP ${code} (${cfg.otpTemplate}/${cfg.otpLang})`);
    await audit(req, 'WHATSAPP_TEST_SENT', { detail: { to, mode } });
    return res.json({ ok: true, mock: true });
  }
  try {
    const r = await sendOtpTemplate(cfg, to, code);
    await audit(req, 'WHATSAPP_TEST_SENT', { detail: { to, mode } });
    res.json({ ok: true, message_id: r?.messages?.[0]?.id || null });
  } catch (err) {
    throw httpError(502, err.message);
  }
});

async function purgeHospitalCase(hospCaseId) {
  const { data: hDocs } = await db
    .from('hospital_documents')
    .select('storage_path')
    .eq('hospital_case_id', hospCaseId);
  const paths = (hDocs || []).map(d => d.storage_path).filter(Boolean);

  await db
    .from('hospital_slots')
    .update({ status: 'free', hospital_case_id: null, released_at: new Date().toISOString() })
    .eq('hospital_case_id', hospCaseId);

  await Promise.all([
    db.from('hospital_lab_tests').delete().eq('hospital_case_id', hospCaseId),
    db.from('hospital_medications').delete().eq('hospital_case_id', hospCaseId),
    db.from('hospital_documents').delete().eq('hospital_case_id', hospCaseId),
    db.from('hospital_case_timeline').delete().eq('hospital_case_id', hospCaseId),
    db.from('hospital_invoices').delete().eq('hospital_case_id', hospCaseId),
    db.from('international_opinion_requests').delete().eq('hospital_case_id', hospCaseId)
  ]);

  const { error } = await db.from('hospital_cases').delete().eq('id', hospCaseId);
  if (error) throw httpError(500, error.message);

  if (paths.length) {
    await db.storage.from('case-documents').remove(paths).catch(() => {});
  }
}

export const listAllCases = ah(async (req, res) => {
  const [{ data: aloCases, error: aloErr }, { data: hospCases, error: hospErr }] = await Promise.all([
    db.from('cases').select('id, case_number, patient_id, service_type, service_subtype, specialty, status, reason, created_at').order('created_at', { ascending: false }),
    db.from('hospital_cases').select('id, case_number, hospital_id, hospital_patient_id, alo_case_id, service_type, requested_specialty, status, arrival_status, checkin_code, created_at').order('created_at', { ascending: false })
  ]);
  if (aloErr) throw httpError(500, aloErr.message);
  if (hospErr) throw httpError(500, hospErr.message);

  const pIds = [...new Set((aloCases || []).map(c => c.patient_id).filter(Boolean))];
  const hpIds = [...new Set((hospCases || []).map(c => c.hospital_patient_id).filter(Boolean))];
  const hIds = [...new Set((hospCases || []).map(c => c.hospital_id).filter(Boolean))];

  const [{ data: patients }, { data: hPatients }, { data: hospitals }] = await Promise.all([
    pIds.length ? db.from('patients').select('id, full_name, phone').in('id', pIds) : Promise.resolve({ data: [] }),
    hpIds.length ? db.from('hospital_patients').select('id, full_name, mrn, phone').in('id', hpIds) : Promise.resolve({ data: [] }),
    hIds.length ? db.from('hospitals').select('id, name').in('id', hIds) : Promise.resolve({ data: [] })
  ]);

  const pMap = Object.fromEntries((patients || []).map(p => [p.id, p]));
  const hpMap = Object.fromEntries((hPatients || []).map(p => [p.id, p]));
  const hMap = Object.fromEntries((hospitals || []).map(h => [h.id, h.name]));
  const hospByAlo = Object.fromEntries((hospCases || []).filter(h => h.alo_case_id).map(h => [h.alo_case_id, h]));
  const aloIdSet = new Set((aloCases || []).map(c => c.id));

  const items = [
    ...(aloCases || []).map(c => {
      const linkedHosp = hospByAlo[c.id];
      return {
        id: c.id,
        source: 'ALO',
        case_number: c.case_number,
        patient_name: pMap[c.patient_id]?.full_name || '—',
        patient_phone: pMap[c.patient_id]?.phone || '—',
        service_type: c.service_subtype ? `${c.service_type} / ${c.service_subtype}` : c.service_type,
        specialty: c.specialty || '—',
        status: c.status,
        hospital_name: linkedHosp ? (hMap[linkedHosp.hospital_id] || 'Partner Hospital') : 'ALO Central',
        created_at: c.created_at
      };
    }),
    ...(hospCases || [])
      .filter(hc => !hc.alo_case_id || !aloIdSet.has(hc.alo_case_id))
      .map(hc => ({
        id: hc.id,
        source: 'HOSPITAL',
        case_number: hc.case_number,
        patient_name: hpMap[hc.hospital_patient_id]?.full_name || '—',
        patient_phone: hpMap[hc.hospital_patient_id]?.phone || hpMap[hc.hospital_patient_id]?.mrn || '—',
        service_type: hc.service_type || 'day_clinic',
        specialty: hc.requested_specialty || '—',
        status: hc.status,
        hospital_name: hMap[hc.hospital_id] || 'Hospital',
        created_at: hc.created_at
      }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json(items);
});

export const deleteCaseCompletely = ah(async (req, res) => {
  const source = String(req.params.source || '').toUpperCase();
  const { id } = req.params;
  if (!['ALO', 'HOSPITAL'].includes(source)) throw httpError(400, 'Invalid case source.');

  if (source === 'HOSPITAL') {
    const { data: hc } = await db.from('hospital_cases').select('id, case_number').eq('id', id).maybeSingle();
    if (!hc) throw httpError(404, 'Hospital case not found.');
    await purgeHospitalCase(id);
    await audit(req, 'ADMIN_CASE_DELETED', { resourceType: 'hospital_case', resourceId: id, detail: { case_number: hc.case_number } });
    return res.json({ ok: true, message: `Case ${hc.case_number} permanently deleted.` });
  }

  const { data: c } = await db.from('cases').select('id, case_number').eq('id', id).maybeSingle();
  if (!c) throw httpError(404, 'Case not found.');

  const [{ data: docs }, { data: revs }, { data: linkedHosps }] = await Promise.all([
    db.from('documents').select('storage_path').eq('case_id', id),
    db.from('case_reviews').select('voice_note_path').eq('case_id', id),
    db.from('hospital_cases').select('id').eq('alo_case_id', id)
  ]);

  const storagePaths = [
    ...(docs || []).map(d => d.storage_path),
    ...(revs || []).map(r => r.voice_note_path)
  ].filter(Boolean);

  for (const lh of linkedHosps || []) {
    await purgeHospitalCase(lh.id);
  }

  await db.from('cases').update({ parent_case_id: null }).eq('parent_case_id', id);

  await Promise.all([
    db.from('case_assignments').delete().eq('case_id', id),
    db.from('case_timeline').delete().eq('case_id', id),
    db.from('documents').delete().eq('case_id', id),
    db.from('consultations').delete().eq('case_id', id),
    db.from('vitals').delete().eq('case_id', id),
    db.from('magic_link_tokens').delete().eq('case_id', id),
    db.from('international_reviews').delete().eq('case_id', id),
    db.from('prescriptions').delete().eq('case_id', id),
    db.from('case_reviews').delete().eq('case_id', id),
    db.from('case_reports_requests').delete().eq('case_id', id),
    db.from('notifications').delete().eq('case_id', id)
  ]);

  const { error: delErr } = await db.from('cases').delete().eq('id', id);
  if (delErr) throw httpError(500, delErr.message);

  if (storagePaths.length) {
    await db.storage.from('case-documents').remove(storagePaths).catch(() => {});
  }

  await audit(req, 'ADMIN_CASE_DELETED', { resourceType: 'case', resourceId: id, detail: { case_number: c.case_number } });
  res.json({ ok: true, message: `Case ${c.case_number} permanently deleted.` });
});