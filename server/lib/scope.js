// DEC-056: Multi-tenant scoping and case loading helpers
import { db } from '../config/db.js';
import { httpError } from './helpers.js';

/**
 * Returns a Supabase query builder pre-scoped to the active hospital tenant.
 * Guarantees that no hospital can ever read or mutate another hospital's data.
 */
export function scoped(req, table) {
  if (!req?.tenant?.id) {
    throw httpError(500, 'Tenant context is missing for scoped query');
  }
  return db.from(table).select().eq('hospital_id', req.tenant.id);
}

/**
 * Middleware that loads a hospital case by ID and asserts it belongs to the current tenant.
 * Mismatch returns 404 (Not Found) rather than 403 to prevent cross-tenant existence probing.
 */
export async function loadHospitalCase(req, res, next) {
  try {
    const caseId = req.params.id || req.params.caseId;
    if (!caseId) {
      return res.status(400).json({ error: 'case_id is required' });
    }

    if (!req.tenant?.id) {
      return res.status(500).json({ error: 'Tenant context missing' });
    }

    const { data: c, error } = await db
      .from('hospital_cases')
      .select('*')
      .eq('id', caseId)
      .eq('hospital_id', req.tenant.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!c) {
      return res.status(404).json({ error: 'Case not found' });
    }

    req.hospitalCase = c;
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Strips clinical notes from hospital case for non-clinical roles (reception, lab, pharmacy).
 */
export function sanitizeHospitalCaseForRole(caseRecord, role) {
  if (!caseRecord) return null;
  const nonClinicalRoles = ['reception', 'lab', 'pharmacy'];
  if (nonClinicalRoles.includes(role)) {
    const copy = { ...caseRecord };
    delete copy.doctor_opinion;
    delete copy.nurse_interview_summary;
    delete copy.patient_question;
    return copy;
  }
  return caseRecord;
}
