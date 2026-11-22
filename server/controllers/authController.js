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
function assertNotLocked(e) {
  if (e.lockedUntil > Date.now()) {
    const mins = Math.ceil((e.lockedUntil - Date.now()) / 60_000);
    throw httpError(423, `Account temporarily locked. Try again in ${mins} minute(s).`);
  }
}
// US-PAT-002 AC2: 5 failed attempts -> 15 minute lock.
function checkOtp(phone, otp) {
  const e = otpEntry(phone);
  assertNotLocked(e);
  const valid = MOCK_AUTH
    ? (otp === '123456' || otp === '1234')
    : (e.code && otp === e.code && e.expiresAt > Date.now());
  if (!valid) {
    e.attempts += 1;
    if (e.attempts >= 5) { e.lockedUntil = Date.now() + 15 * 60_000; e.attempts = 0; }
    throw httpError(401, 'Incorrect OTP. Please try again.');
  }
  e.attempts = 0;
}

export const sendOtp = ah(async (req, res) => {
  const { phone } = req.body;
  if (!PHONE_RE.test(phone || '')) throw httpError(400, 'Enter a valid phone number in international format, e.g. +9665XXXXXXXX');
  const e = otpEntry(phone);
  assertNotLocked(e);
  const hourAgo = Date.now() - 3600_000;
  e.resends = e.resends.filter(t => t > hourAgo);
  if (e.resends.length >= 5) throw httpError(429, 'Too many OTP requests. Try again later.'); // F-AUTH-01: max 5/hour

  const { data: existing } = await db.from('patients').select().eq('phone', phone).maybeSingle();
  // DEC-051/053: real OTP delivery is WhatsApp-only and gated by its own Admin toggle,
  // independent of the status-update channel.
  const cfg = MOCK_AUTH ? null : await getWhatsAppConfig();
  const mode = cfg ? whatsappMode(cfg, 'otp') : 'mock';
  if (mode === 'disabled' || mode === 'not_configured') {
    throw httpError(503, 'Verification codes are unavailable right now. Please contact AloDoc support.');
  }

  e.resends.push(Date.now());
  e.code = MOCK_AUTH ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
  e.expiresAt = Date.now() + 10 * 60_000; // 10 minute validity

  if (mode === 'mock') {
    console.log(`[WhatsApp mock -> ${phone}] OTP ${e.code}${cfg ? ` (${cfg.otpTemplate}/${otpLangFor(cfg, existing?.preferred_lang)})` : ''}`);
  } else {
    // DEC-005: prefer the patient's language; a missing variant must not lock them
    // out, so fall back to the admin-configured default before failing.
    const langs = [...new Set([otpLangFor(cfg, existing?.preferred_lang), cfg.otpLang])];
    let lastErr = null;
    for (const lang of langs) {
      try { await sendOtpTemplate(cfg, phone, e.code, lang); lastErr = null; break; }
      catch (err) { lastErr = err; console.error(`[WhatsApp OTP] ${lang} send failed:`, err.message); }
    }
    if (lastErr) {
      e.code = null;
      throw httpError(502, 'Unable to send the verification code. Please try again.');
    }
  }

  await audit(req, 'OTP_SENT', { detail: { phone }, actorId: null, actorRole: 'anonymous' });
  res.json({ ok: true, exists: !!existing, mock: MOCK_AUTH });
});

export const verifyOtp = ah(async (req, res) => {
  const { phone, otp } = req.body;
  checkOtp(phone, otp);
  const { data: patient } = await db.from('patients').select().eq('phone', phone).maybeSingle();
  if (!patient) throw httpError(404, 'No account with this number. Please register.');
  issueSession(res, { sub: patient.id, role: 'patient', kind: 'patient' }, PATIENT_TTL);
  await audit(req, 'PATIENT_LOGIN', { actorId: patient.id, actorRole: 'patient' });
  res.json({ ok: true, role: 'patient' });
});

// US-PAT-001: duplicate phone never creates a second account (AC4).
export const register = ah(async (req, res) => {
  const { phone, otp, full_name, dob, gender, nationality, email } = req.body;
  if (!PHONE_RE.test(phone || '')) throw httpError(400, 'Invalid phone number format.');
  if (!full_name?.trim()) throw httpError(400, 'Full name is required.');
  if (dob && new Date(dob) >= new Date()) throw httpError(400, 'Date of birth must be in the past.');
  if (gender && !['MALE', 'FEMALE'].includes(gender)) throw httpError(400, 'Invalid gender value.');
  checkOtp(phone, otp);
  const { data: existing } = await db.from('patients').select().eq('phone', phone).maybeSingle();
  if (existing) throw httpError(409, 'An account with this number already exists. Sign in instead.');
  const { data: patient, error } = await db.from('patients')
    .insert({ phone, full_name: full_name.trim(), dob: dob || null, gender: gender || null, nationality: nationality || null, email: email || null })
    .select().single();
  if (error) throw httpError(500, error.message);
  issueSession(res, { sub: patient.id, role: 'patient', kind: 'patient' }, PATIENT_TTL);
  await audit(req, 'PATIENT_REGISTERED', { actorId: patient.id, actorRole: 'patient' });
  res.json({ ok: true, role: 'patient' });
});

// F-AUTH-03: 5 fails -> 15 min lock; admin notified on 3rd failure.
export const staffLogin = ah(async (req, res) => {
  const { email, password } = req.body;
  const key = (email || '').toLowerCase();
  const f = staffFails.get(key) || { count: 0, lockedUntil: 0 };
  staffFails.set(key, f);
  if (f.lockedUntil > Date.now()) throw httpError(423, 'Account temporarily locked. Try again in 15 minutes.');
  const { data: s } = await db.from('staff_users').select().eq('email', key).maybeSingle();
  const ok = s && s.is_active && await bcrypt.compare(password || '', s.password_hash);
  if (!ok) {
    f.count += 1;
    if (f.count === 3) await notifyAdmins({ event: 'STAFF_LOGIN_FAILS', title: 'Staff login failures', body: `3 failed login attempts for ${key}.` });
    if (f.count >= 5) { f.lockedUntil = Date.now() + 15 * 60_000; f.count = 0; }
    throw httpError(401, s && !s.is_active ? 'Your account is inactive. Contact your administrator.' : 'Invalid email or password.');
  }
  f.count = 0;
  issueSession(res, { sub: s.id, role: s.role, kind: 'staff' }, STAFF_TTL);
  await audit(req, 'STAFF_LOGIN', { actorId: s.id, actorRole: s.role });
  res.json({ ok: true, role: s.role });
});

export const me = ah(async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  const table = req.session.kind === 'patient' ? 'patients' : 'staff_users';
  const { data } = await db.from(table).select().eq('id', req.session.sub).maybeSingle();
  if (!data) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.kind === 'staff' && !data.is_active) return res.status(401).json({ error: 'account_inactive' });
  delete data.password_hash;
  res.json({ kind: req.session.kind, role: req.session.role, profile: data });
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