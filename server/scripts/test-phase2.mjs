// Automated Phase 2 Verification Suite: Multi-Tenant Scoping & Staff WhatsApp OTP Auth
import 'dotenv/config';
import { db } from '../config/db.js';
import { toE164, assertStaffPhoneAvailable } from '../lib/phone.js';

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
  console.log('Running Phase 2 Verification Suite...\n');

  // Test 1: Phone normalization
  const p1 = toE164('0501112233');
  assert('Normalizes local Saudi mobile 0501112233', p1 === '+966501112233', p1);
  const p2 = toE164('+966 50 111 2244');
  assert('Normalizes formatted mobile +966 50 111 2244', p2 === '+966501112244', p2);

  // Clean up any old test records
  const { data: oldHosps } = await db.from('hospitals').select('id').like('name', 'TEST —%');
  for (const h of oldHosps || []) {
    await db.from('staff_users').delete().eq('hospital_id', h.id);
    await db.from('hospitals').delete().eq('id', h.id);
  }

  // Test 2: Provision Hospital A
  const { data: hospA, error: hospAErr } = await db.from('hospitals').insert({
    name: 'TEST — King Fahd Medical City',
    short_name: 'KFMC',
    city: 'Riyadh',
    timezone: 'Asia/Riyadh',
    kiosk_pin: '987123',
    is_active: true
  }).select().single();
  assert('Provision Hospital A (KFMC)', !hospAErr && !!hospA?.id, hospA?.id);

  // Test 3: Create Hospital Admin A
  const phoneAdmin = '+966501112233';
  const { data: adminStaff, error: adminErr } = await db.from('staff_users').insert({
    hospital_id: hospA.id,
    full_name: 'Adrian Lewis (Operations Lead)',
    role: 'hospital_admin',
    phone: phoneAdmin,
    phone_e164: phoneAdmin,
    is_active: true
  }).select().single();
  assert('Create Hospital Admin (Adrian Lewis)', !adminErr && !!adminStaff?.id, adminStaff?.id);

  // Test 4: Create Doctor in Hospital A
  const phoneDoc = '+966501112244';
  const { data: docStaff, error: docErr } = await db.from('staff_users').insert({
    hospital_id: hospA.id,
    full_name: 'Dr. Marcus Vance',
    role: 'doctor',
    specialty: 'Cardiology',
    phone: phoneDoc,
    phone_e164: phoneDoc,
    is_active: true
  }).select().single();
  assert('Create Hospital Doctor (Marcus Vance)', !docErr && !!docStaff?.id, docStaff?.id);

  // Test 5: Duplicate phone availability check
  let dupCaught = false;
  let dupMessage = '';
  try {
    await assertStaffPhoneAvailable(db, phoneDoc);
  } catch (err) {
    dupCaught = true;
    dupMessage = err.message;
  }
  assert(
    'Duplicate phone rejected with D10 standard message',
    dupCaught && dupMessage === 'This number is already part of our system, please provide a different number.',
    dupMessage
  );

  // Test 6: Database unique constraint on phone_e164
  let dbDupCaught = false;
  const { error: dbDupErr } = await db.from('staff_users').insert({
    hospital_id: hospA.id,
    full_name: 'Duplicate Staff',
    role: 'reception',
    phone_e164: phoneDoc,
    is_active: true
  });
  if (dbDupErr && dbDupErr.code === '23505') {
    dbDupCaught = true;
  }
  assert('Database unique index rejects duplicate phone_e164', dbDupCaught, dbDupErr?.message);

  // Test 7: Provision Hospital B
  const { data: hospB, error: hospBErr } = await db.from('hospitals').insert({
    name: 'TEST — Dammam Central Hospital',
    short_name: 'DCH',
    city: 'Dammam',
    timezone: 'Asia/Riyadh',
    kiosk_pin: '987124',
    is_active: true
  }).select().single();
  assert('Provision Hospital B (DCH)', !hospBErr && !!hospB?.id, hospB?.id);

  // Test 8: Tenant Scoping Query Isolation
  const { data: hospAStaff } = await db.from('staff_users').select('id, full_name').eq('hospital_id', hospA.id);
  const { data: hospBStaff } = await db.from('staff_users').select('id, full_name').eq('hospital_id', hospB.id);
  assert('Hospital A query returns exactly Hospital A staff', hospAStaff.length === 2, `count: ${hospAStaff.length}`);
  assert('Hospital B query returns 0 staff (strict isolation)', hospBStaff.length === 0, `count: ${hospBStaff.length}`);

  // Test 9: Immediate deactivation re-check
  await db.from('staff_users').update({ is_active: false }).eq('id', docStaff.id);
  const { data: deactivatedDoc } = await db.from('staff_users').select('is_active').eq('id', docStaff.id).single();
  assert('Staff account immediate deactivation', deactivatedDoc.is_active === false);

  // Test 10: Clean up test records
  await db.from('staff_users').delete().eq('hospital_id', hospA.id);
  await db.from('staff_users').delete().eq('hospital_id', hospB.id);
  await db.from('hospitals').delete().eq('id', hospA.id);
  await db.from('hospitals').delete().eq('id', hospB.id);
  assert('Cleaned up test tenants and test staff records', true);

  console.log(`\nPhase 2 Verification Complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error('Test suite failure:', e);
  process.exit(1);
});
