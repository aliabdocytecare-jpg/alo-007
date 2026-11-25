// DEC-056: Hospital Lab Workflow Controller (Catalogue, Orders, Specimen Barcodes & Results)
import { db } from '../config/db.js';
import { ah, httpError, audit } from '../lib/helpers.js';
import { generateBarcode128Svg, encodeCode128B } from '../lib/barcode128.js';

function generateSpecimenId(shortName) {
  const prefix = (shortName || 'HOSP').slice(0, 4).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `SPEC-${prefix}-${ts}${rand}`;
}

/**
 * GET /api/v1/hospital/test-catalogue
 */
export const listTestCatalogue = ah(async (req, res) => {
  const { data: catalogue, error } = await db
    .from('hospital_test_catalogue')
    .select('*')
    .eq('hospital_id', req.tenant.id)
    .eq('is_active', true)
    .order('name');

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, catalogue });
});

/**
 * POST /api/v1/hospital/test-catalogue
 */
export const createTestCatalogueItem = ah(async (req, res) => {
  const { name, name_ar, category, specimen_type, description, parameters } = req.body;

  if (!name || !category || !specimen_type) {
    throw httpError(400, 'name, category, and specimen_type are required');
  }

  const payload = {
    hospital_id: req.tenant.id,
    name: String(name).trim(),
    name_ar: name_ar ? String(name_ar).trim() : null,
    category: String(category).trim(),
    specimen_type: String(specimen_type).trim(),
    description: description || null,
    parameters: Array.isArray(parameters) ? parameters : [],
    is_active: true
  };

  const { data: item, error } = await db
    .from('hospital_test_catalogue')
    .insert(payload)
    .select()
    .single();

  if (error) throw httpError(500, error.message);
  res.status(201).json({ ok: true, item });
});

/**
 * GET /api/v1/hospital/lab/tests
 */
export const listLabTests = ah(async (req, res) => {
  const { status, hospital_case_id, priority } = req.query;

  let query = db
    .from('hospital_lab_tests')
    .select(`
      id, test_name, specimen_type, specimen_id, priority, status,
      result_status, has_abnormal, critical_result, results, requested_at,
      completed_at, hospital_case_id, hospital_patient_id, requested_by
    `)
    .eq('hospital_id', req.tenant.id)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (hospital_case_id) query = query.eq('hospital_case_id', hospital_case_id);
  if (priority) query = query.eq('priority', priority);

  const { data: tests, error } = await query.limit(100);
  if (error) throw httpError(500, error.message);

  // Enrich with barcode SVG for client viewing
  const enriched = (tests || []).map(t => ({
    ...t,
    barcode_svg: generateBarcode128Svg(t.specimen_id),
    barcode_encoded: encodeCode128B(t.specimen_id)
  }));

  res.json({ ok: true, tests: enriched });
});

/**
 * POST /api/v1/hospital/lab/tests
 * Doctor requests a lab test for a patient
 */
export const requestLabTest = ah(async (req, res) => {
  const { hospital_case_id, test_catalogue_id, test_name, specimen_type, priority, parameters, notes } = req.body;

  if (!hospital_case_id) throw httpError(400, 'hospital_case_id is required');

  const { data: c, error: caseErr } = await db
    .from('hospital_cases')
    .select('id, hospital_patient_id, status')
    .eq('id', hospital_case_id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (caseErr || !c) throw httpError(404, 'Case not found');

  const specimenId = generateSpecimenId(req.tenant.short_name);

  const testPayload = {
    hospital_id: req.tenant.id,
    hospital_case_id,
    hospital_patient_id: c.hospital_patient_id,
    test_catalogue_id: test_catalogue_id || null,
    test_name: test_name || 'Lab Panel',
    specimen_type: specimen_type || 'Blood',
    specimen_id: specimenId,
    priority: ['routine', 'urgent', 'stat'].includes(priority) ? priority : 'routine',
    parameters: Array.isArray(parameters) ? parameters : [],
    status: 'requested',
    result_status: 'normal',
    notes: notes || null,
    requested_by: req.staff.id
  };

  const { data: created, error } = await db
    .from('hospital_lab_tests')
    .insert(testPayload)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  // Transition case to pending_lab if in consultation
  if (c.status === 'in_consultation' || c.status === 'new') {
    await db.from('hospital_cases').update({ status: 'pending_lab' }).eq('id', c.id);
  }

  // Timeline
  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id,
    from_status: c.status,
    to_status: 'pending_lab',
    actor_id: req.staff.id,
    actor_role: req.staff.role,
    note: `Lab test ordered: ${created.test_name} (${created.specimen_id})`
  });

  await audit(req, 'LAB_REQUESTED', {
    resourceType: 'hospital_lab_test',
    resourceId: created.id,
    detail: { test_name: created.test_name, specimen_id: specimenId, priority: created.priority },
    hospitalId: req.tenant.id
  });

  res.status(201).json({
    ok: true,
    test: {
      ...created,
      barcode_svg: generateBarcode128Svg(specimenId),
      barcode_encoded: encodeCode128B(specimenId)
    }
  });
});

/**
 * PATCH /api/v1/hospital/lab/tests/:id/status
 * Updates test status (e.g. collected, in_progress)
 */
export const updateLabTestStatus = ah(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['requested', 'collected', 'in_progress', 'cancelled'];

  if (!status || !allowed.includes(status)) {
    throw httpError(400, `Status must be one of: ${allowed.join(', ')}`);
  }

  const { data: updated, error } = await db
    .from('hospital_lab_tests')
    .update({ status })
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);
  res.json({ ok: true, test: updated });
});

/**
 * POST /api/v1/hospital/lab/tests/:id/results
 * Lab technician submits results; handles amendments with previous_versions snapshot
 */
export const submitLabResults = ah(async (req, res) => {
  const { id } = req.params;
  const { results, result_status, has_abnormal, critical_result, notes, amendment_reason } = req.body;

  const { data: existing, error: findErr } = await db
    .from('hospital_lab_tests')
    .select('*')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !existing) throw httpError(404, 'Lab test not found');

  const patch = {
    results: results || {},
    result_status: ['normal', 'abnormal', 'critical'].includes(result_status) ? result_status : 'normal',
    has_abnormal: !!has_abnormal,
    critical_result: !!critical_result,
    notes: notes !== undefined ? notes : existing.notes,
    completed_by: req.staff.id,
    completed_at: new Date().toISOString()
  };

  // Amendment tracking if already resulted/verified
  if (existing.status === 'verified' || existing.status === 'resulted') {
    if (!amendment_reason || !String(amendment_reason).trim()) {
      throw httpError(400, 'amendment_reason is required when editing verified lab results');
    }
    const history = Array.isArray(existing.previous_versions) ? existing.previous_versions : [];
    const snapshot = {
      results: existing.results,
      result_status: existing.result_status,
      has_abnormal: existing.has_abnormal,
      critical_result: existing.critical_result,
      amendment_reason: String(amendment_reason).trim(),
      amended_at: new Date().toISOString(),
      amended_by: req.staff.id
    };
    patch.previous_versions = [...history, snapshot];
    patch.status = 'amended';
    patch.amendment_reason = String(amendment_reason).trim();
  } else {
    patch.status = 'verified';
  }

  const { data: updated, error } = await db
    .from('hospital_lab_tests')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw httpError(500, error.message);

  // If critical result, notify the requesting doctor safely
  if (updated.critical_result && updated.requested_by) {
    try {
      await db.from('notifications').insert({
        recipient_type: 'staff',
        recipient_id: updated.requested_by,
        event_type: 'CRITICAL_LAB_ALERT',
        title: `Critical Lab Result: ${updated.test_name}`,
        body: `Test ${updated.test_name} (${updated.specimen_id}) has critical findings. Immediate review required.`
      });
    } catch (notifErr) {
      console.warn('[Lab] critical alert notification skipped:', notifErr?.message);
    }
  }
    });
  }

  // Timeline
  await db.from('hospital_case_timeline').insert({
    hospital_id: req.tenant.id,
    hospital_case_id: existing.hospital_case_id,
    from_status: 'pending_lab',
    to_status: 'pending_lab',
    actor_id: req.staff.id,
    actor_role: req.staff.role,
    note: `Lab results verified for ${updated.test_name} (${updated.result_status})`
  });

  await audit(req, 'LAB_RESULTED', {
    resourceType: 'hospital_lab_test',
    resourceId: id,
    detail: { result_status: updated.result_status, critical: updated.critical_result },
    hospitalId: req.tenant.id
  });

  res.json({ ok: true, test: updated });
});

/**
 * POST /api/v1/hospital/lab/tests/:id/comments
 */
export const addLabComment = ah(async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;

  if (!text || !String(text).trim()) throw httpError(400, 'Comment text required');

  const { data: test, error: findErr } = await db
    .from('hospital_lab_tests')
    .select('id')
    .eq('id', id)
    .eq('hospital_id', req.tenant.id)
    .maybeSingle();

  if (findErr || !test) throw httpError(404, 'Lab test not found');

  const { data: comment, error } = await db
    .from('hospital_lab_comments')
    .insert({
      hospital_id: req.tenant.id,
      hospital_lab_test_id: id,
      author_id: req.staff.id,
      text: String(text).trim()
    })
    .select()
    .single();

  if (error) throw httpError(500, error.message);
  res.status(201).json({ ok: true, comment });
});
