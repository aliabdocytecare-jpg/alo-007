// DEC-056: Hospital Staff Management Controller (hospital_admin scope)
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { toE164, assertStaffPhoneAvailable } from '../lib/phone.js';

const PERMITTED_HOSPITAL_ROLES = ['doctor', 'reception', 'lab', 'pharmacy'];

/**
 * GET /api/v1/hospital/staff
 * Lists all staff members in the current hospital tenant
 */
export const listHospitalStaff = ah(async (req, res) => {
  const { data: staff, error } = await db
    .from('staff_users')
    .select('id, full_name, role, specialty, phone, phone_e164, phone_verified_at, preferred_lang, is_active, created_at')
    .eq('hospital_id', req.tenant.id)
    .order('created_at', { ascending: false });

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, staff });
});

/**
 * POST /api/v1/hospital/staff
 * Creates a new hospital staff member (WhatsApp OTP only; D5, D7, D9)
 */
export const createHospitalStaff = ah(async (req, res) => {
  const { full_name, phone, role, specialty, preferred_lang } = req.body;

  if (!full_name || !String(full_name).trim()) {
    throw httpError(400, 'Full name is required');
  }

  if (!role || !PERMITTED_HOSPITAL_ROLES.includes(role)) {
    throw httpError(400, `Role must be one of: ${PERMITTED_HOSPITAL_ROLES.join(', ')}`);
  }

  const phoneE164 = toE164(phone);
  await assertStaffPhoneAvailable(db, phoneE164);

  const newStaff = {
    hospital_id: req.tenant.id,
    full_name: String(full_name).trim(),
    role,
    specialty: role === 'doctor' ? (specialty || 'General Practice') : null,
    phone: phoneE164,
    phone_e164: phoneE164,
    preferred_lang: preferred_lang === 'ar' ? 'ar' : 'en',
    is_active: true
  };

  const { data: created, error } = await db
    .from('staff_users')
    .insert(newStaff)
    .select('id, full_name, role, specialty, phone_e164, is_active, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw httpError(409, 'This number is already part of our system, please provide a different number.', {
        code: 'phone_taken',
        message_ar: 'هذا الرقم مسجل بالفعل في النظام، يرجى استخدام رقم آخر.'
      });
    }
    throw httpError(500, error.message);
  }

  await audit(req, 'HOSPITAL_STAFF_CREATED', {
    resourceType: 'staff_user',
    resourceId: created.id,
    detail: { role, phone_e164: phoneE164 },
    hospitalId: req.tenant.id
  });

  res.status(201).json({ ok: true, staff: created });
});

/**
 * PATCH /api/v1/hospital/staff/:id
 * Updates staff profile; audits phone change and resets verification if phone changed
 */
export const updateHospitalStaff = ah(async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, specialty, preferred_lang } = req.body;

  const { data: existing, error: findErr } = await db
    .from('staff_users')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !existing) {
    throw httpError(404, 'Staff member not found');
  }

  const updates = {};
  if (full_name) updates.full_name = String(full_name).trim();
  if (specialty !== undefined) updates.specialty = specialty;
  if (preferred_lang) updates.preferred_lang = preferred_lang === 'ar' ? 'ar' : 'en';

  if (phone) {
    const phoneE164 = toE164(phone);
    if (phoneE164 !== existing.phone_e164) {
      await assertStaffPhoneAvailable(db, phoneE164, id);
      updates.phone = phoneE164;
      updates.phone_e164 = phoneE164;
      updates.phone_verified_at = null; // reset verification on phone change

      await audit(req, 'STAFF_PHONE_CHANGED', {
        resourceType: 'staff_user',
        resourceId: id,
        detail: { old: existing.phone_e164, new: phoneE164 },
        hospitalId: req.tenant.id
      });
    }
  }

  const { data: updated, error } = await db
    .from('staff_users')
    .update(updates)
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .select('id, full_name, role, specialty, phone_e164, is_active, preferred_lang')
    .single();

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, staff: updated });
});

/**
 * PATCH /api/v1/hospital/staff/:id/active
 * Activates or deactivates a hospital staff member
 */
export const toggleHospitalStaffActive = ah(async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (id === req.staff.id) {
    throw httpError(400, 'Cannot deactivate your own account');
  }

  const { data: existing, error: findErr } = await db
    .from('staff_users')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !existing) {
    throw httpError(404, 'Staff member not found');
  }

  const active = !!is_active;
  const { data: updated, error } = await db
    .from('staff_users')
    .update({ is_active: active })
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .select('id, full_name, role, is_active')
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, active ? 'HOSPITAL_STAFF_ACTIVATED' : 'HOSPITAL_STAFF_DEACTIVATED', {
    resourceType: 'staff_user',
    resourceId: id,
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, staff: updated });
});

/**
 * GET /api/v1/hospital/doctors
 * Directory of active doctors in the hospital tenant (accessible to all hospital staff)
 */
export const listHospitalDoctors = ah(async (req, res) => {
  const { data: doctors, error } = await db
    .from('staff_users')
    .select('id, full_name, specialty')
    .eq('hospital_id', req.tenant.id)
    .eq('role', 'doctor')
    .eq('is_active', true)
    .order('full_name');

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, doctors });
});
