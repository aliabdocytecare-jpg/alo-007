// DEC-055 / DEC-056: read-only preflight for the single-database deployment.
// Run before pushing (`npm run preflight`) and on the VPS after deploy.
// Exit code 1 means: do not deploy / the running container is misconfigured.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const results = [];
const add = (name, ok, detail = '') => results.push({ name, ok, detail });
const info = (name, detail) => results.push({ name, ok: true, detail });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.JWT_SECRET || '';
const isProd = process.env.NODE_ENV === 'production';

add('SUPABASE_URL is set', !!url);
add('SUPABASE_SERVICE_ROLE_KEY is set', !!key);
add('JWT_SECRET is 32+ chars', jwtSecret.length >= 32, `${jwtSecret.length} char(s)`);
add('ENABLE_MOCK_AUTH is false', process.env.ENABLE_MOCK_AUTH !== 'true', process.env.ENABLE_MOCK_AUTH || '(unset)');
add('ENABLE_MOCK_WHATSAPP is false', process.env.ENABLE_MOCK_WHATSAPP === 'false', process.env.ENABLE_MOCK_WHATSAPP || '(unset)');
if (isProd) {
  add('CLIENT_ORIGIN starts with https://', (process.env.CLIENT_ORIGIN || '').startsWith('https://'), process.env.CLIENT_ORIGIN || '(unset)');
}

if (url && key) {
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws }
  });

  const { count, error } = await db.from('staff_users').select('*', { count: 'exact', head: true });
  add('database reachable (staff_users)', !error, error ? error.message : `${count ?? 0} staff account(s)`);

  // Check hospital tables
  const hospTables = [
    'hospitals',
    'hospital_patients',
    'hospital_cases',
    'hospital_case_timeline',
    'hospital_documents',
    'hospital_slot_templates',
    'hospital_slots',
    'hospital_appointment_requests',
    'hospital_test_catalogue',
    'hospital_lab_tests',
    'hospital_medications',
    'case_reviews',
    'case_reports_requests',
    'international_specialists',
    'international_opinion_requests'
  ];

  let missingTables = [];
  for (const t of hospTables) {
    const { error: tErr } = await db.from(t).select('*', { count: 'exact', head: true });
    if (tErr) missingTables.push(`${t} (${tErr.message})`);
  }
  add('DEC-056 hospital & review tables reachable', missingTables.length === 0, missingTables.length ? `missing: ${missingTables.join(', ')}` : `${hospTables.length} tables verified`);

  // Integrity: no staff with hospital_id and null phone_e164
  const { data: badStaff, error: badStaffErr } = await db
    .from('staff_users')
    .select('id')
    .not('hospital_id', 'is', null)
    .is('phone_e164', null);
  add('hospital staff phone integrity', !badStaffErr && (!badStaff || badStaff.length === 0), badStaffErr ? badStaffErr.message : `${badStaff?.length || 0} violation(s)`);

  const { data: settings, error: settingsError } = await db.from('system_settings').select('key, value').like('key', 'whatsapp%');
  const cfg = Object.fromEntries((settings || []).map(s => [s.key, s.value]));
  const waKeys = Object.keys(cfg).length;
  add('whatsapp settings rows present', !settingsError && waKeys >= 11, settingsError ? settingsError.message : `${waKeys} key(s)`);
  info('whatsapp login OTP', cfg.whatsapp_otp_enabled === 'true' ? 'ON — real messages will be billed' : 'OFF — patients cannot sign in until enabled');
  info('whatsapp status updates', cfg.whatsapp_notify_enabled === 'true' ? 'ON' : 'OFF');
  info('whatsapp credentials', cfg.whatsapp_phone_number_id && cfg.whatsapp_token ? 'stored' : 'missing — OTP cannot send');

  const { data: buckets, error: bucketError } = await db.storage.listBuckets();
  const bucket = (buckets || []).find(b => b.name === 'case-documents');
  add('storage bucket case-documents', !bucketError && !!bucket, bucketError ? bucketError.message : bucket ? `private=${bucket.public === false}` : 'missing');
}

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed · NODE_ENV=${process.env.NODE_ENV || '(unset)'}`);
if (failed.length) {
  console.error('Preflight FAILED — resolve the FAIL lines above before deploying.');
  process.exit(1);
}
console.log('Preflight OK — env and database are ready for this build.');
