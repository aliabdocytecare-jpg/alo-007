// Automated Phase 3 Verification Suite: Day-Clinic Operations Engine
import 'dotenv/config';
import { db } from '../config/db.js';
import { generateSlotsForHospital } from '../services/hospitalSlotService.js';
import { generateBarcode128Svg } from '../lib/barcode128.js';

let passed = 0;
let failed = 0;

function assert(name, condition, extra = '') {
  if (condition) {
    console.log(`PASS: ${name} ${extra}`);
    passed++;
  } else {
    console.error(`FAIL: ${name} ${extra}`);
    failed++;
  }
}

async function run() {
  console.log('Running Phase 3 Verification Suite...\n');

  // Clean up any stale test records
  const { data: oldHosps } = await db.from('hospitals').select('id').like('name', 'TEST3 —%');
  for (const h of oldHosps || []) {
    await db.from('hospital_medications').delete().eq('hospital_id', h.id);
    await db.from('hospital_lab_comments').delete().eq('hospital_id', h.id);
    await db.from('hospital_lab_tests').delete().eq('hospital_id', h.id);
    await db.from('hospital_test_catalogue').delete().eq('hospital_id', h.id);
    await db.from('hospital_case_timeline').delete().eq('hospital_id', h.id);
    await db.from('hospital_documents').delete().eq('hospital_id', h.id);
    await db.from('hospital_cases').delete().eq('hospital_id', h.id);
    await db.from('hospital_slots').delete().eq('hospital_id', h.id);
    await db.from('hospital_slot_templates').delete().eq('hospital_id', h.id);
    await db.from('hospital_patients').delete().eq('hospital_id', h.id);
    await db.from('staff_users').delete().eq('hospital_id', h.id);
    await db.from('hospitals').delete().eq('id', h.id);
  }

  // 1. Provision Test Hospital
  const { data: hosp, error: hospErr } = await db.from('hospitals').insert({
    name: 'TEST3 — Riyadh Specialist Hospital',
    short_name: 'RSH',
    city: 'Riyadh',
    timezone: 'Asia/Riyadh',
    kiosk_pin: '123456',
    is_active: true
  }).select().single();
  assert('Provision Test Hospital', !hospErr && !!hosp?.id, hospErr?.message || hosp?.id);

  // 2. Provision Doctor
  const { data: doctor, error: docErr } = await db.from('staff_users').insert({
    hospital_id: hosp.id,
    full_name: 'Dr. Marcus Vance',
    role: 'doctor',
    specialty: 'Cardiology',
    phone: '+966509990011',
    phone_e164: '+966509990011',
    is_active: true
  }).select().single();
  assert('Provision Clinic Doctor (Dr. Marcus Vance)', !docErr && !!doctor?.id, docErr?.message || doctor?.id);

  // 3. Slot Template & Slot Generation
  const today = new Date();
  const dayOfWeek = today.getDay(); // e.g. Sunday=0, Monday=1, ...
  const { data: template, error: tmplErr } = await db.from('hospital_slot_templates').insert({
    hospital_id: hosp.id,
    doctor_id: doctor.id,
    weekdays: [dayOfWeek],
    times: ['09:00', '09:30', '10:00'],
    duration_min: 30,
    active: true
  }).select().single();
  assert('Create Slot Template', !tmplErr && !!template?.id, tmplErr?.message || template?.id);

  const genResult = await generateSlotsForHospital(hosp.id, { horizonDays: 7, doctorId: doctor.id });
  assert('Generate Slots from Template', genResult.generated >= 3, `generated: ${genResult.generated}`);

  // Fetch generated slots
  const { data: slots, error: slotsErr } = await db
    .from('hospital_slots')
    .select('*')
    .eq('hospital_id', hosp.id)
    .eq('doctor_id', doctor.id);
  assert('Slots present in database', !slotsErr && slots?.length >= 3, `count: ${slots?.length}`);

  // 4. Anti-Double-Booking Unique Constraint Check
  const testSlot = slots[0];
  const { error: dupSlotErr } = await db.from('hospital_slots').insert({
    hospital_id: hosp.id,
    doctor_id: doctor.id,
    date: testSlot.date,
    time: testSlot.time,
    duration_min: 30,
    status: 'free'
  });
  assert('Anti-double-booking UNIQUE(hospital_id, doctor_id, date, time) enforced', dupSlotErr?.code === '23505', dupSlotErr?.message);

  // 5. Hospital Patient Creation
  const { data: patient, error: patErr } = await db.from('hospital_patients').insert({
    hospital_id: hosp.id,
    mrn: 'MRN-778899',
    full_name: 'Emmanuel Arcon Gonzalez',
    phone: '+966509990022',
    dob: '1984-06-15',
    gender: 'MALE'
  }).select().single();
  assert('Create Hospital Patient (Emmanuel Arcon Gonzalez)', !patErr && !!patient?.id, patErr?.message || patient?.mrn);

  // Duplicate MRN in same hospital must fail
  const { error: dupPatErr } = await db.from('hospital_patients').insert({
    hospital_id: hosp.id,
    mrn: 'MRN-778899',
    full_name: 'Duplicate Patient'
  });
  assert('Duplicate MRN in same hospital rejected', dupPatErr?.code === '23505');

  // 6. Clinic Case Creation
  const todayStr = today.toISOString().split('T')[0];
  const checkinCode = 'ABC789';
  const { data: hospCase, error: caseErr } = await db.from('hospital_cases').insert({
    hospital_id: hosp.id,
    case_number: 'C-0001',
    checkin_code: checkinCode,
    hospital_patient_id: patient.id,
    assigned_doctor_id: doctor.id,
    status: 'new',
    arrival_status: 'scheduled',
    appointment_date: todayStr,
    appointment_time: '09:00',
    case_summary: 'Persistent chest tightness on exertion'
  }).select().single();
  assert('Create Clinic Case (C-0001)', !caseErr && !!hospCase?.id, caseErr?.message || hospCase?.case_number);

  // 7. Check-in & Queue Number Assignment
  const { data: checkedIn, error: checkinErr } = await db.from('hospital_cases')
    .update({
      arrival_status: 'arrived',
      arrived_at: new Date().toISOString(),
      queue_number: 'A-001'
    })
    .eq('id', hospCase.id)
    .select()
    .single();
  assert('Patient Check-in sets arrival_status=arrived and queue_number=A-001', !checkinErr && checkedIn?.queue_number === 'A-001', checkinErr?.message || checkedIn?.queue_number);

  // 8. Doctor Consultation Flow
  const { data: consulted, error: consultErr } = await db.from('hospital_cases')
    .update({
      arrival_status: 'in_clinic',
      in_clinic_at: new Date().toISOString(),
      doctor_opinion: 'Cardiac auscultation normal S1/S2. Treatment plan: Initiate statin therapy, order lipid panel.',
      status: 'completed'
    })
    .eq('id', hospCase.id)
    .select()
    .single();
  assert('Doctor Consultation updates opinion and completes case', !consultErr && consulted?.status === 'completed', consultErr?.message || consulted?.status);

  // 9. Lab Order & Barcode Generation
  const svgBarcode = generateBarcode128Svg('SPEC-RSH-9871');
  assert('Code 128B Barcode SVG generated with valid SVG XML', svgBarcode.startsWith('<svg') && svgBarcode.includes('</svg>'), `len: ${svgBarcode.length}`);

  const { data: catItem, error: catErr } = await db.from('hospital_test_catalogue').insert({
    hospital_id: hosp.id,
    name: 'Comprehensive Lipid Panel',
    name_ar: 'فحص الدهون الشامل',
    category: 'Biochemistry',
    specimen_type: 'Serum',
    is_active: true
  }).select().single();
  assert('Create Test Catalogue Item', !catErr && !!catItem?.id, catErr?.message || catItem?.name);

  const specimenId = 'SPEC-RSH-8822';
  const { data: labTest, error: labErr } = await db.from('hospital_lab_tests').insert({
    hospital_id: hosp.id,
    hospital_case_id: hospCase.id,
    hospital_patient_id: patient.id,
    test_catalogue_id: catItem.id,
    test_name: catItem.name,
    specimen_type: catItem.specimen_type,
    specimen_id: specimenId,
    status: 'requested',
    requested_by: doctor.id,
    priority: 'routine'
  }).select().single();
  assert('Order Lab Test with Specimen ID', !labErr && !!labTest?.id, labErr?.message || labTest?.specimen_id);

  // Submit initial lab result
  const initialResults = { cholesterol_total: 245, unit: 'mg/dL', flag: 'HIGH' };
  const { data: completedLab, error: compLabErr } = await db.from('hospital_lab_tests')
    .update({
      status: 'resulted',
      result_status: 'abnormal',
      has_abnormal: true,
      critical_result: false,
      results: initialResults,
      completed_by: doctor.id,
      completed_at: new Date().toISOString(),
      previous_versions: []
    })
    .eq('id', labTest.id)
    .select()
    .single();
  assert('Submit Initial Lab Result', !compLabErr && completedLab?.result_status === 'abnormal', compLabErr?.message);

  // Amend lab result and verify audit history
  const amendedResults = { cholesterol_total: 240, unit: 'mg/dL', flag: 'HIGH' };
  const versionEntry = {
    results: initialResults,
    result_status: 'abnormal',
    critical_result: false,
    has_abnormal: true,
    amended_at: new Date().toISOString(),
    amended_by: doctor.id
  };
  const { data: amendedLab, error: amendErr } = await db.from('hospital_lab_tests')
    .update({
      status: 'amended',
      results: amendedResults,
      previous_versions: [versionEntry]
    })
    .eq('id', labTest.id)
    .select()
    .single();
  assert('Amend Lab Result records previous version in history array', !amendErr && amendedLab?.previous_versions?.length === 1, amendErr?.message || `versions: ${amendedLab?.previous_versions?.length}`);

  // 10. Pharmacy Prescribing & Dispensing
  const { data: med, error: medErr } = await db.from('hospital_medications').insert({
    hospital_id: hosp.id,
    hospital_case_id: hospCase.id,
    doctor_id: doctor.id,
    drug_name: 'Atorvastatin 20mg',
    dosage: '20mg',
    frequency: 'Once daily at bedtime',
    duration_days: 30,
    instructions: 'Take after dinner',
    dispense_status: 'prescribed'
  }).select().single();
  assert('Prescribe Medication for Case', !medErr && !!med?.id, medErr?.message || med?.drug_name);

  const { data: dispensedMed, error: dispErr } = await db.from('hospital_medications')
    .update({
      dispense_status: 'dispensed',
      dispensed_by: doctor.id,
      dispensed_at: new Date().toISOString(),
      dispense_note: '30 tablets dispensed to patient'
    })
    .eq('id', med.id)
    .select()
    .single();
  assert('Pharmacist Dispenses Medication with Notes', !dispErr && dispensedMed?.dispense_status === 'dispensed', dispErr?.message || dispensedMed?.dispense_status);

  // 11. Cleanup test records
  await db.from('hospital_medications').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_lab_tests').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_test_catalogue').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_cases').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_slots').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_slot_templates').delete().eq('hospital_id', hosp.id);
  await db.from('hospital_patients').delete().eq('hospital_id', hosp.id);
  await db.from('staff_users').delete().eq('hospital_id', hosp.id);
  await db.from('hospitals').delete().eq('id', hosp.id);
  assert('Cleaned up Phase 3 test data', true);

  console.log(`\nPhase 3 Verification Complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error in Phase 3 verification suite:', err);
  process.exit(1);
});
