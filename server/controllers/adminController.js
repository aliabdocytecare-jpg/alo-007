// Admin domain — US-ADM-001..007, BR-018/022/026/030. Plus notifications for all roles.
import bcrypt from 'bcryptjs';
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';

const PW_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/; // F-AUTH-03 policy

export const listStaff = ah(async (req, res) => {
  const { data } = await db.from('staff_users').select().order('created_at');
  res.json((data || []).map(({ password_hash, ...s }) => s));
});

// BR-030: staff created only by admin. DEC-010: initial password set by admin.
export const createStaff = ah(async (req, res) => {
  const { full_name, role, email, phone, password, specialty } = req.body;
  if (!full_name?.trim() || !email?.trim()) throw httpError(400, 'Full name and email are required.');
  if (!['nurse', 'coordinator', 'doctor', 'admin'].includes(role)) throw httpError(400, 'Invalid role.');
  if (!PW_RE.test(password || '')) throw httpError(400, 'Password must be at least 10 characters with 1 uppercase letter, 1 number, and 1 special character.');
  const { data, error } = await db.from('staff_users').insert({
    full_name: full_name.trim(), role, email: email.trim().toLowerCase(),
    phone: phone || null, specialty: specialty || null,
    password_hash: await bcrypt.hash(password, 10)
  }).select().single();
  if (error) throw httpError(409, 'A staff account with this email already exists.');
  await audit(req, 'STAFF_CREATED', { resourceType: 'staff', resourceId: data.id, detail: { role, email: data.email } });
  const { password_hash, ...safe } = data;
  res.status(201).json(safe);
});

// US-ADM-001 AC3: deactivate without deleting.
export const setStaffActive = ah(async (req, res) => {
  const { is_active } = req.body;
  await db.from('staff_users').update({ is_active: !!is_active }).eq('id', req.params.id);
  await audit(req, is_active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED', { resourceType: 'staff', resourceId: req.params.id });
  res.json({ ok: true });
});

export const listFormularyAdmin = ah(async (req, res) => {
  const { data } = await db.from('drug_formulary').select().order('generic_name');
  res.json(data || []);
});

export const createDrug = ah(async (req, res) => {
  const { generic_name, brand_name, common_dosages, route } = req.body;
  if (!generic_name?.trim()) throw httpError(400, 'Generic name is required.');
  const { data, error } = await db.from('drug_formulary').insert({
    generic_name: generic_name.trim(), brand_name: brand_name || null,
    common_dosages: common_dosages || [], route: route || null
  }).select().single();
  if (error) throw httpError(500, error.message);
  await audit(req, 'FORMULARY_ADDED', { resourceType: 'drug', resourceId: data.id });
  res.status(201).json(data);
});

// BR-022: deactivation hides drug immediately; existing prescriptions untouched.
export const updateDrug = ah(async (req, res) => {
  const patch = {};
  for (const k of ['generic_name', 'brand_name', 'common_dosages', 'route', 'is_active']) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  await db.from('drug_formulary').update(patch).eq('id', req.params.id);
  await audit(req, 'FORMULARY_UPDATED', { resourceType: 'drug', resourceId: req.params.id, detail: patch });
  res.json({ ok: true });
});

export const listServices = ah(async (req, res) => {
  const { data } = await db.from('services').select().order('name_en');
  res.json(data || []);
});

// US-ADM-003 / BR-026: catalog toggles incl. Coming Soon.
export const updateService = ah(async (req, res) => {
  const patch = {};
  if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
  if (req.body.coming_soon !== undefined) patch.coming_soon = !!req.body.coming_soon;
  await db.from('services').update(patch).eq('id', req.params.id);
  await audit(req, 'SERVICE_UPDATED', { resourceType: 'service', resourceId: req.params.id, detail: patch });
  res.json({ ok: true });
});

export const listSla = ah(async (req, res) => {
  const { data } = await db.from('sla_config').select().order('status');
  res.json(data || []);
});

// US-ADM-005: changes audited; apply to cases entering the status afterwards.
export const updateSla = ah(async (req, res) => {
  const minutes = Number(req.body.target_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) throw httpError(400, 'Target minutes must be a positive number.');
  await db.from('sla_config').update({ target_minutes: minutes, updated_by: req.session.sub, updated_at: new Date().toISOString() }).eq('status', req.params.status);
  await audit(req, 'SLA_UPDATED', { detail: { status: req.params.status, target_minutes: minutes } });
  res.json({ ok: true });
});

// US-ADM-004 / BR-018: read-only, filterable. No update/delete endpoints exist.
export const listAudit = ah(async (req, res) => {
  let q = db.from('audit_log').select().order('created_at', { ascending: false }).limit(200);
  if (req.query.action) q = q.eq('action', req.query.action);
  if (req.query.actor_role) q = q.eq('actor_role', req.query.actor_role);
  if (req.query.resource_id) q = q.eq('resource_id', req.query.resource_id);
  if (req.query.from) q = q.gte('created_at', req.query.from);
  if (req.query.to) q = q.lte('created_at', req.query.to);
  const { data } = await q;
  res.json(data || []);
});

export const listNotifications = ah(async (req, res) => {
  const type = req.session.kind === 'patient' ? 'patient' : 'staff';
  const { data } = await db.from('notifications').select()
    .eq('recipient_type', type).eq('recipient_id', req.session.sub)
    .order('created_at', { ascending: false }).limit(100);
  const rows = data || [];
  res.json({ items: rows, unread: rows.filter(n => !n.is_read).length });
});

export const readNotification = ah(async (req, res) => {
  await db.from('notifications').update({ is_read: true })
    .eq('id', req.params.id).eq('recipient_id', req.session.sub);
  res.json({ ok: true });
});

export const publicSettings = ah(async (req, res) => {
  const { data } = await db.from('system_settings').select();
  const map = Object.fromEntries((data || []).map(s => [s.key, s.value]));
  res.json({ meet_visibility_hours: Number(map.meet_visibility_hours || 2) });
});