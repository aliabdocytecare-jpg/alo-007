// DEC-056: Canonical phone normalization and staff phone availability verification
import { httpError } from './helpers.js';

export const PHONE_E164_RE = /^\+[1-9]\d{7,14}$/;
export const SAUDI_MOBILE_RE = /^\+9665\d{8}$/;

/**
 * Normalizes user input into a canonical E.164 string.
 * Supports Saudi local numbers (05XXXXXXXX -> +9665XXXXXXXX) and international formats.
 */
export function toE164(input, defaultCountry = 'SA') {
  if (!input || typeof input !== 'string') {
    throw httpError(400, 'Phone number is required');
  }

  let cleaned = input.trim().replace(/[\s\-\(\)\.]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  if (defaultCountry === 'SA') {
    if (cleaned.startsWith('05') && cleaned.length === 10) {
      cleaned = '+966' + cleaned.slice(1);
    } else if (cleaned.startsWith('5') && cleaned.length === 9) {
      cleaned = '+966' + cleaned;
    } else if (cleaned.startsWith('9665') && cleaned.length === 12) {
      cleaned = '+' + cleaned;
    }
  }

  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  if (!PHONE_E164_RE.test(cleaned)) {
    throw httpError(400, 'Enter a valid mobile number in international format, e.g. +9665XXXXXXXX');
  }

  return cleaned;
}

/**
 * Checks if a string is a valid E.164 phone number.
 */
export function isValidPhone(input) {
  try {
    toE164(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asserts that a normalized phone number is available across all staff accounts.
 * Throws HTTP 409 with the locked multi-tenant protection message if taken.
 */
export async function assertStaffPhoneAvailable(db, phoneE164, excludeStaffId = null) {
  let query = db.from('staff_users').select('id, hospital_id, is_active').eq('phone_e164', phoneE164);
  if (excludeStaffId) {
    query = query.neq('id', excludeStaffId);
  }

  const { data: existing, error } = await query.maybeSingle();
  if (error) {
    throw httpError(500, `Database error during phone availability check: ${error.message}`);
  }

  if (existing) {
    // D10: Message must never name the other hospital, identical for active and inactive holders
    throw httpError(409, 'This number is already part of our system, please provide a different number.', {
      code: 'phone_taken',
      message_ar: 'هذا الرقم مسجل بالفعل في النظام، يرجى استخدام رقم آخر.'
    });
  }

  return true;
}
