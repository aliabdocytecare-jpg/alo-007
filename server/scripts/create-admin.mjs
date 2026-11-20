// DEC-039: production first-admin bootstrap (demo seeding is dev-only).
// Usage:
//   ADMIN_EMAIL=you@clinic.com ADMIN_PASSWORD='<strong>' ADMIN_NAME='Your Name' \
//     node scripts/create-admin.mjs
// Works against whichever driver is configured (local SQLite or real Supabase).
// After bootstrap, create the rest of the staff via Admin console (US-ADM-001).
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

const { data: existing } = await db.from('staff_users').select().eq('email', email).maybeSingle();
if (existing) fail(`An account already exists for ${email} (role: ${existing.role}).`);

const { error } = await db.from('staff_users').insert({
  email, password_hash: bcrypt.hashSync(password, 10), role: 'admin',
  full_name: fullName, phone: process.env.ADMIN_PHONE || '+966500000000', is_active: true
});
if (error) fail(error.message);

console.log(`Admin created: ${email} (driver: ${IS_LOCAL ? 'local-embedded' : 'supabase'}).`);
console.log('Sign in at /login -> Staff sign-in, then create staff in the Admin console.');
process.exit(0);