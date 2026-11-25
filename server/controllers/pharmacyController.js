// DEC-056: Hospital Pharmacy Dispensing Controller
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';

/**
 * GET /api/v1/hospital/pharmacy/queue
 * Returns pending prescriptions queue for the pharmacy
 */
export const getPharmacyQueue = ah(async (req, res) => {
  const { status } = req.query;
  const targetStatus = status || 'prescribed';

  const { data: meds, error } = await db
    .from('hospital_medications')
    .select(`
      id, drug_name, dosage, frequency, duration_days, instructions,
      dispense_status, dispense_note, created_at, hospital_case_id, doctor_id
    `)
    .eq('hospital_id', req.tenant.id)
    .eq('dispense_status', targetStatus)
    .order('created_at', { ascending: true });

  if (error) throw httpError(500, error.message);

  // Enrich with case and patient info
  const caseIds = [...new Set((meds || []).map(m => m.hospital_case_id).filter(Boolean))];
  const { data: cases } = caseIds.length
    ? await db.from('hospital_cases').select('id, case_number, hospital_patient_id').in('id', caseIds)
    : { data: [] };

  const pIds = [...new Set((cases || []).map(c => c.hospital_patient_id).filter(Boolean))];
  const { data: patients } = pIds.length
    ? await db.from('hospital_patients').select('id, full_name, mrn').in('id', pIds)
    : { data: [] };

  const caseMap = Object.fromEntries((cases || []).map(c => [c.id, c]));
  const pMap = Object.fromEntries((patients || []).map(p => [p.id, p]));

  const enriched = (meds || []).map(m => {
    const c = caseMap[m.hospital_case_id];
    const p = c ? pMap[c.hospital_patient_id] : null;
    return {
      ...m,
      case_number: c?.case_number || null,
      patient_name: p?.full_name || null,
      patient_mrn: p?.mrn || null
    };
  });

  res.json({ ok: true, queue: enriched });
});

/**
 * POST /api/v1/hospital/cases/:id/medications
 * Doctor writes a prescription for a hospital case
 */
export const prescribeMedication = ah(async (req, res) => {
  const { id: caseId } = req.params;
  const { drug_name, dosage, frequency, duration_days, instructions } = req.body;

  if (!drug_name || !dosage) {
    throw httpError(400, 'drug_name and dosage are required');
  }

  const { data: c, error: caseErr } = await db
    .from('hospital_cases')
    .select('id, status')
    .eq('id', caseId)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (caseErr || !c) throw httpError(404, 'Case not found');

  const medPayload = {
    hospital_id: req.tenant.id,
    hospital_case_id: caseId,
    drug_name: String(drug_name).trim(),
    dosage: String(dosage).trim(),
    frequency: frequency ? String(frequency).trim() : 'Once daily',
    duration_days: duration_days ? parseInt(duration_days, 10) : 7,
    instructions: instructions ? String(instructions).trim() : null,
    dispense_status: 'prescribed',
    doctor_id: req.staff.id
  };

  const { data: created, error } = await db
    .from('hospital_medications')
    .insert(medPayload)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  // Transition case to pending_pharmacy if appropriate
  if (c.status === 'in_consultation' || c.status === 'new') {
    await db.from('hospital_cases').update({ status: 'pending_pharmacy' }).eq('id', caseId);
  }

  // Timeline
  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: caseId,
    from_status: c.status,
    to_status: 'pending_pharmacy',
    actor_id: req.staff.id,
    actor_role: req.staff.role,
    note: `Prescription issued: ${created.drug_name} ${created.dosage}`
  });

  res.status(201).json({ ok: true, medication: created });
});

/**
 * POST /api/v1/hospital/pharmacy/medications/:id/dispense
 * Pharmacy confirms medication dispensing
 */
export const dispenseMedication = ah(async (req, res) => {
  const { id } = req.params;
  const dispense_status = req.body?.dispense_status || 'dispensed';
  const { dispense_note } = req.body || {};
  const allowed = ['dispensed', 'partial', 'cancelled'];

  if (!allowed.includes(dispense_status)) {
    throw httpError(400, `dispense_status must be one of: ${allowed.join(', ')}`);
  }

  const { data: med, error: findErr } = await db
    .from('hospital_medications')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !med) throw httpError(404, 'Prescription not found');

  const { data: updated, error } = await db
    .from('hospital_medications')
    .update({
      dispense_status,
      dispense_note: dispense_note || null,
      dispensed_by: req.staff.id,
      dispensed_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  // Timeline
  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: med.hospital_case_id,
    from_status: 'pending_pharmacy',
    to_status: 'pending_pharmacy',
    actor_id: req.staff.id,
    actor_role: 'pharmacy',
    note: `Medication ${med.drug_name} status updated to ${dispense_status}`
  });

  await audit(req, 'MED_DISPENSED', {
    resourceType: 'hospital_medication',
    resourceId: id,
    detail: { drug_name: med.drug_name, status: dispense_status },
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, medication: updated });
});
