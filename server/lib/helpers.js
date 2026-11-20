import { db } from '../config/db.js';

export const httpError = (status, message) => Object.assign(new Error(message), { status });
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// P8 / BR-018: append-only audit. Never updated or deleted by any code path.
export async function audit(req, action, { resourceType = null, resourceId = null, detail = null, actorId, actorRole } = {}) {
  await db.from('audit_log').insert({
    actor_id: actorId ?? req?.session?.sub ?? null,
    actor_role: actorRole ?? req?.session?.role ?? 'anonymous',
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    detail,
    ip_address: req?.ip ?? null
  });
}