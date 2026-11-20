// Local development driver (DEC-001): embedded SQLite implementing the Supabase
// client query subset used by this codebase (DEC-002). Activated only when
// SUPABASE_URL is unset. Production uses the real Supabase SDK — same code.
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const STORAGE_DIR = path.join(__dirname, '..', '.local-storage');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const sqlite = new Database(path.join(DATA_DIR, 'alodoc.sqlite'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// ---- Schema (mirrors supabase/migrations/20261120_001_schema.sql) ----
sqlite.exec(`
create table if not exists patients (
  id text primary key, phone text unique not null, full_name text not null,
  dob text, gender text, nationality text, email text,
  preferred_lang text default 'en', created_at text not null
);
create table if not exists staff_users (
  id text primary key, email text unique not null, password_hash text not null,
  role text not null, full_name text not null, phone text, specialty text,
  is_active integer not null default 1, created_at text not null
);
create table if not exists specialties (
  id text primary key, name_en text unique not null, name_ar text, is_active integer not null default 1
);
create table if not exists services (
  id text primary key, code text unique not null, name_en text not null, name_ar text,
  is_active integer not null default 1, coming_soon integer not null default 0
);
create table if not exists cases (
  id text primary key, case_number text unique not null, patient_id text not null references patients(id),
  service_type text not null, service_subtype text, specialty text, purpose text, reason text,
  history text not null default '{}', status text not null default 'SUBMITTED',
  owner_id text references staff_users(id), owner_role text,
  sla_due_at text, sla_alerted integer not null default 0, next_action text,
  parent_case_id text references cases(id),
  payment_confirmed integer not null default 0, payment_note text, document_request_note text,
  intake_completed integer not null default 0, follow_up_recommended integer not null default 0,
  follow_up_note text, escalated integer not null default 0, cancel_reason text,
  version integer not null default 1, created_at text not null, updated_at text not null
);
create index if not exists cases_patient_idx on cases(patient_id);
create index if not exists cases_status_idx on cases(status);
create table if not exists case_assignments (
  id text primary key, case_id text not null references cases(id),
  staff_id text not null references staff_users(id), role text not null,
  assigned_by text, assigned_at text not null, unique (case_id, staff_id)
);
create index if not exists case_assignments_staff_idx on case_assignments(staff_id);
create table if not exists case_timeline (
  id text primary key, case_id text not null references cases(id),
  from_status text, to_status text, actor_id text, actor_role text, note text,
  patient_visible integer not null default 1, message_en text, message_ar text, created_at text not null
);
create index if not exists case_timeline_case_idx on case_timeline(case_id, created_at);
create table if not exists documents (
  id text primary key, case_id text not null references cases(id),
  uploader_id text, uploader_role text, category text default 'Other',
  file_name text not null, file_type text, file_size integer, storage_path text not null,
  is_deleted integer not null default 0, created_at text not null
);
create table if not exists consultations (
  id text primary key, case_id text unique not null references cases(id),
  doctor_id text references staff_users(id), consultation_type text, scheduled_at text,
  clinic_name text, clinic_address text, meet_url text,
  notes_draft text not null default '{}', notes_updated_at text,
  final_report text, submitted_at text, released_at text, released_by text,
  reminder_sent integer not null default 0, follow_up_recommended integer not null default 0,
  follow_up_timeframe text, follow_up_type text, follow_up_reason text
);
create table if not exists vitals (
  id text primary key, case_id text not null references cases(id), nurse_id text,
  blood_pressure text, heart_rate integer, temperature real, weight real, height real,
  spo2 integer, nursing_notes text, created_at text not null
);
create table if not exists magic_link_tokens (
  id text primary key, token_hash text unique not null, case_id text not null references cases(id),
  specialist_name text, specialist_phone text, created_by text, created_at text not null,
  expires_at text not null, opened_at text, draft_saved_at text, submitted_at text, used_at text, revoked_at text
);
create table if not exists international_reviews (
  id text primary key, case_id text unique not null references cases(id),
  findings text, recommendation text, status text not null default 'DRAFT',
  submitted_at text, released_at text, released_by text, updated_at text not null
);
create table if not exists prescriptions (
  id text primary key, case_id text not null references cases(id), doctor_id text,
  drug_name text not null, dosage text, frequency text, duration text, route text,
  special_instructions text, source text not null, formulary_id text, created_at text not null
);
create table if not exists drug_formulary (
  id text primary key, generic_name text not null, brand_name text,
  common_dosages text not null default '[]', route text,
  is_active integer not null default 1, created_at text not null, updated_at text not null
);
create table if not exists notifications (
  id text primary key, recipient_type text not null, recipient_id text, case_id text,
  event_type text not null, title text not null, body text,
  is_read integer not null default 0, created_at text not null
);
create index if not exists notifications_recipient_idx on notifications(recipient_type, recipient_id, is_read);
create table if not exists notification_log (
  id text primary key, event_type text not null, recipient_type text, recipient_id text,
  case_id text, channel text not null, template_id text,
  delivery_status text not null default 'sent', failure_reason text,
  retry_count integer not null default 0, detail text, sent_at text not null
);
create table if not exists audit_log (
  id text primary key, actor_id text, actor_role text, action text not null,
  resource_type text, resource_id text, detail text, ip_address text, created_at text not null
);
create index if not exists audit_log_created_idx on audit_log(created_at);
create table if not exists sla_config (
  status text primary key, target_minutes integer not null, updated_at text not null, updated_by text
);
create table if not exists system_settings (key text primary key, value text not null);
create table if not exists _sequences (name text primary key, value integer not null default 0);
insert or ignore into _sequences (name, value) values ('case_number', 0);
`);

// Column metadata for serialization parity with Postgres types
const META = {
  patients: { json: [], bool: [], pk: 'id', defaults: { preferred_lang: 'en' } },
  staff_users: { json: [], bool: ['is_active'], pk: 'id', defaults: { is_active: true } },
  specialties: { json: [], bool: ['is_active'], pk: 'id', defaults: { is_active: true } },
  services: { json: [], bool: ['is_active', 'coming_soon'], pk: 'id', defaults: { is_active: true, coming_soon: false } },
  cases: {
    json: ['history'], bool: ['payment_confirmed', 'intake_completed', 'follow_up_recommended', 'escalated', 'sla_alerted'],
    pk: 'id', updatedAt: true,
    defaults: { history: {}, status: 'SUBMITTED', payment_confirmed: false, intake_completed: false, follow_up_recommended: false, escalated: false, sla_alerted: false, version: 1, case_number: '$case_number' }
  },
  case_assignments: { json: [], bool: [], pk: 'id', defaults: { assigned_at: '$now' } },
  case_timeline: { json: [], bool: ['patient_visible'], pk: 'id', defaults: { patient_visible: true } },
  documents: { json: [], bool: ['is_deleted'], pk: 'id', defaults: { is_deleted: false, category: 'Other' } },
  consultations: { json: ['notes_draft'], bool: ['reminder_sent', 'follow_up_recommended'], pk: 'id', defaults: { notes_draft: {}, reminder_sent: false, follow_up_recommended: false } },
  vitals: { json: [], bool: [], pk: 'id', defaults: {} },
  magic_link_tokens: { json: [], bool: [], pk: 'id', defaults: {} },
  international_reviews: { json: [], bool: [], pk: 'id', updatedAt: true, defaults: { status: 'DRAFT' } },
  prescriptions: { json: [], bool: [], pk: 'id', defaults: {} },
  drug_formulary: { json: ['common_dosages'], bool: ['is_active'], pk: 'id', updatedAt: true, defaults: { common_dosages: [], is_active: true } },
  notifications: { json: [], bool: ['is_read'], pk: 'id', defaults: { is_read: false } },
  notification_log: { json: ['detail'], bool: [], pk: 'id', defaults: { delivery_status: 'sent', retry_count: 0 } },
  audit_log: { json: ['detail'], bool: [], pk: 'id', defaults: {} },
  sla_config: { json: [], bool: [], pk: 'status', defaults: {} },
  system_settings: { json: [], bool: [], pk: 'key', defaults: {} }
};
const TS_TABLES = new Set(['patients', 'staff_users', 'cases', 'case_timeline', 'documents', 'vitals', 'magic_link_tokens', 'prescriptions', 'drug_formulary', 'notifications', 'audit_log']);

const nowIso = () => new Date().toISOString();

function nextCaseNumber() {
  const row = sqlite.transaction(() => {
    sqlite.prepare("update _sequences set value = value + 1 where name = 'case_number'").run();
    return sqlite.prepare("select value from _sequences where name = 'case_number'").get();
  })();
  return `ALO-${new Date().getFullYear()}-${String(row.value).padStart(5, '0')}`;
}

function serialize(table, obj) {
  const m = META[table];
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) { out[k] = null; continue; }
    if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (m.json.includes(k) || Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

function deserialize(table, row) {
  if (!row) return row;
  const m = META[table];
  const out = { ...row };
  for (const k of m.json) {
    if (typeof out[k] === 'string') { try { out[k] = JSON.parse(out[k]); } catch { /* leave as-is */ } }
  }
  for (const k of m.bool) {
    if (out[k] === 1 || out[k] === 0) out[k] = out[k] === 1;
  }
  return out;
}

function withDefaults(table, row) {
  const m = META[table];
  const out = { ...row };
  if (m.pk === 'id' && !out.id) out.id = crypto.randomUUID();
  if (TS_TABLES.has(table) && !out.created_at) out.created_at = nowIso();
  if ((m.updatedAt || table === 'international_reviews') && !out.updated_at) out.updated_at = nowIso();
  if (table === 'notification_log' && !out.sent_at) out.sent_at = nowIso();
  if (table === 'sla_config' && !out.updated_at) out.updated_at = nowIso();
  for (const [k, v] of Object.entries(m.defaults)) {
    if (out[k] === undefined) out[k] = v === '$case_number' ? nextCaseNumber() : v === '$now' ? nowIso() : v;
  }
  return out;
}

class LocalQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orders = [];
    this._limit = null;
    this._returning = false;
    this.op = 'select';
  }
  select() { if (this.op !== 'select') this._returning = true; return this; }
  insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  upsert(row, opts = {}) { this.op = 'upsert'; this.rows = [row]; this.conflict = (opts.onConflict || META[this.table].pk).split(',').map(s => s.trim()); return this; }
  eq(c, v) { this.filters.push({ c, op: '=', v }); return this; }
  in(c, v) { this.filters.push({ c, op: 'in', v }); return this; }
  is(c, v) { this.filters.push({ c, op: 'is', v }); return this; }
  lt(c, v) { this.filters.push({ c, op: '<', v }); return this; }
  lte(c, v) { this.filters.push({ c, op: '<=', v }); return this; }
  gt(c, v) { this.filters.push({ c, op: '>', v }); return this; }
  gte(c, v) { this.filters.push({ c, op: '>=', v }); return this; }
  order(c, opts = {}) { this.orders.push({ c, asc: opts.ascending !== false }); return this; }
  limit(n) { this._limit = n; return this; }

  whereSql() {
    const parts = []; const params = [];
    for (const f of this.filters) {
      if (f.op === 'in') {
        if (!f.v.length) { parts.push('1 = 0'); continue; }
        parts.push(`${f.c} in (${f.v.map(() => '?').join(',')})`);
        params.push(...f.v);
      } else if (f.op === 'is') {
        parts.push(`${f.c} is ${f.v === null ? 'null' : '?'}`);
        if (f.v !== null) params.push(f.v);
      } else {
        parts.push(`${f.c} ${f.op} ?`);
        params.push(typeof f.v === 'boolean' ? (f.v ? 1 : 0) : f.v);
      }
    }
    return { sql: parts.length ? ` where ${parts.join(' and ')}` : '', params };
  }

  selectRows() {
    const { sql, params } = this.whereSql();
    let q = `select * from ${this.table}${sql}`;
    if (this.orders.length) q += ' order by ' + this.orders.map(o => `${o.c} ${o.asc ? 'asc' : 'desc'}`).join(', ');
    if (this._limit != null) q += ` limit ${Number(this._limit)}`;
    return sqlite.prepare(q).all(...params).map(r => deserialize(this.table, r));
  }

  exec() {
    try {
      const m = META[this.table];
      if (this.op === 'select') return { data: this.selectRows(), error: null };

      if (this.op === 'insert' || this.op === 'upsert') {
        const inserted = [];
        const run = sqlite.transaction(() => {
          for (const raw of this.rows) {
            const row = withDefaults(this.table, raw);
            const ser = serialize(this.table, row);
            const cols = Object.keys(ser);
            if (this.op === 'upsert') {
              const updates = cols.filter(c => !this.conflict.includes(c)).map(c => `${c} = excluded.${c}`);
              const sql = `insert into ${this.table} (${cols.join(',')}) values (${cols.map(() => '?').join(',')})
                on conflict (${this.conflict.join(',')}) do ${updates.length ? 'update set ' + updates.join(',') : 'nothing'}`;
              sqlite.prepare(sql).run(...cols.map(c => ser[c]));
              const pkWhere = this.conflict.map(c => `${c} = ?`).join(' and ');
              inserted.push(deserialize(this.table, sqlite.prepare(`select * from ${this.table} where ${pkWhere}`).get(...this.conflict.map(c => ser[c]))));
            } else {
              sqlite.prepare(`insert into ${this.table} (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`).run(...cols.map(c => ser[c]));
              inserted.push(deserialize(this.table, sqlite.prepare(`select * from ${this.table} where ${m.pk} = ?`).get(ser[m.pk])));
            }
          }
        });
        run();
        return { data: this._returning ? inserted : null, error: null };
      }

      if (this.op === 'update') {
        const before = this.selectRows();
        if (!before.length) return { data: this._returning ? [] : null, error: null };
        const patch = { ...this.patch };
        if (m.updatedAt) patch.updated_at = nowIso();
        const ser = serialize(this.table, patch);
        const cols = Object.keys(ser);
        const { sql, params } = this.whereSql();
        sqlite.prepare(`update ${this.table} set ${cols.map(c => `${c} = ?`).join(', ')}${sql}`).run(...cols.map(c => ser[c]), ...params);
        const ids = before.map(r => r[m.pk]);
        const data = sqlite.prepare(`select * from ${this.table} where ${m.pk} in (${ids.map(() => '?').join(',')})`).all(...ids).map(r => deserialize(this.table, r));
        return { data: this._returning ? data : null, error: null };
      }
      return { data: null, error: { message: 'Unsupported operation' } };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  }

  async single() {
    const r = this.exec();
    if (r.error) return r;
    if (!r.data || r.data.length !== 1) return { data: null, error: { message: 'Expected exactly one row', code: 'PGRST116' } };
    return { data: r.data[0], error: null };
  }
  async maybeSingle() {
    const r = this.exec();
    if (r.error) return r;
    if (!r.data || r.data.length === 0) return { data: null, error: null };
    if (r.data.length > 1) return { data: null, error: { message: 'Multiple rows returned', code: 'PGRST116' } };
    return { data: r.data[0], error: null };
  }
  then(onFulfilled, onRejected) { return Promise.resolve(this.exec()).then(onFulfilled, onRejected); }
}

// ---- Storage shim (DEC-003): private local files, same paths as Supabase bucket ----
const storage = {
  from(bucket) {
    const root = path.join(STORAGE_DIR, bucket);
    return {
      async upload(p, buffer, opts = {}) {
        const full = path.join(root, p);
        if (fs.existsSync(full) && !opts.upsert) return { data: null, error: { message: 'The resource already exists' } };
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, buffer);
        return { data: { path: p }, error: null };
      },
      async download(p) {
        const full = path.join(root, p);
        if (!fs.existsSync(full)) return { data: null, error: { message: 'Object not found' } };
        return { data: new Blob([fs.readFileSync(full)]), error: null };
      },
      async remove(paths) {
        for (const p of paths) { const full = path.join(root, p); if (fs.existsSync(full)) fs.unlinkSync(full); }
        return { data: paths, error: null };
      }
    };
  }
};

// ---- Seed (mirrors 20261120_002_seed.sql) ----
function seed() {
  const specialties = [
    ['General Medicine', 'الطب العام'], ['Internal Medicine', 'الطب الباطني'], ['Cardiology', 'أمراض القلب'],
    ['Oncology', 'الأورام'], ['Orthopedics', 'العظام'], ['Pediatrics', 'الأطفال'], ['Dermatology', 'الجلدية'], ['Neurology', 'الأعصاب']
  ];
  const insSpec = sqlite.prepare('insert or ignore into specialties (id, name_en, name_ar, is_active) values (?, ?, ?, 1)');
  for (const [en, ar] of specialties) insSpec.run(crypto.randomUUID(), en, ar);

  const services = [
    ['PHARMACY', 'Pharmacy / Medication', 'الصيدلة / الأدوية'],
    ['PHYSIOTHERAPY', 'Physiotherapy', 'العلاج الطبيعي'],
    ['HOME_NURSING', 'Home Nursing / Home Healthcare', 'التمريض المنزلي / الرعاية المنزلية'],
    ['HIJAMA', 'Hijama', 'الحجامة'],
    ['OTHER', 'Other Service', 'خدمة أخرى']
  ];
  const insSvc = sqlite.prepare('insert or ignore into services (id, code, name_en, name_ar, is_active, coming_soon) values (?, ?, ?, ?, 1, 0)');
  for (const [code, en, ar] of services) insSvc.run(crypto.randomUUID(), code, en, ar);

  const count = sqlite.prepare('select count(*) as n from drug_formulary').get().n;
  if (count === 0) {
    const drugs = [
      ['Paracetamol', 'Panadol', ['500 mg', '1 g'], 'Oral'],
      ['Ibuprofen', 'Brufen', ['200 mg', '400 mg'], 'Oral'],
      ['Amoxicillin', 'Amoxil', ['250 mg', '500 mg'], 'Oral'],
      ['Amoxicillin/Clavulanate', 'Augmentin', ['625 mg', '1 g'], 'Oral'],
      ['Azithromycin', 'Zithromax', ['250 mg', '500 mg'], 'Oral'],
      ['Metformin', 'Glucophage', ['500 mg', '850 mg', '1000 mg'], 'Oral'],
      ['Amlodipine', 'Norvasc', ['5 mg', '10 mg'], 'Oral'],
      ['Atorvastatin', 'Lipitor', ['10 mg', '20 mg', '40 mg'], 'Oral'],
      ['Omeprazole', 'Losec', ['20 mg', '40 mg'], 'Oral'],
      ['Salbutamol', 'Ventolin', ['100 mcg/puff'], 'Inhaled'],
      ['Cetirizine', 'Zyrtec', ['10 mg'], 'Oral'],
      ['Insulin Glargine', 'Lantus', ['100 IU/mL'], 'Subcutaneous']
    ];
    const insDrug = sqlite.prepare('insert into drug_formulary (id, generic_name, brand_name, common_dosages, route, is_active, created_at, updated_at) values (?, ?, ?, ?, ?, 1, ?, ?)');
    for (const [g, b, d, r] of drugs) insDrug.run(crypto.randomUUID(), g, b, JSON.stringify(d), r, nowIso(), nowIso());
  }

  const sla = [['SUBMITTED', 60], ['INITIAL_REVIEW', 1440], ['ADDITIONAL_INFO_REQUIRED', 4320], ['READY_FOR_ASSIGNMENT', 480], ['SPECIALIST_ASSIGNED', 240], ['UNDER_MEDICAL_REVIEW', 4320], ['APPOINTMENT_SCHEDULED', 1440], ['IN_PROGRESS', 240], ['REPORT_SUBMITTED', 480]];
  const insSla = sqlite.prepare('insert or ignore into sla_config (status, target_minutes, updated_at) values (?, ?, ?)');
  for (const [s, m] of sla) insSla.run(s, m, nowIso());

  const settings = [
    ['meet_visibility_hours', '2'],
    ['payment_instructions_en', 'Manual payment: please transfer the case fee to the AloDoc bank account (details sent via WhatsApp). Your coordinator will confirm receipt and your case will proceed.'],
    ['payment_instructions_ar', 'الدفع اليدوي: يرجى تحويل رسوم الحالة إلى الحساب البنكي لـ الو دوك (التفاصيل عبر واتساب). سيؤكد المنسق الاستلام وستتابع حالتك.']
  ];
  const insSet = sqlite.prepare('insert or ignore into system_settings (key, value) values (?, ?)');
  for (const [k, v] of settings) insSet.run(k, v);
}
seed();

export function createLocalClient() {
  return {
    from: table => {
      if (!META[table]) throw new Error(`Unknown table: ${table}`);
      return new LocalQuery(table);
    },
    rpc: async name => {
      if (name === 'next_case_number') return { data: nextCaseNumber(), error: null };
      return { data: null, error: { message: `Unknown rpc: ${name}` } };
    },
    storage
  };
}