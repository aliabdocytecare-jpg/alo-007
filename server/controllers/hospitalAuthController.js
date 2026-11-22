// DEC-056: Hospital Staff Authentication (WhatsApp OTP only)
import jwt from 'jsonwebtoken';
import { db, MOCK_AUTH } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { toE164, PHONE_E164_RE } from '../lib/phone.js';
import { issueSession, COOKIE, STAFF_TTL, PATIENT_TTL } from '../middleware/auth.js';
import { getWhatsAppConfig, whatsappMode, sendOtpTemplate, otpLangFor } from '../services/whatsappService.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// In-memory OTP store: phone -> { code, expiresAt, attempts, lockedUntil, resends[] }
const staffOtpStore = new Map();

function getStaffOtpEntry(phone) {
  if (!staffOtpStore.has(phone)) {
    staffOtpStore.set(phone, { code: null, expiresAt: 0, attempts: 0, lockedUntil: 0, resends: [] });
  }
  return staffOtpStore.get(phone);
}

function assertNotLocked(entry) {
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    throw httpError(429, `Too many failed attempts. Try again in ${mins} minute(s).`);
  }
}

function verifyOtp(phone, otp) {
  const e = getStaffOtpEntry(phone);
  assertNotLocked(e);

  if (!e.code || Date.now() > e.expiresAt) {
    throw httpError(400, 'OTP expired. Please request a new code.');
  }

  const valid = e.code === String(otp).trim() || (MOCK_AUTH && String(otp).trim() === '123456');
  if (!valid) {
    e.attempts += 1;
    if (e.attempts >= 5) {
      e.lockedUntil = Date.now() + 15 * 60_000;
      e.attempts = 0;
    }
    throw httpError(401, 'Incorrect OTP. Please try again.');
  }

  e.attempts = 0;
  e.code = null; // single use
}

/**
 * POST /api/v1/auth/staff/otp/send
 * Hospital staff authentication request: WhatsApp OTP only (D7)
 */
export const sendStaffOtp = ah(async (req, res) => {
  const { phone } = req.body;
  if (!phone) throw httpError(400, 'Phone number is required');

  const phoneE164 = toE164(phone);
  const entry = getStaffOtpEntry(phoneE164);
  assertNotLocked(entry);

  const hourAgo = Date.now() - 3600_000;
  entry.resends = entry.resends.filter(t => t > hourAgo);
  if (entry.resends.length >= 5) {
    throw httpError(429, 'Too many OTP requests. Try again later.');
  }

  // Look up staff user by phone_e164 (or fallback to phone)
  const { data: staff, error: staffErr } = await db
    .from('staff_users')
    .select('id, role, full_name, is_active, hospital_id, preferred_lang')
    .or(`phone_e164.eq.${phoneE164},phone.eq.${phoneE164}`)
    .maybeSingle();

  if (staffErr) {
    throw httpError(500, `Database error: ${staffErr.message}`);
  }

  // Section 5.1 D5: Generic message for unregistered or inactive staff
  if (!staff || !staff.is_active) {
    throw httpError(403, 'This number cannot sign in. Please contact your administrator.', {
      code: 'staff_not_authorized'
    });
  }

  // Verify hospital is active if affiliated
  if (staff.hospital_id) {
    const { data: hosp } = await db
      .from('hospitals')
      .select('id, is_active')
      .eq('id', staff.hospital_id)
      .maybeSingle();

    if (!hosp || !hosp.is_active) {
      throw httpError(403, 'This hospital is currently inactive. Please contact support.', {
        code: 'hospital_inactive'
      });
    }
  }

  // Generate 6-digit OTP
  const code = MOCK_AUTH ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
  entry.code = code;
  entry.expiresAt = Date.now() + 10 * 60_000; // 10 min TTL
  entry.resends.push(Date.now());

  const cfg = await getWhatsAppConfig();
  const mode = whatsappMode(cfg, 'otp');

  if (mode === 'mock') {
    console.log(`[Staff WhatsApp mock -> ${phoneE164}] OTP ${code} (Role: ${staff.role})`);
  } else if (mode === 'live') {
    const lang = otpLangFor(cfg, staff.preferred_lang || 'en');
    await sendOtpTemplate(cfg, phoneE164, code, lang);
  }

  await audit(req, 'STAFF_OTP_SENT', {
    resourceType: 'staff_user',
    resourceId: staff.id,
    detail: { phone: phoneE164, hospital_id: staff.hospital_id },
    actorId: staff.id,
    actorRole: staff.role,
    hospitalId: staff.hospital_id
  });

  res.json({ ok: true, message: 'OTP sent via WhatsApp.' });
});

/**
 * POST /api/v1/auth/staff/otp/verify
 * Validates OTP and issues session or role choice challenge
 */
export const verifyStaffOtp = ah(async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) throw httpError(400, 'Phone and OTP are required');

  const phoneE164 = toE164(phone);
  verifyOtp(phoneE164, otp);

  const { data: staff } = await db
    .from('staff_users')
    .select('id, role, full_name, is_active, hospital_id, phone_verified_at')
    .or(`phone_e164.eq.${phoneE164},phone.eq.${phoneE164}`)
    .maybeSingle();

  if (!staff || !staff.is_active) {
    throw httpError(403, 'This number cannot sign in. Please contact your administrator.');
  }

  // D11: Check if phone also belongs to a patient account
  const { data: patient } = await db
    .from('patients')
    .select('id, full_name')
    .eq('phone', phoneE164)
    .maybeSingle();

  if (patient) {
    // Both accounts exist -> issue role selection challenge
    const challenge = jwt.sign(
      { sub_staff: staff.id, sub_patient: patient.id, phone: phoneE164, hospital_id: staff.hospital_id },
      SECRET,
      { expiresIn: '5m' }
    );
    return res.json({
      ok: true,
      needsRole: true,
      options: ['patient', 'staff'],
      challenge
    });
  }

  // Single staff account -> issue session
  if (!staff.phone_verified_at) {
    await db.from('staff_users').update({ phone_verified_at: new Date().toISOString() }).eq('id', staff.id);
  }

  const token = issueSession(res, {
    sub: staff.id,
    role: staff.role,
    kind: 'staff',
    hospital_id: staff.hospital_id
  }, STAFF_TTL);

  await audit(req, 'STAFF_LOGIN_OTP', {
    resourceType: 'staff_user',
    resourceId: staff.id,
    actorId: staff.id,
    actorRole: staff.role,
    hospitalId: staff.hospital_id
  });

  res.json({
    ok: true,
    token,
    user: {
      id: staff.id,
      role: staff.role,
      kind: 'staff',
      full_name: staff.full_name,
      hospital_id: staff.hospital_id
    }
  });
});

/**
 * POST /api/v1/auth/choose-role
 * Resolves dual staff/patient identity challenge
 */
export const chooseRole = ah(async (req, res) => {
  const { challenge, role } = req.body;
  if (!challenge || !role) throw httpError(400, 'Challenge and role selection are required');
  if (!['patient', 'staff'].includes(role)) throw httpError(400, 'Invalid role selection');

  let payload;
  try {
    payload = jwt.verify(challenge, SECRET);
  } catch {
    throw httpError(400, 'Challenge token expired or invalid. Please request a new OTP.');
  }

  if (role === 'staff') {
    const { data: staff } = await db
      .from('staff_users')
      .select('id, role, full_name, is_active, hospital_id')
      .eq('id', payload.sub_staff)
      .maybeSingle();

    if (!staff || !staff.is_active) {
      throw httpError(403, 'Staff account inactive');
    }

    const token = issueSession(res, {
      sub: staff.id,
      role: staff.role,
      kind: 'staff',
      hospital_id: staff.hospital_id
    }, STAFF_TTL);

    await audit(req, 'LOGIN_ROLE_CHOSEN', {
      actorId: staff.id,
      actorRole: staff.role,
      detail: { chosenRole: 'staff' },
      hospitalId: staff.hospital_id
    });

    return res.json({
      ok: true,
      token,
      user: {
        id: staff.id,
        role: staff.role,
        kind: 'staff',
        full_name: staff.full_name,
        hospital_id: staff.hospital_id
      }
    });
  } else {
    const { data: patient } = await db
      .from('patients')
      .select('id, full_name, phone')
      .eq('id', payload.sub_patient)
      .maybeSingle();

    if (!patient) throw httpError(404, 'Patient record not found');

    const token = issueSession(res, { sub: patient.id, role: 'patient', kind: 'patient' }, PATIENT_TTL);

    await audit(req, 'LOGIN_ROLE_CHOSEN', {
      actorId: patient.id,
      actorRole: 'patient',
      detail: { chosenRole: 'patient' }
    });

    return res.json({
      ok: true,
      token,
      user: {
        id: patient.id,
        role: 'patient',
        kind: 'patient',
        full_name: patient.full_name,
        phone: patient.phone
      }
    });
  }
});

/**
 * POST /api/v1/auth/staff/claim-phone
 * Self-claim a verified inactive phone number via OTP proof of possession
 */
export const claimPhone = ah(async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) throw httpError(400, 'Phone and OTP are required');

  const phoneE164 = toE164(phone);
  verifyOtp(phoneE164, otp);

  // Find holder of the phone
  const { data: holder } = await db
    .from('staff_users')
    .select('id, is_active, phone_verified_at, hospital_id')
    .eq('phone_e164', phoneE164)
    .maybeSingle();

  if (!holder) {
    return res.json({ ok: true, status: 'available', message: 'Number is already available' });
  }

  // Active holder cannot be displaced by claim
  if (holder.is_active) {
    throw httpError(409, 'This number is currently assigned to an active staff member and cannot be claimed.');
  }

  // Release number from inactive holder
  await db.from('staff_users').update({ phone_e164: null, phone: null }).eq('id', holder.id);

  await audit(req, 'STAFF_PHONE_CLAIMED', {
    resourceType: 'staff_user',
    resourceId: holder.id,
    detail: { phone_e164: phoneE164 },
    hospitalId: holder.hospital_id
  });

  res.json({ ok: true, status: 'released', message: 'Number has been released and is now available.' });
});

/**
 * GET /api/v1/auth/me
 * Returns current authenticated profile with tenant info if applicable
 */
export const getMe = ah(async (req, res) => {
  if (!req.session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.session.kind === 'patient') {
    const { data: patient } = await db
      .from('patients')
      .select('id, full_name, phone, dob, gender, preferred_lang')
      .eq('id', req.session.sub)
      .maybeSingle();

    if (!patient) return res.status(401).json({ error: 'Patient not found' });
    return res.json({ ok: true, user: { ...patient, role: 'patient', kind: 'patient' } });
  }

  // Staff account
  const { data: staff } = await db
    .from('staff_users')
    .select('id, email, role, full_name, phone, phone_e164, specialty, is_active, hospital_id, preferred_lang')
    .eq('id', req.session.sub)
    .maybeSingle();

  if (!staff || !staff.is_active) {
    return res.status(401).json({ error: 'account_inactive' });
  }

  let hospital = null;
  if (staff.hospital_id) {
    const { data: hosp } = await db
      .from('hospitals')
      .select('id, name, name_ar, short_name, city, logo_url, is_active, timezone')
      .eq('id', staff.hospital_id)
      .maybeSingle();
    hospital = hosp;
  }

  res.json({
    ok: true,
    user: {
      ...staff,
      kind: 'staff',
      hospital
    }
  });
});
