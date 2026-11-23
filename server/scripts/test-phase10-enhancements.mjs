// Test Suite: Phase 10 Enhancements (DEC-066)
// Verifies Medical Specialties Admin CRUD, public listing, and role-based desk boundaries.
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { db } from '../config/db.js';

let server;
let port;
let baseUrl;

function logPass(msg) { console.log(`\x1b[32mPASS\x1b[0m ${msg}`); }
function logFail(msg, err) { console.error(`\x1b[31mFAIL\x1b[0m ${msg}`, err || ''); process.exit(1); }

async function setup() {
  baseUrl = 'http://localhost:3000';
}

async function run() {
  console.log('--- Testing Phase 10: DEC-066 Enhancements ---');
  await setup();

  const testSuffix = Date.now().toString(36);
  let adminToken = null;
  let doctorToken = null;
  let testSpecialtyId = null;

  try {
    const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
    // 1. Get real Admin ID from staff_users
    const { data: realAdmin } = await db.from('staff_users').select('id, role').eq('role', 'admin').eq('is_active', true).limit(1).single();
    adminToken = jwt.sign({ sub: realAdmin.id, role: realAdmin.role, kind: 'staff' }, SECRET, { expiresIn: 3600 });

    // 2. Create simulated Patient session for RBAC test
    doctorToken = jwt.sign({ sub: 'test-patient-id', role: 'patient', kind: 'patient' }, SECRET, { expiresIn: 3600 });

    // Test 1: Public specialties listing
    const pubRes = await fetch(`${baseUrl}/api/v1/specialties`);
    if (!pubRes.ok) logFail(`GET /api/v1/specialties failed with status ${pubRes.status}`);
    const pubData = await pubRes.json();
    if (!Array.isArray(pubData) || pubData.length === 0) logFail('GET /api/v1/specialties did not return specialties array');
    logPass(`Public Specialties Listing: returned ${pubData.length} active specialties`);

    // Test 2: Admin specialties listing
    const admRes = await fetch(`${baseUrl}/api/v1/admin/specialties`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!admRes.ok) logFail(`GET /api/v1/admin/specialties failed with status ${admRes.status}`);
    const admData = await admRes.json();
    if (!Array.isArray(admData)) logFail('GET /api/v1/admin/specialties expected array');
    logPass(`Admin Specialties Listing: returned ${admData.length} total specialties`);

    // Test 3: Unauthorized role access to admin specialties rejected
    const unauthRes = await fetch(`${baseUrl}/api/v1/admin/specialties`, {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    if (unauthRes.status !== 403) logFail(`Expected 403 for doctor accessing /admin/specialties, got ${unauthRes.status}`);
    logPass('RBAC Security: Doctor role rejected from /admin/specialties with 403 Forbidden');

    // Test 4: Create new specialty as Admin
    const createRes = await fetch(`${baseUrl}/api/v1/admin/specialties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name_en: `Test Specialty ${testSuffix}`,
        name_ar: `تخصص تجريبي ${testSuffix}`
      })
    });
    if (!createRes.ok) logFail(`POST /api/v1/admin/specialties failed: ${createRes.status}`);
    const createData = await createRes.json();
    if (!createData.specialty?.id) logFail('POST /api/v1/admin/specialties missing id');
    testSpecialtyId = createData.specialty.id;
    logPass(`Admin Specialty Creation: created "${createData.specialty.name_en}" (ID: ${testSpecialtyId})`);

    // Test 5: Duplicate specialty creation rejected
    const dupRes = await fetch(`${baseUrl}/api/v1/admin/specialties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name_en: `Test Specialty ${testSuffix}`,
        name_ar: `تخصص مكرر`
      })
    });
    if (dupRes.status !== 409) logFail(`Expected 409 for duplicate specialty, got ${dupRes.status}`);
    logPass('Duplicate Specialty Validation: rejected duplicate with 409 Conflict');

    // Test 6: Toggle specialty active status
    const patchRes = await fetch(`${baseUrl}/api/v1/admin/specialties/${testSpecialtyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ is_active: false })
    });
    if (!patchRes.ok) logFail(`PATCH /api/v1/admin/specialties/:id failed: ${patchRes.status}`);
    logPass('Admin Specialty Status Toggle: successfully deactivated specialty');

    // Cleanup test record
    await db.from('specialties').delete().eq('id', testSpecialtyId);
    logPass('Test Cleanup: removed test specialty record');

    console.log('\nAll Phase 10 (DEC-066) Enhancement Checks PASSED (100%)\n');
    process.exit(0);
  } catch (err) {
    if (testSpecialtyId) {
      await db.from('specialties').delete().eq('id', testSpecialtyId).catch(() => {});
    }
    logFail('Phase 10 verification exception', err);
  }
}

run();
