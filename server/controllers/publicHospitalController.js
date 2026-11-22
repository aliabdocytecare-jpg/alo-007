// DEC-056: Public Hospital Endpoints (Kiosk, Waiting Screen, Patient Status Page)
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { queueEvents, emitQueueUpdate } from '../services/realtimeService.js';
import { buildHospitalClinicVisitPdf } from '../services/pdfReportService.js';

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

  emitQueueUpdate(hosp.id, { event: 'kiosk_checkin', queue_number: queueNumber });

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

export async function fetchWaitingScreenData(pin) {
  const { data: hosp } = await db
    .from('hospitals')
    .select('id, name, name_ar, logo_url, primary_color, city')
    .eq('kiosk_pin', pin.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (!hosp) return null;

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
      doctor_name: docMap[c.assigned_doctor_id] || 'Clinic',
      doctor: docMap[c.assigned_doctor_id] || 'Clinic'
    }));

  const waiting = (cases || [])
    .filter(c => c.arrival_status === 'arrived')
    .map(c => ({
      queue_number: c.queue_number,
      appointment_time: c.appointment_time,
      estimated_wait_min: 15
    }));

  return {
    ok: true,
    hospital_name: hosp.name,
    city: hosp.city,
    hospital: hosp,
    now_calling: calling,
    calling,
    waiting_queue: waiting,
    waiting
  };
}

/**
 * GET /api/v1/public/screen/:pin/waiting
 * Waiting room TV queue display feed (REST fallback)
 */
export const getWaitingScreenFeed = ah(async (req, res) => {
  const { pin } = req.params;
  const data = await fetchWaitingScreenData(pin);
  if (!data) throw httpError(404, 'Invalid screen pairing PIN');
  res.json(data);
});

/**
 * GET /api/v1/public/screen/:pin/waiting/stream
 * Real-time Server-Sent Events (SSE) stream for Waiting Room TV Screen
 */
export const streamWaitingScreen = ah(async (req, res) => {
  const { pin } = req.params;
  const initialData = await fetchWaitingScreenData(pin);
  if (!initialData) throw httpError(404, 'Invalid screen pairing PIN');

  const hospId = initialData.hospital.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial snapshot
  res.write(`data: ${JSON.stringify(initialData)}\n\n`);

  // Listener for instant updates
  const onQueueUpdate = async (eventDetail) => {
    if (eventDetail.hospitalId !== hospId) return;
    try {
      const fresh = await fetchWaitingScreenData(pin);
      if (fresh) {
        if (eventDetail.just_called) {
          fresh.just_called = eventDetail.just_called;
        }
        res.write(`data: ${JSON.stringify(fresh)}\n\n`);
      }
    } catch (e) {
      // client connection closed or error
    }
  };

  queueEvents.on('queue_update', onQueueUpdate);

  // Heartbeat comment every 20s to keep connection open through firewalls/proxies
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    queueEvents.off('queue_update', onQueueUpdate);
  });
});

/**
 * GET /api/v1/public/case/:code/report/pdf
 * Generates and downloads the official clinic visit summary PDF for patient
 */
export const downloadPublicClinicVisitPdf = ah(async (req, res) => {
  const { code } = req.params;
  if (!code || code.trim().length !== 6) throw httpError(400, 'Invalid check-in code');

  const { data: c, error: caseErr } = await db
    .from('hospital_cases')
    .select('*')
    .eq('checkin_code', code.trim().toUpperCase())
    .maybeSingle();

  if (caseErr || !c) throw httpError(404, 'Clinic case not found');

  const [hospRes, patRes, docRes, labRes, medRes] = await Promise.all([
    db.from('hospitals').select('*').eq('id', c.hospital_id).maybeSingle(),
    db.from('hospital_patients').select('*').eq('id', c.hospital_patient_id).maybeSingle(),
    c.assigned_doctor_id ? db.from('staff_users').select('*').eq('id', c.assigned_doctor_id).maybeSingle() : { data: null },
    db.from('hospital_lab_tests').select('*').eq('hospital_case_id', c.id).order('created_at'),
    db.from('hospital_medications').select('*').eq('hospital_case_id', c.id).order('created_at')
  ]);

  const isMobile = ['ios', 'android'].includes(req.clientInfo?.platform || req.headers['x-client-platform']);
  const inline = req.query.inline === 'true' || isMobile;
  const disposition = inline ? 'inline' : 'attachment';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="Clinic_Visit_${c.case_number || 'case'}.pdf"`);
  res.setHeader('Accept-Ranges', 'bytes');

  buildHospitalClinicVisitPdf({
    hospitalCaseData: c,
    hospitalData: hospRes.data || {},
    patientData: patRes.data || {},
    doctorData: docRes.data || {},
    labTests: labRes.data || [],
    medications: medRes.data || [],
    streamRes: res
  });
});

/**
 * GET /api/v1/public/case/:code/stream
 * Real-time SSE stream for patient mobile queue tracker
 */
export const streamPublicCaseStatus = ah(async (req, res) => {
  const { code } = req.params;
  if (!code || code.trim().length !== 6) throw httpError(400, 'Invalid check-in code');

  const upperCode = code.trim().toUpperCase();

  const fetchStatus = async () => {
    const { data: c } = await db
      .from('hospital_cases')
      .select('id, case_number, checkin_code, queue_number, status, arrival_status, appointment_date, appointment_time, hospital_id, hospital_patient_id, assigned_doctor_id, doctor_opinion')
      .eq('checkin_code', upperCode)
      .maybeSingle();

    if (!c) return null;

    const [hospRes, docRes] = await Promise.all([
      db.from('hospitals').select('id, name, city').eq('id', c.hospital_id).maybeSingle(),
      c.assigned_doctor_id ? db.from('staff_users').select('full_name, specialty').eq('id', c.assigned_doctor_id).maybeSingle() : { data: null }
    ]);

    let aheadCount = 0;
    if (c.queue_number && c.arrival_status === 'arrived') {
      const { count } = await db
        .from('hospital_cases')
        .select('*', { count: 'exact', head: true })
        .eq('hospital_id', c.hospital_id)
        .eq('arrival_status', 'arrived')
        .lt('queue_number', c.queue_number);
      aheadCount = count || 0;
    }

    return {
      ok: true,
      case: c,
      hospital: hospRes.data || {},
      doctor: docRes.data || {},
      queue: {
        ahead_count: aheadCount,
        estimated_wait_min: aheadCount * 15
      }
    };
  };

  const initial = await fetchStatus();
  if (!initial) throw httpError(404, 'Case not found');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(`data: ${JSON.stringify(initial)}\n\n`);

  const onUpdate = async (detail) => {
    if (detail.hospitalId !== initial.case.hospital_id) return;
    try {
      const fresh = await fetchStatus();
      if (fresh) {
        if (detail.just_called && detail.just_called === fresh.case.queue_number) {
          fresh.just_called = true;
        }
        res.write(`data: ${JSON.stringify(fresh)}\n\n`);
      }
    } catch (e) {}
  };

  queueEvents.on('queue_update', onUpdate);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    queueEvents.off('queue_update', onUpdate);
  });
});
