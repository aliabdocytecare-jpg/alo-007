// Admin domain — US-ADM-001..007, BR-018/022/026/030. Plus notifications for all roles.
import bcrypt from 'bcryptjs';
import { db, MOCK_WHATSAPP } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
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

// BR-030: staff created only by admin. DEC-010: initial password set by admin.
export const createStaff = ah(async (req, res) => {
  const { full_name, role, email, phone, password, specialty } = req.body;
  if (!full_name?.trim() || !email?.trim()) throw httpError(400, 'Full name and email are required.');
  if (!['nurse', 'coordinator', 'doctor', 'admin'].includes(role)) throw httpError(400, 'Invalid role.');
  if (!PW_RE.test(password || '')) throw httpError(400, 'Password must be at least 10 characters with 1 uppercase letter, 1 number, and 1 special character.');
  const { data, error } = await db.from('staff_users').insert({
    full_name: full_name.trim(), role, email: email.trim().toLowerCase(),
    phone: phone || null, specialty: specialty || null,
    password_hash: await bcrypt.hash(password, 10)
  }).select().single();
  if (error) throw httpError(409, 'A staff account with this email already exists.');
  await audit(req, 'STAFF_CREATED', { resourceType: 'staff', resourceId: data.id, detail: { role, email: data.email } });
  const { password_hash, ...safe } = data;
  res.status(201).json(safe);
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