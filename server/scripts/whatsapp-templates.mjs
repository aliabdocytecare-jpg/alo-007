// DEC-051: read-only inspector for the WhatsApp template library of a WABA.
// Lets ops confirm which templates are APPROVED and how many body variables each
// one expects before wiring an event to it (a param-count mismatch is rejected by Meta).
// Usage:
//   WHATSAPP_WABA_ID=... WHATSAPP_TOKEN=... node scripts/whatsapp-templates.mjs
//   WHATSAPP_WABA_ID=... WHATSAPP_TOKEN=... node scripts/whatsapp-templates.mjs otp   # name filter
import 'dotenv/config';

const VERSION = process.env.WHATSAPP_API_VERSION || 'v27.0';
const WABA_ID = process.env.WHATSAPP_WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const filter = (process.argv[2] || '').toLowerCase();

const fail = msg => { console.error(`ERROR: ${msg}`); process.exit(1); };
if (!WABA_ID) fail('WHATSAPP_WABA_ID is required.');
if (!TOKEN) fail('WHATSAPP_TOKEN is required.');

const url = `https://graph.facebook.com/${VERSION}/${WABA_ID}/message_templates`
  + '?fields=name,status,category,language,components&limit=200';
const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
const json = await res.json().catch(() => ({}));
if (!res.ok) fail(`${res.status}: ${json?.error?.message || 'request failed'}`);

const rows = (json.data || [])
  .filter(t => !filter || t.name.toLowerCase().includes(filter))
  .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));

if (!rows.length) { console.log('No templates matched.'); process.exit(0); }

for (const t of rows) {
  const comps = t.components || [];
  const body = comps.find(c => c.type === 'BODY');
  const footer = comps.find(c => c.type === 'FOOTER');
  const buttons = comps.find(c => c.type === 'BUTTONS');
  const vars = (body?.text || '').match(/\{\{\d+\}\}/g) || [];
  console.log(`\n${t.name}  [${t.language}]  ${t.category}  ${t.status}`);
  console.log(`  body vars: ${vars.length}${vars.length ? ` (${vars.join(', ')})` : ''}`);
  if (body?.text) console.log(`  body: ${body.text.replace(/\n/g, ' ⏎ ')}`);
  if (body?.example?.body_text) console.log(`  example: ${JSON.stringify(body.example.body_text)}`);
  if (footer?.text) console.log(`  footer: ${footer.text}`);
  for (const b of buttons?.buttons || []) {
    console.log(`  button: ${b.type}${b.otp_type ? `/${b.otp_type}` : ''} "${b.text || ''}"${b.url ? ` -> ${b.url}` : ''}`);
  }
}
// DEC-052: cost-policy audit — AloDoc may only send AUTHENTICATION / UTILITY.
const counts = {};
for (const t of rows) counts[t.category] = (counts[t.category] || 0) + 1;
console.log(`\n${rows.length} template(s): ${Object.entries(counts).map(([c, n]) => `${c}=${n}`).join(', ')}`);

const marketing = rows.filter(t => t.category === 'MARKETING');
if (marketing.length) {
  console.log('\nMARKETING — blocked for AloDoc (highest per-message rate):');
  for (const t of marketing) console.log(`  - ${t.name} [${t.language}] ${t.status}`);
}

// Meta classifies "unclear" bodies (essentially only {{1}}) as MARKETING.
const risky = rows.filter(t => {
  const text = (t.components || []).find(c => c.type === 'BODY')?.text || '';
  const vars = (text.match(/\{\{\d+\}\}/g) || []).length;
  const fixed = text.replace(/\{\{\d+\}\}/g, '').replace(/[\s\p{P}]/gu, '');
  return vars > 0 && fixed.length < 20 && t.category !== 'MARKETING';
});
if (risky.length) {
  console.log('\nVariable-only bodies — Meta may re-categorise these as MARKETING:');
  for (const t of risky) console.log(`  - ${t.name} [${t.language}]`);
}
if (!marketing.length && !risky.length) console.log('\nCost policy OK: no MARKETING templates and no variable-only bodies.');
