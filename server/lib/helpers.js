import { db } from '../config/db.js';

export const httpError = (status, message, extra = {}) => {
  const extraObj = typeof extra === 'string' ? { code: extra } : (extra || {});
  return Object.assign(new Error(message), { status, ...extraObj });
};
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// P8 / BR-018: append-only audit. Never updated or deleted by any code path.
export async function audit(req, action, { resourceType = null, resourceId = null, detail = null, actorId, actorRole, hospitalId = null } = {}) {
  const enrichedDetail = req?.clientInfo
    ? {
        ...(typeof detail === 'object' && detail !== null ? detail : (detail !== null && detail !== undefined ? { value: detail } : {})),
        client: req.clientInfo
      }
    : detail;

  await db.from('audit_log').insert({
    actor_id: actorId ?? req?.session?.sub ?? null,
    actor_role: actorRole ?? req?.session?.role ?? 'anonymous',
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    detail: enrichedDetail,
    hospital_id: hospitalId ?? req?.tenant?.id ?? req?.session?.hospital_id ?? null,
    ip_address: req?.ip ?? null
  });
}
