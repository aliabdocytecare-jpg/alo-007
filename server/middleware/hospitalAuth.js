// DEC-056: Multi-tenant hospital authorization and role guards
import { db } from '../config/db.js';

/**
 * Ensures the authenticated user is an active member of an active hospital tenant.
 * Re-reads the staff row on each request so deactivation takes effect immediately.
 */
export async function requireHospitalMember(req, res, next) {
  try {
    if (!req.session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.session.kind !== 'staff') {
      return res.status(403).json({ error: 'Forbidden: staff account required' });
    }

    // Re-read staff row by primary key (P8 / DEC-014 / DEC-056)
    const { data: staff, error: staffErr } = await db
      .from('staff_users')
      .select('*')
      .eq('id', req.session.sub)
      .maybeSingle();

    if (staffErr || !staff) {
      return res.status(401).json({ error: 'staff_not_found', message: 'Staff profile not found' });
    }

    if (!staff.is_active) {
      return res.status(401).json({ error: 'account_inactive', message: 'Account is deactivated' });
    }

    if (!staff.hospital_id) {
      return res.status(403).json({ error: 'not_hospital_staff', message: 'Hospital affiliation required' });
    }

    // Verify hospital active status
    const { data: hospital, error: hospErr } = await db
      .from('hospitals')
      .select('*')
      .eq('id', staff.hospital_id)
      .maybeSingle();

    if (hospErr || !hospital) {
      return res.status(404).json({ error: 'hospital_not_found', message: 'Associated hospital not found' });
    }

    if (!hospital.is_active) {
      return res.status(403).json({ error: 'hospital_inactive', message: 'This hospital is currently inactive' });
    }

    req.tenant = hospital;
    req.staff = staff;
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Restricts access to specified roles within the active hospital tenant.
 */
export function requireHospitalRole(...roles) {
  return (req, res, next) => {
    if (!req.staff) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!roles.includes(req.staff.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Role ${req.staff.role} is not permitted. Allowed: ${roles.join(', ')}`
      });
    }

    next();
  };
}

/**
 * Restricts access strictly to ALO platform staff (admin, coordinator, nurse, doctor).
 * Rejects any hospital-affiliated staff member (D8: hospital_admin is never granted ALO semantics).
 */
export async function requireALOStaff(req, res, next) {
  try {
    if (!req.session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.session.kind !== 'staff') {
      return res.status(403).json({ error: 'Forbidden: staff only' });
    }

    if (req.session.hospital_id) {
      return res.status(403).json({ error: 'Forbidden: ALO platform staff only' });
    }

    const aloRoles = ['admin', 'coordinator', 'nurse', 'doctor'];
    if (!aloRoles.includes(req.session.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: staff, error } = await db
      .from('staff_users')
      .select('*')
      .eq('id', req.session.sub)
      .maybeSingle();

    if (error || !staff || !staff.is_active || staff.hospital_id) {
      return res.status(401).json({ error: 'account_inactive' });
    }

    req.staff = staff;
    next();
  } catch (e) {
    next(e);
  }
}
