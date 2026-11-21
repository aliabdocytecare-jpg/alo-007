// DEC-039 / DEC-045: production FIRST-USER bootstrap — creates the single ALO Super Admin.
// Industry pattern (Django createsuperuser / Strapi admin init): a one-time, operator-run
// command, never hardcoded users in migrations. This script is FIRST-USER-ONLY: it refuses
// once any staff exists, so exactly one admin is bootstrapped; everyone else is created
// afterwards through the authenticated, audited Admin console (US-ADM-001).
// Usage:
//   ADMIN_EMAIL=you@clinic.com ADMIN_PASSWORD='<strong>' ADMIN_NAME='Your Name' \
//     node scripts/create-admin.mjs
// Works against whichever driver is configured (local SQLite or real Supabase).
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, IS_LOCAL } from '../config/db.js';

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const fullName = (process.env.ADMIN_NAME || 'Administrator').trim();

const fail = msg => { console.error(`ERROR: ${msg}`); process.exit(1); };

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('ADMIN_EMAIL must be a valid email address.');
if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
  fail('ADMIN_PASSWORD must be at least 12 characters with lowercase, uppercase and a digit.');
}
if (['Admin@12345', 'Coord@12345', 'Doctor@12345', 'Nurse@12345'].includes(password)) {
  fail('Refusing a known demo password. Choose a unique strong password.');
}

// DEC-045: first-user-only. Once any staff exists the bootstrap path is closed.
const { data: anyStaff } = await db.from('staff_users').select('id').limit(1);
if (anyStaff && anyStaff.length) {
  fail('Bootstrap is closed: staff already exist. Sign in as admin and create staff in the Admin console.');
}

const { data: created, error } = await db.from('staff_users').insert({
  email, password_hash: bcrypt.hashSync(password, 10), role: 'admin',
  full_name: fullName, phone: process.env.ADMIN_PHONE || '+966500000000', is_active: true
}).select().single();
if (error) fail(error.message);

await db.from('audit_log').insert({
  action: 'ADMIN_BOOTSTRAPPED', actor_role: 'system', resource_type: 'staff',
  resource_id: created.id, detail: { email, via: 'create-admin.mjs' }
});

console.log(`ALO Super Admin created: ${email} (driver: ${IS_LOCAL ? 'local-embedded' : 'supabase'}).`);
console.log('This was a one-time bootstrap. Sign in at /login -> Staff sign-in; create all other staff in the Admin console.');
process.exit(0);