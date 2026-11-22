import { db } from '../config/db.js';

export const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// P8 / BR-018: append-only audit. Never updated or deleted by any code path.
export async function audit(req, action, { resourceType = null, resourceId = null, detail = null, actorId, actorRole, hospitalId = null } = {}) {
  await db.from('audit_log').insert({
    actor_id: actorId ?? req?.session?.sub ?? null,
    actor_role: actorRole ?? req?.session?.role ?? 'anonymous',
    action,
    entity_type: resourceType,
    entity_id: resourceId,
    details: detail,
    hospital_id: hospitalId ?? req?.tenant?.id ?? req?.session?.hospital_id ?? null,
    ip_address: req?.ip ?? null
  });
}
