// DEC-056: Hospital Slot & Template Management Controller
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { generateSlotsForHospital } from '../services/hospitalSlotService.js';

/**
 * GET /api/v1/hospital/slots
 * Returns slots for the tenant, filterable by date, doctor_id, and status
 */
export const listHospitalSlots = ah(async (req, res) => {
  const { date, doctor_id, status } = req.query;

  let query = db
    .from('hospital_slots')
    .select('id, doctor_id, date, time, duration_min, status, hospital_case_id, booked_at')
    .eq('hospital_id', req.tenant.id)
    .order('date')
    .order('time');

  if (date) query = query.eq('date', date);
  if (doctor_id) query = query.eq('doctor_id', doctor_id);
  if (status) query = query.eq('status', status);

  const { data: slots, error } = await query;
  if (error) throw httpError(500, error.message);

  // Enrich with doctor names
  const { data: doctors } = await db
    .from('staff_users')
    .select('id, full_name, specialty')
    .eq('hospital_id', req.tenant.id);

  const docMap = Object.fromEntries((doctors || []).map(d => [d.id, d]));
  const enriched = (slots || []).map(s => ({
    ...s,
    doctor: docMap[s.doctor_id] || null
  }));

  res.json({ ok: true, slots: enriched });
});

/**
 * POST /api/v1/hospital/slots/generate
 * Triggers slot generation for tenant templates
 */
export const triggerSlotGeneration = ah(async (req, res) => {
  const { horizon_days, doctor_id } = req.body;
  const result = await generateSlotsForHospital(req.tenant.id, {
    horizonDays: horizon_days ? parseInt(horizon_days, 10) : undefined,
    doctorId: doctor_id || null
  });

  await audit(req, 'SLOT_GENERATED', {
    detail: { hospital_id: req.tenant.id, generated: result.generated },
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, generated: result.generated });
});

/**
 * POST /api/v1/hospital/slots/:id/block
 */
export const blockSlot = ah(async (req, res) => {
  const { id } = req.params;

  const { data: slot, error: findErr } = await db
    .from('hospital_slots')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !slot) throw httpError(404, 'Slot not found');
  if (slot.status === 'booked') throw httpError(400, 'Cannot block an already booked slot');

  const { data: updated, error } = await db
    .from('hospital_slots')
    .update({ status: 'blocked' })
    .eq('id', id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'SLOT_BLOCKED', {
    resourceType: 'hospital_slot',
    resourceId: id,
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, slot: updated });
});

/**
 * POST /api/v1/hospital/slots/:id/release
 */
export const releaseSlot = ah(async (req, res) => {
  const { id } = req.params;

  const { data: slot, error: findErr } = await db
    .from('hospital_slots')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !slot) throw httpError(404, 'Slot not found');

  const { data: updated, error } = await db
    .from('hospital_slots')
    .update({ status: 'released', released_at: new Date().toISOString(), hospital_case_id: null })
    .eq('id', id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'SLOT_RELEASED', {
    resourceType: 'hospital_slot',
    resourceId: id,
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, slot: updated });
});

/**
 * GET /api/v1/hospital/slot-templates
 */
export const listSlotTemplates = ah(async (req, res) => {
  const { data: templates, error } = await db
    .from('hospital_slot_templates')
    .select('*')
    .eq('hospital_id', req.tenant.id)
    .order('created_at', { ascending: false });

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, templates });
});

/**
 * POST /api/v1/hospital/slot-templates
 */
export const createSlotTemplate = ah(async (req, res) => {
  const { doctor_id, weekdays, times, duration_min, valid_from, valid_to } = req.body;

  if (!doctor_id) throw httpError(400, 'doctor_id is required');
  if (!Array.isArray(times) || !times.length) throw httpError(400, 'times array is required');

  const payload = {
    hospital_id: req.tenant.id,
    doctor_id,
    weekdays: Array.isArray(weekdays) ? weekdays : [0, 1, 2, 3, 4],
    times,
    duration_min: duration_min ? parseInt(duration_min, 10) : 30,
    valid_from: valid_from || null,
    valid_to: valid_to || null,
    active: true
  };

  const { data: created, error } = await db
    .from('hospital_slot_templates')
    .insert(payload)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  // Auto-generate slots for this new template immediately
  await generateSlotsForHospital(req.tenant.id, { doctorId: doctor_id });

  res.status(201).json({ ok: true, template: created });
});

/**
 * PATCH /api/v1/hospital/slot-templates/:id
 */
export const updateSlotTemplate = ah(async (req, res) => {
  const { id } = req.params;
  const allowed = ['weekdays', 'times', 'duration_min', 'active', 'valid_from', 'valid_to'];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }

  const { data: updated, error } = await db
    .from('hospital_slot_templates')
    .update(patch)
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, template: updated });
});
