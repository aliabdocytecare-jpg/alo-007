// Middleware pipeline step 3-4 (Blueprint §2): session resolver + RBAC guard.
// DEC-014 / DEC-056: HttpOnly JWT cookie, sliding expiry, staff is_active re-check per request.
import jwt from 'jsonwebtoken';
import { db } from '../config/db.js';
import { audit } from '../lib/helpers.js';

export const COOKIE = 'alodoc_session';
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
// DEC-039: fail fast — never boot production with a forgeable secret or mock auth.
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production.');
  }
  if (process.env.ENABLE_MOCK_AUTH === 'true') {
    throw new Error('ENABLE_MOCK_AUTH must not be true in production (mock OTP 123456 would be live).');
  }
}
export const PATIENT_TTL = 30 * 86400_000; // F-AUTH-02: 30 days
export const STAFF_TTL = 8 * 3600_000;     // F-AUTH-03: 8 hours

export function issueSession(res, { sub, role, kind, hospital_id = null }, maxAgeMs) {
  const token = jwt.sign({ sub, role, kind, hospital_id }, SECRET, { expiresIn: Math.floor(maxAgeMs / 1000) });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.NODE_ENV === 'production', maxAge: maxAgeMs
  });
}

export function resolveSession(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      req.session = {
        sub: payload.sub,
        role: payload.role,
        kind: payload.kind,
        hospital_id: payload.hospital_id || null
      };
      const maxAge = req.session.kind === 'patient' ? PATIENT_TTL : STAFF_TTL;
      issueSession(res, req.session, maxAge); // refreshed on activity
    } catch { /* expired/invalid -> anonymous */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
      if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
      if (req.session.kind === 'staff') {
        const { data: s } = await db.from('staff_users').select().eq('id', req.session.sub).maybeSingle();
        // Part 8.1: deactivated mid-session -> 401 on next call.
        if (!s?.is_active) return res.status(401).json({ error: 'account_inactive' });
      }
      next();
    } catch (e) { next(e); }
  };
}

export async function loadCase(req, res, next) {
  try {
    const { data: c } = await db.from('cases').select().eq('id', req.params.id).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Case not found' });
    req.case = c;
    next();
  } catch (e) { next(e); }
}

// BR-003/004/005/010: strict case scoping; denied attempts audited (Test E1-E3).
export async function requireCaseAccess(req, res, next) {
  try {
    const s = req.session, c = req.case;
    let ok = false;
    if (s.role === 'patient') ok = c.patient_id === s.sub;
    else if (s.role === 'coordinator' || s.role === 'admin') ok = true;
    else {
      const { data } = await db.from('case_assignments').select()
        .eq('case_id', c.id).eq('staff_id', s.sub).limit(1);
      ok = !!data?.length;
    }
    if (!ok) {
      await audit(req, 'CASE_ACCESS_DENIED', { resourceType: 'case', resourceId: c.id });
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  } catch (e) { next(e); }
}

export const caseGuard = [requireAuth, loadCase, requireCaseAccess];
