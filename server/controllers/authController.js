// F-AUTH-01/02/03 + Part 8.1 edge cases. Mock OTP behind ENABLE_MOCK_AUTH (DEC-007).
import bcrypt from 'bcryptjs';
import { db, MOCK_AUTH } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { issueSession, COOKIE, PATIENT_TTL, STAFF_TTL } from '../middleware/auth.js';
import { notifyAdmins } from '../services/notificationService.js';
import { getWhatsAppConfig, whatsappMode, sendOtpTemplate, otpLangFor } from '../services/whatsappService.js';

const otpStore = new Map();   // phone -> { code, expiresAt, attempts, lockedUntil, resends[] }
const staffFails = new Map(); // email -> { count, lockedUntil }
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

function otpEntry(phone) {
  if (!otpStore.has(phone)) otpStore.set(phone, { code: null, expiresAt: 0, attempts: 0, lockedUntil: 0, resends: [] });
  return otpStore.get(phone);
}

function assertNotLocked(entry) {
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    throw httpError(429, `Too many attempts. Try again in ${mins} minute(s).`, 'ACCOUNT_LOCKED');
  }
}

function checkOtp(phone, otp) {
  const e = otpEntry(phone);
  assertNotLocked(e);
  if (!e.code || Date.now() > e.expiresAt) throw httpError(400, 'OTP expired. Request a new code.', 'OTP_EXPIRED');
  const valid = e.code === String(otp).trim() || (MOCK_AUTH && String(otp).trim() === '123456');
  if (!valid) {
    e.attempts += 1;
    if (e.attempts >= 5) { e.lockedUntil = Date.now() + 15 * 60_000; e.attempts = 0; }
    throw httpError(401, 'Incorrect OTP. Please try again.', 'INVALID_OTP');
  }
  e.attempts = 0;
}

export const sendOtp = ah(async (req, res) => {
  const { phone } = req.body;
  if (!PHONE_RE.test(phone || '')) throw httpError(400, 'Enter a valid phone number in international format, e.g. +9665XXXXXXXX', 'INVALID_PHONE');
  const e = otpEntry(phone);
  assertNotLocked(e);
  const hourAgo = Date.now() - 3600_000;
  e.resends = e.resends.filter(t => t > hourAgo);
  if (e.resends.length >= 5) throw httpError(429, 'Too many OTP requests. Try again later.', 'RATE_LIMITED'); // F-AUTH-01: max 5/hour
  e.resends.push(Date.now());
  e.code = MOCK_AUTH ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
  e.expiresAt = Date.now() + 10 * 60_000; // 10-minute expiry (DEC-051: matches WABA footer)

  const { data: existing } = await db.from('patients').select().eq('phone', phone).maybeSingle();
  const isNew = !existing;

  // DEC-053: resolve OTP channel mode independently of notifications.
  const cfg = await getWhatsAppConfig();
  const mode = whatsappMode(cfg, 'otp');

  if (mode === 'disabled') {
    throw httpError(503, 'WhatsApp login is currently disabled by administrator.');
  }
  if (mode === 'not_configured') {
    throw httpError(503, 'WhatsApp login credentials are not configured. Contact your administrator.');
  }
  if (mode === 'mock') {
    console.log(`[WhatsApp mock -> ${phone}] OTP ${e.code}${cfg ? ` (${cfg.otpTemplate}/${otpLangFor(cfg, existing?.preferred_lang)})` : ''}`);
  } else if (mode === 'live') {
    // Retry once with the configured default language if patient's preferred_lang fails.
    const primaryLang = otpLangFor(cfg, existing?.preferred_lang);
    const languages = [primaryLang];
    if (cfg.otpTemplateLang && cfg.otpTemplateLang !== primaryLang) languages.push(cfg.otpTemplateLang);
    let lastErr = null;
    for (const lang of languages) {
      try { await sendOtpTemplate(cfg, phone, e.code, lang); lastErr = null; break; }
      catch (err) { lastErr = err; }
    }
    if (lastErr) {
      console.error(`[WhatsApp] Failed to send OTP to ${phone}:`, lastErr.message);
      throw httpError(502, `Failed to deliver OTP via WhatsApp: ${lastErr.message}`);
    }
  }

  await audit(req, 'OTP_SENT', { detail: { phone }, actorId: null, actorRole: 'anonymous' });
  res.json({ ok: true, isNew });
});

export const verifyOtp = ah(async (req, res) => {
  const { phone, otp } = req.body;
  checkOtp(phone, otp);
  const { data: patient } = await db.from('patients').select().eq('phone', phone).maybeSingle();
  if (!patient) return res.json({ ok: true, registered: false });
  const token = issueSession(res, { sub: patient.id, role: 'patient', kind: 'patient' }, PATIENT_TTL);
  await audit(req, 'PATIENT_LOGIN', { actorId: patient.id, actorRole: 'patient' });
  res.json({
    ok: true,
    registered: true,
    token,
    user: {
      id: patient.id,
      role: 'patient',
      kind: 'patient',
      phone: patient.phone,
      full_name: patient.full_name
    }
  });
});

// US-PAT-001: duplicate phone never creates a second account (AC4).
export const register = ah(async (req, res) => {
  const { phone, otp, full_name, dob, gender, nationality, email } = req.body;
  if (!PHONE_RE.test(phone || '')) throw httpError(400, 'Invalid phone number format.', 'INVALID_PHONE');
  if (!full_name || !full_name.trim()) throw httpError(400, 'Full name is required.', 'MISSING_NAME');
  if (dob && new Date(dob) >= new Date()) throw httpError(400, 'Date of birth must be in the past.', 'INVALID_DOB');
  if (gender && !['MALE', 'FEMALE'].includes(gender)) throw httpError(400, 'Gender must be MALE or FEMALE.', 'INVALID_GENDER');
  checkOtp(phone, otp);
  const { data: existing } = await db.from('patients').select().eq('phone', phone).maybeSingle();
  if (existing) throw httpError(409, 'An account already exists for this phone number. Please sign in.', 'ACCOUNT_EXISTS');
  const { data: p, error } = await db.from('patients')
    .insert({ phone, full_name: full_name.trim(), dob: dob || null, gender: gender || null, nationality: nationality || null, email: email || null })
    .select().single();
  if (error) throw httpError(500, error.message);
  const token = issueSession(res, { sub: p.id, role: 'patient', kind: 'patient' }, PATIENT_TTL);
  await audit(req, 'PATIENT_REGISTERED', { actorId: p.id, actorRole: 'patient' });
  res.status(201).json({
    ok: true,
    patient: p,
    token,
    user: {
      id: p.id,
      role: 'patient',
      kind: 'patient',
      phone: p.phone,
      full_name: p.full_name
    }
  });
});

export const staffLogin = ah(async (req, res) => {
  const { email, password } = req.body;
  const key = (email || '').toLowerCase().trim();
  const f = staffFails.get(key) || { count: 0, lockedUntil: 0 };
  staffFails.set(key, f);
  if (f.lockedUntil > Date.now()) throw httpError(423, 'Account temporarily locked. Try again in 15 minutes.', 'ACCOUNT_LOCKED');
  const { data: s } = await db.from('staff_users').select().eq('email', key).maybeSingle();
  const ok = s && s.is_active && await bcrypt.compare(password || '', s.password_hash);
  if (!ok) {
    f.count += 1;
    if (f.count === 3) await notifyAdmins({ event: 'STAFF_LOGIN_FAILS', title: 'Staff login failures', body: `3 failed login attempts for ${key}.` });
    if (f.count >= 5) { f.lockedUntil = Date.now() + 15 * 60_000; f.count = 0; }
    throw httpError(401, s && !s.is_active ? 'Your account is inactive. Contact your administrator.' : 'Invalid email or password.', s && !s.is_active ? 'ACCOUNT_INACTIVE' : 'INVALID_CREDENTIALS');
  }
  f.count = 0;
  const token = issueSession(res, { sub: s.id, role: s.role, kind: 'staff', hospital_id: s.hospital_id || null }, STAFF_TTL);
  await audit(req, 'STAFF_LOGIN', { actorId: s.id, actorRole: s.role, hospitalId: s.hospital_id });
  res.json({
    ok: true,
    role: s.role,
    token,
    user: {
      id: s.id,
      role: s.role,
      kind: 'staff',
      full_name: s.full_name,
      hospital_id: s.hospital_id || null
    }
  });
});

export const me = ah(async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
  const table = req.session.kind === 'patient' ? 'patients' : 'staff_users';
  const { data } = await db.from(table).select().eq('id', req.session.sub).maybeSingle();
  if (!data) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.kind === 'staff' && !data.is_active) return res.status(401).json({ error: 'account_inactive' });
  delete data.password_hash;

  let hospital = null;
  if (data.hospital_id) {
    const { data: hosp } = await db
      .from('hospitals')
      .select('id, name, name_ar, short_name, city, logo_url, is_active, timezone')
      .eq('id', data.hospital_id)
      .maybeSingle();
    hospital = hosp;
  }

  res.json({
    kind: req.session.kind,
    role: req.session.role,
    profile: data,
    staff: data,
    hospital,
    tenant: hospital,
    hospital_id: data.hospital_id || req.session.hospital_id || null
  });
});

export const updateProfile = ah(async (req, res) => {
  const patch = {};
  for (const k of ['full_name', 'dob', 'gender', 'nationality', 'email', 'preferred_lang']) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  if (patch.dob && new Date(patch.dob) >= new Date()) throw httpError(400, 'Date of birth must be in the past.');
  await db.from('patients').update(patch).eq('id', req.session.sub);
  await audit(req, 'PATIENT_PROFILE_UPDATED', { actorId: req.session.sub, actorRole: 'patient' });
  res.json({ ok: true });
});

export const logout = ah(async (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});
