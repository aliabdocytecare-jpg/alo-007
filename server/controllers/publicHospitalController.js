// DEC-056: Public Hospital Endpoints (Kiosk, Waiting Screen, Patient Status Page)
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';

/**
 * Helper to extract first name for patient privacy
 */
function getFirstName(fullName) {
  if (!fullName) return '';
  return String(fullName).trim().split(/\s+/)[0];
}

/**
 * GET /api/v1/public/kiosk/:pin
 * Pairs a physical kiosk device to its hospital tenant
 */
export const getKioskConfig = ah(async (req, res) => {
  const { pin } = req.params;
  if (!pin) throw httpError(400, 'PIN required');

  const { data: hosp, error } = await db
    .from('hospitals')
    .select('id, name, name_ar, short_name, city, address, logo_url, primary_color, is_active')
    .eq('kiosk_pin', pin.trim())
    .maybeSingle();

  if (error || !hosp || !hosp.is_active) {
    throw httpError(404, 'Invalid or inactive kiosk PIN');
  }

  // Active doctors list for kiosk
  const { data: doctors } = await db
    .from('staff_users')
    .select('id, full_name, specialty')
    .eq('hospital_id', hosp.id)
    .eq('role', 'doctor')
    .eq('is_active', true);

  res.json({
    ok: true,
    hospital: hosp,
    doctors: doctors || []
  });
});

/**
 * POST /api/v1/public/kiosk/:pin/checkin
 * Kiosk patient check-in by 6-character checkin_code
 */
export const kioskCheckin = ah(async (req, res) => {
  const { pin } = req.params;
  const { checkin_code } = req.body;

  if (!checkin_code) throw httpError(400, 'checkin_code is required');

  const { data: hosp } = await db
    .from('hospitals')
    .select('id, name')
    .eq('kiosk_pin', pin.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (!hosp) throw httpError(404, 'Invalid kiosk pairing');

  const cleanCode = String(checkin_code).trim().toUpperCase();
  const { data: c, error } = await db
    .from('hospital_cases')
    .select('id, case_number, checkin_code, queue_number, arrival_status, hospital_patient_id, assigned_doctor_id')
    .eq('hospital_id', hosp.id)
    .eq('checkin_code', cleanCode)
    .maybeSingle();

  if (error || !c) {
    throw httpError(404, 'Check-in code not recognized. Please visit reception.');
  }

  // Fetch patient first name
  const { data: patient } = await db
    .from('hospital_patients')
    .select('full_name')
    .eq('id', c.hospital_patient_id)
    .maybeSingle();

  // Fetch doctor name
  const { data: doctor } = c.assigned_doctor_id
    ? await db.from('staff_users').select('full_name').eq('id', c.assigned_doctor_id).maybeSingle()
    : { data: null };

  const firstName = getFirstName(patient?.full_name);

  // If already checked in
  if (c.queue_number && (c.arrival_status === 'arrived' || c.arrival_status === 'in_clinic')) {
    return res.json({
      ok: true,
      already_checked_in: true,
      queue_number: c.queue_number,
      patient_first_name: firstName,
      doctor_name: doctor?.full_name || null
    });
  }

  // Calculate next queue number
  const todayStr = new Date().toISOString().split('T')[0];
  const { data: todayCases } = await db
    .from('hospital_cases')
    .select('queue_number')
    .eq('hospital_id', hosp.id)
    .not('queue_number', 'is', null)
    .gte('arrived_at', `${todayStr}T00:00:00.000Z`);

  const count = (todayCases || []).length;
  const queueNumber = `A-${String(count + 1).padStart(3, '0')}`;
  const nowIso = new Date().toISOString();

  await db
    .from('hospital_cases')
    .update({
      queue_number: queueNumber,
      arrival_status: 'arrived',
      arrived_at: nowIso
    })
    .eq('id', c.id);

  // Timeline
  await db.from('hospital_case_timeline').insert({
    hospital_id: hosp.id,
    hospital_case_id: c.id,
    from_status: 'new',
    to_status: 'new',
    arrival_status: 'arrived',
    actor_role: 'kiosk',
    note: `Checked in via self-service kiosk. Queue #${queueNumber}`
  });

  res.json({
    ok: true,
    queue_number: queueNumber,
    patient_first_name: firstName,
    doctor_name: doctor?.full_name || null
  });
});

/**
 * GET /api/v1/public/case/:code
 * Public patient status view (/p/:code) — strictly minimal non-clinical information
 */
export const getPublicCaseStatus = ah(async (req, res) => {
  const { code } = req.params;
  if (!code) throw httpError(400, 'Code required');

  const cleanCode = String(code).trim().toUpperCase();
  const { data: c, error } = await db
    .from('hospital_cases')
    .select(`
      id, case_number, checkin_code, queue_number, arrival_status,
      appointment_date, appointment_time, hospital_id, hospital_patient_id, assigned_doctor_id
    `)
    .eq('checkin_code', cleanCode)
    .maybeSingle();

  if (error || !c) throw httpError(404, 'Case not found');

  const { data: hosp } = await db
    .from('hospitals')
    .select('name, name_ar, city, logo_url')
    .eq('id', c.hospital_id)
    .single();

  const { data: patient } = await db
    .from('hospital_patients')
    .select('full_name')
    .eq('id', c.hospital_patient_id)
    .single();

  const { data: doctor } = c.assigned_doctor_id
    ? await db.from('staff_users').select('full_name, specialty').eq('id', c.assigned_doctor_id).maybeSingle()
    : { data: null };

  res.json({
    ok: true,
    case_number: c.case_number,
    patient_first_name: getFirstName(patient?.full_name),
    doctor_name: doctor?.full_name || null,
    specialty: doctor?.specialty || null,
    appointment_date: c.appointment_date,
    appointment_time: c.appointment_time,
    arrival_status: c.arrival_status,
    queue_number: c.queue_number,
    hospital: hosp
  });
});

/**
 * GET /api/v1/public/screen/:pin/waiting
 * Waiting room TV queue display feed
 */
export const getWaitingScreenFeed = ah(async (req, res) => {
  const { pin } = req.params;

  const { data: hosp } = await db
    .from('hospitals')
    .select('id, name, name_ar, logo_url, primary_color')
    .eq('kiosk_pin', pin.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (!hosp) throw httpError(404, 'Invalid screen pairing PIN');

  const todayStr = new Date().toISOString().split('T')[0];

  const { data: cases } = await db
    .from('hospital_cases')
    .select('id, queue_number, arrival_status, appointment_time, assigned_doctor_id')
    .eq('hospital_id', hosp.id)
    .not('queue_number', 'is', null)
    .in('arrival_status', ['arrived', 'in_clinic'])
    .order('queue_number');

  // Doctor map
  const docIds = [...new Set((cases || []).map(c => c.assigned_doctor_id).filter(Boolean))];
  const { data: docs } = docIds.length
    ? await db.from('staff_users').select('id, full_name').in('id', docIds)
    : { data: [] };
  const docMap = Object.fromEntries((docs || []).map(d => [d.id, d.full_name]));

  const calling = (cases || [])
    .filter(c => c.arrival_status === 'in_clinic')
    .map(c => ({
      queue_number: c.queue_number,
      doctor: docMap[c.assigned_doctor_id] || 'Clinic'
    }));

  const waiting = (cases || [])
    .filter(c => c.arrival_status === 'arrived')
    .map(c => ({
      queue_number: c.queue_number,
      appointment_time: c.appointment_time
    }));

  res.json({
    ok: true,
    hospital: hosp,
    calling,
    waiting
  });
});
