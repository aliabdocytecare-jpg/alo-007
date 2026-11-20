// F-AUTH-04 / BR-006..009 / BR-024 (DEC-015): 48-char tokens, SHA-256 at rest, 72h TTL.
import crypto from 'crypto';
import { db } from '../config/db.js';

export const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

export async function issueLink(caseId, specialistName, specialistPhone, createdBy) {
  await revokeActiveLinks(caseId); // BR-024: each resend invalidates the previous token
  const token = crypto.randomBytes(36).toString('base64url'); // exactly 48 URL-safe chars
  const { data, error } = await db.from('magic_link_tokens').insert({
    token_hash: hashToken(token), case_id: caseId,
    specialist_name: specialistName, specialist_phone: specialistPhone,
    created_by: createdBy,
    expires_at: new Date(Date.now() + 72 * 3600_000).toISOString() // BR-007
  }).select().single();
  if (error) throw new Error(error.message);
  return { token, record: data };
}

export async function revokeActiveLinks(caseId) {
  await db.from('magic_link_tokens').update({ revoked_at: new Date().toISOString() })
    .eq('case_id', caseId).is('revoked_at', null);
}

// Validated on EVERY request: exists + not revoked + not expired.
export async function verifyToken(token) {
  if (!token || token.length !== 48) return { ok: false, reason: 'invalid' };
  const { data: t } = await db.from('magic_link_tokens').select().eq('token_hash', hashToken(token)).maybeSingle();
  if (!t) return { ok: false, reason: 'invalid' };
  if (t.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(t.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, token: t };
}