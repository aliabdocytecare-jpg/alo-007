// DEC-037: schema-drift guard — the embedded SQLite driver (DEC-001) must mirror the
// Supabase migration, or the production switch silently breaks. Compares table and
// column names (types differ by dialect: text/jsonb/integer vs uuid/jsonb/boolean).
// Run: node scripts/schema-drift.mjs   (exit 1 on drift)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = {
  supabase: path.join(root, 'supabase', 'migrations', '20261120_001_schema.sql'),
  local: path.join(root, 'server', 'config', 'localDriver.js')
};

function tables(sql) {
  const clean = sql.replace(/--[^\n]*/g, '');
  const out = {};
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(clean))) {
    let depth = 1, i = re.lastIndex, body = '';
    while (i < clean.length && depth > 0) {
      const ch = clean[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth > 0) body += ch;
      i++;
    }
    // split on top-level commas only
    const parts = [];
    let d = 0, cur = '';
    for (const ch of body) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    const cols = new Set();
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      const first = t.split(/\s+/)[0].toLowerCase();
      if (['primary', 'unique', 'foreign', 'check', 'constraint', 'exclude'].includes(first)) continue;
      cols.add(first.replace(/["`]/g, ''));
    }
    out[m[1].toLowerCase()] = cols;
  }
  return out;
}

const a = tables(fs.readFileSync(files.supabase, 'utf8'));
const b = tables(fs.readFileSync(files.local, 'utf8'));
// Driver-internal bookkeeping (case-number sequence) — intentionally local-only.
delete b._sequences;
let drift = 0;
const namesA = Object.keys(a), namesB = Object.keys(b);
for (const t of namesA) if (!b[t]) { console.log(`MISSING in local driver: table ${t}`); drift++; }
for (const t of namesB) if (!a[t]) { console.log(`EXTRA in local driver: table ${t}`); drift++; }
for (const t of namesA.filter(t => b[t])) {
  for (const c of a[t]) if (!b[t].has(c)) { console.log(`MISSING in local driver: ${t}.${c}`); drift++; }
  for (const c of b[t]) if (!a[t].has(c)) { console.log(`EXTRA in local driver: ${t}.${c}`); drift++; }
}
console.log(`\nSupabase tables: ${namesA.length}, local tables: ${namesB.length}`);
if (drift) { console.log(`==== DRIFT: ${drift} difference(s) ====`); process.exit(1); }
console.log('==== SCHEMA IN SYNC ====');