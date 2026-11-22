// DEC-056: Reception Operations Controller (Queue, Check-in, Appointment Decisions)
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';

/**
 * Calculates next daily queue number for a hospital (e.g. A-001, A-002)
 */
async function getNextDailyQueueNumber(hospitalId) {
  const todayStr = new Date().toISOString().split('T')[0];
  const { data: todayCases } = await db
    .from('hospital_cases')
    .select('queue_number')
    .eq('hospital_id', hospitalId)
    .not('queue_number', 'is', null)
    .gte('arrived_at', `${todayStr}T00:00:00.000Z`);

  const count = (todayCases || []).length;
  const num = String(count + 1).padStart(3, '0');
  return `A-${num}`;
}

/**
 * GET /api/v1/hospital/reception/queue
 * Returns today's active clinic queue grouped by arrival status
 */
export const getReceptionQueue = ah(async (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: cases, error } = await db
    .from('hospital_cases')
    .select(`
      id, case_number, checkin_code, queue_number, status, arrival_status,
      arrived_at, in_clinic_at, appointment_date, appointment_time,
      hospital_patient_id, assigned_doctor_id, requested_specialty, service_type
    `)
    .eq('hospital_id', req.tenant.id)
    .or(`appointment_date.eq.${todayStr},arrived_at.gte.${todayStr}T00:00:00.000Z`)
    .order('queue_number', { nullsFirst: false });

  if (error) throw httpError(500, error.message);

  // Enrich with patient and doctor names
  const patientIds = [...new Set((cases || []).map(c => c.hospital_patient_id).filter(Boolean))];
  const doctorIds = [...new Set((cases || []).map(c => c.assigned_doctor_id).filter(Boolean))];

  const { data: patients } = patientIds.length
    ? await db.from('hospital_patients').select('id, full_name, mrn, phone').in('id', patientIds)
    : { data: [] };

  const { data: doctors } = doctorIds.length
    ? await db.from('staff_users').select('id, full_name, specialty').in('id', doctorIds)
    : { data: [] };

  const patientMap = Object.fromEntries((patients || []).map(p => [p.id, p]));
  const docMap = Object.fromEntries((doctors || []).map(d => [d.id, d]));

  const enriched = (cases || []).map(c => ({
    ...c,
    patient: patientMap[c.hospital_patient_id] || null,
    doctor: docMap[c.assigned_doctor_id] || null
  }));

  const queue = {
    scheduled: enriched.filter(c => c.arrival_status === 'scheduled'),
    arrived: enriched.filter(c => c.arrival_status === 'arrived'),
    in_clinic: enriched.filter(c => c.arrival_status === 'in_clinic'),
    done: enriched.filter(c => c.arrival_status === 'done' || c.status === 'completed')
  };

  res.json({ ok: true, queue, raw: enriched });
});

/**
 * POST /api/v1/hospital/reception/checkin
 * Checks in patient by checkin_code or case_id and issues daily queue number
 */
export const checkinPatient = ah(async (req, res) => {
  const { checkin_code, case_id } = req.body;

  if (!checkin_code && !case_id) {
    throw httpError(400, 'checkin_code or case_id is required');
  }

  let query = db.from('hospital_cases').select('*').eq('hospital_id', req.tenant.id);
  if (checkin_code) query = query.eq('checkin_code', String(checkin_code).trim().toUpperCase());
  else query = query.eq('id', case_id);

  const { data: c, error } = await query.maybeSingle();
  if (error || !c) throw httpError(404, 'Case not found with this check-in code');

  // If already checked in today, return existing queue number
  if (c.queue_number && (c.arrival_status === 'arrived' || c.arrival_status === 'in_clinic')) {
    return res.json({
      ok: true,
      already_checked_in: true,
      queue_number: c.queue_number,
      case_id: c.id,
      arrival_status: c.arrival_status
    });
  }

  const queueNumber = await getNextDailyQueueNumber(req.tenant.id);
  const nowIso = new Date().toISOString();

  const { data: updated, error: updateErr } = await db
    .from('hospital_cases')
    .update({
      queue_number: queueNumber,
      arrival_status: 'arrived',
      arrived_at: nowIso
    })
    .eq('id', c.id)
    .select()
    .single();

  if (updateErr) throw httpError(500, updateErr.message);

  // Timeline
  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: c.id,
    from_status: c.status,
    to_status: c.status,
    arrival_status: 'arrived',
    actor_id: req.staff?.id || null,
    actor_role: req.staff?.role || 'reception',
    note: `Checked in at reception. Assigned queue #${queueNumber}`
  });

  await audit(req, 'HOSPITAL_CHECKIN', {
    resourceType: 'hospital_case',
    resourceId: c.id,
    detail: { checkin_code: c.checkin_code, queue_number: queueNumber },
    hospitalId: req.tenant.id
  });

  res.json({
    ok: true,
    case_id: c.id,
    case_number: c.case_number,
    queue_number: queueNumber,
    arrival_status: 'arrived',
    arrived_at: nowIso
  });
});

/**
 * POST /api/v1/hospital/reception/arrival
 * Updates arrival status (e.g. calling patient into clinic or marking done)
 */
export const updateArrivalStatus = ah(async (req, res) => {
  const { case_id, arrival_status, note } = req.body;
  const allowed = ['scheduled', 'arrived', 'in_clinic', 'done', 'no_show'];

  if (!case_id || !arrival_status || !allowed.includes(arrival_status)) {
    throw httpError(400, `Valid case_id and arrival_status (${allowed.join(', ')}) required`);
  }

  const { data: c, error: findErr } = await db
    .from('hospital_cases')
    .select('*')
    .eq('id', case_id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !c) throw httpError(404, 'Case not found');

  const patch = { arrival_status };
  const nowIso = new Date().toISOString();
  if (arrival_status === 'in_clinic' && !c.in_clinic_at) patch.in_clinic_at = nowIso;
  if (arrival_status === 'done') patch.status = 'completed';

  const { data: updated, error } = await db
    .from('hospital_cases')
    .update(patch)
    .eq('id', case_id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: case_id,
    from_status: c.status,
    to_status: updated.status,
    arrival_status,
    actor_id: req.staff?.id || null,
    actor_role: req.staff?.role || 'reception',
    note: note || `Status updated to ${arrival_status}`
  });

  res.json({ ok: true, case: updated });
});

/**
 * GET /api/v1/hospital/appointment-requests
 */
export const listAppointmentRequests = ah(async (req, res) => {
  const { status } = req.query;
  let query = db
    .from('hospital_appointment_requests')
    .select('*')
    .eq('hospital_id', req.tenant.id)
    .order('due_at');

  if (status) query = query.eq('status', status);

  const { data: requests, error } = await query;
  if (error) throw httpError(500, error.message);

  res.json({ ok: true, requests });
});

/**
 * POST /api/v1/hospital/appointment-requests/:id/decision
 * Reception appointment decision within 2h SLA (confirm, propose, decline)
 */
export const makeAppointmentDecision = ah(async (req, res) => {
  const { id } = req.params;
  const { decision, date, time, slot_id, decline_reason, proposed_date, proposed_time } = req.body;

  if (!['confirm', 'propose', 'decline'].includes(decision)) {
    throw httpError(400, 'decision must be confirm, propose, or decline');
  }

  const { data: reqItem, error: findErr } = await db
    .from('hospital_appointment_requests')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !reqItem) throw httpError(404, 'Appointment request not found');

  const patch = { handled_by: req.staff?.id || null };

  if (decision === 'confirm') {
    if (!date || !time) throw httpError(400, 'date and time required to confirm');
    patch.status = 'confirmed';
    patch.confirmed_date = date;
    patch.confirmed_time = time;

    // Update case appointment date/time
    await db.from('hospital_cases').update({
      appointment_date: date,
      appointment_time: time
    }).eq('id', reqItem.hospital_case_id);

    // Book slot if given
    if (slot_id) {
      await db.from('hospital_slots').update({
        status: 'booked',
        hospital_case_id: reqItem.hospital_case_id,
        booked_at: new Date().toISOString()
      }).eq('id', slot_id);
    }
  } else if (decision === 'propose') {
    if (!proposed_date) throw httpError(400, 'proposed_date required');
    patch.status = 'proposed';
    patch.proposed_date = proposed_date;
    patch.proposed_time = proposed_time || null;
  } else if (decision === 'decline') {
    patch.status = 'declined';
    patch.decline_reason = decline_reason || 'No availability';
  }

  const { data: updated, error } = await db
    .from('hospital_appointment_requests')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  await audit(req, 'APPT_DECISION', {
    resourceType: 'hospital_appointment_request',
    resourceId: id,
    detail: { decision, status: updated.status },
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, request: updated });
});
