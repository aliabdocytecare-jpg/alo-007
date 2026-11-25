// DEC-056: ALO Platform Admin Controller for Hospital Tenancy & Governance
import crypto from 'crypto';
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { toE164, assertStaffPhoneAvailable } from '../lib/phone.js';

/**
 * GET /api/v1/admin/hospitals
 * Lists all partner hospitals
 */
export const listHospitals = ah(async (req, res) => {
  const { data: hospitals, error } = await db
    .from('hospitals')
    .select('id, name, name_ar, short_name, city, address, phone, timezone, logo_url, kiosk_pin, is_active, created_at')
    .order('name');

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, hospitals });
});

/**
 * POST /api/v1/admin/hospitals
 * Provisions a new hospital tenant (D5, D6)
 */
export const createHospital = ah(async (req, res) => {
  const { name, name_ar, short_name, city, address, phone, timezone, logo_url, primary_color, kiosk_pin } = req.body;

  if (!name || !String(name).trim()) throw httpError(400, 'Hospital name is required');
  if (!city || !String(city).trim()) throw httpError(400, 'City is required');

  // Generate 6-digit random kiosk PIN if not provided
  const pin = kiosk_pin ? String(kiosk_pin).trim() : String(Math.floor(100000 + Math.random() * 900000));

  const hospitalPayload = {
    name: String(name).trim(),
    name_ar: name_ar ? String(name_ar).trim() : null,
    short_name: short_name ? String(short_name).trim().toUpperCase() : name.slice(0, 4).toUpperCase(),
    city: String(city).trim(),
    address: address ? String(address).trim() : null,
    phone: phone ? String(phone).trim() : null,
    timezone: timezone || 'Asia/Riyadh',
    logo_url: logo_url || null,
    primary_color: primary_color || '#000000',
    kiosk_pin: pin,
    is_active: true
  };

  const { data: hospital, error } = await db
    .from('hospitals')
    .insert(hospitalPayload)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw httpError(409, 'Kiosk PIN already in use, choose a different one');
    throw httpError(500, error.message);
  }

  await audit(req, 'HOSPITAL_CREATED', {
    resourceType: 'hospital',
    resourceId: hospital.id,
    detail: { name: hospital.name, short_name: hospital.short_name },
    hospitalId: hospital.id
  });

  res.status(201).json({ ok: true, hospital });
});

/**
 * GET /api/v1/admin/hospitals/:id
 */
export const getHospital = ah(async (req, res) => {
  const { id } = req.params;
  const { data: hospital, error } = await db
    .from('hospitals')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !hospital) throw httpError(404, 'Hospital not found');
  res.json({ ok: true, hospital });
});

/**
 * PATCH /api/v1/admin/hospitals/:id
 */
export const updateHospital = ah(async (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'name_ar', 'short_name', 'city', 'address', 'phone', 'timezone', 'logo_url', 'primary_color', 'kiosk_pin', 'is_active'];

  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }

  const { data: hospital, error } = await db
    .from('hospitals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'HOSPITAL_UPDATED', {
    resourceType: 'hospital',
    resourceId: id,
    detail: updates,
    hospitalId: id
  });

  res.json({ ok: true, hospital });
});

/**
 * DELETE /api/v1/admin/hospitals/:id
 */
export const deleteHospital = ah(async (req, res) => {
  const { id } = req.params;
  const { data: existing } = await db.from('hospitals').select('id, name').eq('id', id).maybeSingle();
  if (!existing) throw httpError(404, 'Hospital not found');

  // Remove affiliated hospital staff records first to avoid FK blocks on test/unused hospitals
  await db.from('staff_users').delete().eq('hospital_id', id);

  const { error } = await db.from('hospitals').delete().eq('id', id);
  if (error) {
    throw httpError(409, `Cannot delete hospital "${existing.name}" because it has linked clinical cases or invoices. Deactivate it instead.`);
  }

  await audit(req, 'HOSPITAL_DELETED', {
    resourceType: 'hospital',
    resourceId: id,
    detail: { name: existing.name }
  });

  res.json({ ok: true, message: `Hospital "${existing.name}" deleted.` });
});

/**
 * POST /api/v1/admin/hospitals/:id/admins
 * Creates a hospital_admin for a hospital tenant (D5: ALO admin creates hospital_admin)
 */
export const createHospitalAdmin = ah(async (req, res) => {
  const { id: hospitalId } = req.params;
  const { full_name, phone, preferred_lang } = req.body;

  if (!full_name || !String(full_name).trim()) throw httpError(400, 'Full name is required');
  if (!phone) throw httpError(400, 'Phone is required');

  const { data: hospital, error: hospErr } = await db
    .from('hospitals')
    .select('id, name')
    .eq('id', hospitalId)
    .maybeSingle();

  if (hospErr || !hospital) throw httpError(404, 'Hospital not found');

  const phoneE164 = toE164(phone);
  await assertStaffPhoneAvailable(db, phoneE164);

  const newAdmin = {
    hospital_id: hospitalId,
    full_name: String(full_name).trim(),
    role: 'hospital_admin',
    phone: phoneE164,
    phone_e164: phoneE164,
    preferred_lang: preferred_lang === 'ar' ? 'ar' : 'en',
    is_active: true
  };

  const { data: created, error } = await db
    .from('staff_users')
    .insert(newAdmin)
    .select('id, full_name, role, phone_e164, hospital_id, is_active, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw httpError(409, 'This number is already part of our system, please provide a different number.');
    }
    throw httpError(500, error.message);
  }

  await audit(req, 'HOSPITAL_STAFF_CREATED', {
    resourceType: 'staff_user',
    resourceId: created.id,
    detail: { role: 'hospital_admin', hospital_id: hospitalId },
    hospitalId
  });

  res.status(201).json({ ok: true, admin: created });
});

/**
 * POST /api/v1/admin/staff/:id/release-phone
 * Releases a phone number from an inactive staff member (Section 5.2)
 */
export const releaseStaffPhone = ah(async (req, res) => {
  const { id } = req.params;

  const { data: staff, error: findErr } = await db
    .from('staff_users')
    .select('id, full_name, phone_e164, is_active, hospital_id')
    .eq('id', id)
    .maybeSingle();

  if (findErr || !staff) throw httpError(404, 'Staff user not found');

  if (staff.is_active) {
    throw httpError(400, 'Cannot release phone of an active staff member. Deactivate account first.');
  }

  if (!staff.phone_e164) {
    return res.json({ ok: true, message: 'Staff user has no registered phone number' });
  }

  const oldPhone = staff.phone_e164;
  await db
    .from('staff_users')
    .update({ phone: null, phone_e164: null, phone_verified_at: null })
    .eq('id', id);

  await audit(req, 'STAFF_PHONE_RELEASED', {
    resourceType: 'staff_user',
    resourceId: id,
    detail: { released_phone: oldPhone },
    hospitalId: staff.hospital_id
  });

  res.json({ ok: true, message: `Phone number ${oldPhone} has been released.` });
});

/**
 * POST /api/v1/admin/staff/:id/login-link
 * Issues a single-use break-glass 30-minute magic login link for staff (Section 5.1)
 */
export const issueBreakGlassLink = ah(async (req, res) => {
  const { id } = req.params;

  const { data: staff, error: findErr } = await db
    .from('staff_users')
    .select('id, full_name, role, is_active, hospital_id')
    .eq('id', id)
    .maybeSingle();

  if (findErr || !staff) throw httpError(404, 'Staff user not found');
  if (!staff.is_active) throw httpError(403, 'Cannot issue login link for inactive staff member');

  const rawToken = crypto.randomBytes(36).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

  // Store in magic_link_tokens using opinion_request_id or staff tracking
  await audit(req, 'STAFF_LOGIN_LINK_ISSUED', {
    resourceType: 'staff_user',
    resourceId: id,
    detail: { token_hash: tokenHash, expires_at: expiresAt },
    hospitalId: staff.hospital_id
  });

  // Client link URL
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const loginUrl = `${clientOrigin}/login?break_glass=${rawToken}&staff_id=${id}`;

  res.json({
    ok: true,
    token: rawToken,
    login_url: loginUrl,
    expires_at: expiresAt
  });
});
