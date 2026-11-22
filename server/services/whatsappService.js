// DEC-051: WhatsApp Cloud API is configured by an admin (Admin > WhatsApp) and is
// OFF by default. Credentials live in system_settings so they can be rotated without
// a redeploy. ENABLE_MOCK_WHATSAPP (DEC-007) stays the local hard kill switch.
import { db, MOCK_WHATSAPP } from '../config/db.js';

export const DEFAULT_API_VERSION = 'v27.0';
export const DEFAULT_OTP_TEMPLATE = 'otp_verification';

// DEC-052: cost policy — AloDoc only ever sends AUTHENTICATION (OTP) or UTILITY
// (transactional status) templates. MARKETING is the most expensive category and
// Meta can re-categorise an approved template automatically (instantly, once an
// account has been warned), so category is re-checked at send time, not only on save.
export const REQUIRED_CATEGORY = { otp: 'AUTHENTICATION', notify: 'UTILITY' };
const CATEGORY_TTL_MS = 10 * 60_000;
const categoryCache = new Map(); // wabaId -> { at, byKey: Map('name|lang' -> template) }

export async function getWhatsAppConfig() {
  const { data } = await db.from('system_settings').select();
  const map = Object.fromEntries((data || []).map(s => [s.key, s.value]));
  return {
    otpEnabled: map.whatsapp_otp_enabled === 'true',
    notifyEnabled: map.whatsapp_notify_enabled === 'true',
    wabaId: map.whatsapp_waba_id || '',
    phoneNumberId: map.whatsapp_phone_number_id || '',
    token: map.whatsapp_token || '',
    apiVersion: map.whatsapp_api_version || DEFAULT_API_VERSION,
    otpTemplate: map.whatsapp_otp_template || DEFAULT_OTP_TEMPLATE,
    otpLang: map.whatsapp_otp_template_lang || 'en_US',
    otpProfileLang: map.whatsapp_otp_profile_lang !== 'false',
    notifyTemplate: map.whatsapp_notify_template || '',
    notifyLang: map.whatsapp_notify_template_lang || 'en_US'
  };
}

export const isConfigured = cfg => !!(cfg.phoneNumberId && cfg.token);

// mock -> local kill switch, no network call (unchanged dev behaviour)
// disabled -> that channel's toggle is OFF (default) | not_configured -> ON but incomplete
// live -> real Cloud API calls
// DEC-053: login OTP and status updates are switched independently, so one channel
// being OFF never blocks the other and a flow can be tested without billing a
// message at every step.
export function whatsappMode(cfg, channel = 'otp') {
  if (MOCK_WHATSAPP) return 'mock';
  if (!(channel === 'notify' ? cfg.notifyEnabled : cfg.otpEnabled)) return 'disabled';
  if (!isConfigured(cfg)) return 'not_configured';
  return 'live';
}

async function graph(cfg, path, body, method = 'POST') {
  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error || {};
    throw new Error(`WhatsApp API ${res.status}: ${e.error_user_msg || e.message || 'request failed'}`);
  }
  return json;
}

const digits = to => String(to || '').replace(/^\+/, '');

// DEC-005: bilingual product — follow the patient's preferred language when that
// template variant exists. Caller retries with cfg.otpLang if Meta rejects the variant.
export function otpLangFor(cfg, preferredLang) {
  if (!cfg.otpProfileLang) return cfg.otpLang;
  if (preferredLang === 'ar') return 'ar';
  if (preferredLang === 'en') return 'en_US';
  return cfg.otpLang;
}

// AUTHENTICATION template: Meta requires the code in BOTH body and button params.
export async function sendOtpTemplate(cfg, to, code, lang = cfg.otpLang) {
  await assertTemplateCategory(cfg, cfg.otpTemplate, lang, REQUIRED_CATEGORY.otp);
  return graph(cfg, `${cfg.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digits(to),
    type: 'template',
    template: {
      name: cfg.otpTemplate,
      language: { code: lang },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }
      ]
    }
  });
}

// Read-only library inspector for the admin screen: shows which templates are
// APPROVED and how many body variables each expects (a mismatch is rejected by Meta).
export async function listTemplates(cfg) {
  const json = await graph(cfg, `${cfg.wabaId}/message_templates?fields=name,status,category,language,components&limit=200`, null, 'GET');
  return (json.data || []).map(t => {
    const comps = t.components || [];
    const body = comps.find(c => c.type === 'BODY');
    const buttons = comps.find(c => c.type === 'BUTTONS');
    const text = body?.text || '';
    const vars = (text.match(/\{\{\d+\}\}/g) || []).length;
    // Meta treats "unclear" bodies (essentially only {{1}}) as MARKETING, so a
    // variable-only template is a re-categorisation risk even if approved as UTILITY.
    const fixed = text.replace(/\{\{\d+\}\}/g, '').replace(/[\s\p{P}]/gu, '');
    return {
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      body_vars: vars,
      marketing_risk: vars > 0 && fixed.length < 20,
      body: text,
      buttons: (buttons?.buttons || []).map(b => ({ type: b.type, text: b.text || '', url: b.url || '' }))
    };
  });
}

// Cached template index. Stale-while-revalidate: a transient Graph failure must not
// break login, but we still enforce the last known categories instead of failing open.
async function templateIndex(cfg, { force = false } = {}) {
  const hit = categoryCache.get(cfg.wabaId);
  if (!force && hit && Date.now() - hit.at < CATEGORY_TTL_MS) return hit.byKey;
  try {
    const items = await listTemplates(cfg);
    const byKey = new Map(items.map(t => [`${t.name}|${t.language}`, t]));
    categoryCache.set(cfg.wabaId, { at: Date.now(), byKey });
    return byKey;
  } catch (err) {
    if (hit) {
      console.warn('[WhatsApp] category refresh failed, using cached categories:', err.message);
      return hit.byKey;
    }
    console.warn('[WhatsApp] category lookup unavailable:', err.message);
    return null;
  }
}

// DEC-052: hard block before any spend. Unknown category (lookup never succeeded)
// is allowed through — config-time validation already ran and Meta rejects bad sends.
export async function assertTemplateCategory(cfg, name, lang, expected) {
  const byKey = await templateIndex(cfg);
  if (!byKey) return { ok: true, unknown: true };
  const t = byKey.get(`${name}|${lang}`);
  if (!t) throw new Error(`WhatsApp template "${name}" [${lang}] was not found on this WABA.`);
  if (t.category === 'MARKETING') {
    throw new Error(`Blocked by cost policy: template "${name}" is MARKETING. AloDoc sends AUTHENTICATION/UTILITY only.`);
  }
  if (t.category !== expected) throw new Error(`Template "${name}" is ${t.category}; ${expected} is required here.`);
  if (t.status !== 'APPROVED') throw new Error(`Template "${name}" [${lang}] is ${t.status}, not APPROVED.`);
  return { ok: true, template: t };
}

// Periodic drift check: reports configured templates that Meta re-categorised,
// unapproved, or deleted, so an admin can act before sends start failing.
export async function checkTemplateDrift(cfg) {
  const byKey = await templateIndex(cfg, { force: true });
  if (!byKey) return [];
  const checks = [];
  if (cfg.otpEnabled) checks.push([cfg.otpTemplate, cfg.otpLang, REQUIRED_CATEGORY.otp]);
  if (cfg.notifyEnabled && cfg.notifyTemplate) checks.push([cfg.notifyTemplate, cfg.notifyLang, REQUIRED_CATEGORY.notify]);
  const problems = [];
  for (const [name, lang, expected] of checks) {
    const t = byKey.get(`${name}|${lang}`);
    if (!t) problems.push({ name, lang, expected, issue: 'not found on the WABA' });
    else if (t.category !== expected) problems.push({ name, lang, expected, issue: `category is ${t.category}` });
    else if (t.status !== 'APPROVED') problems.push({ name, lang, expected, issue: `status is ${t.status}` });
  }
  return problems;
}

// Config-time validation with a fresh lookup: the templates of the channels being
// enabled/changed must exist, be APPROVED and sit in the allowed category.
export async function validateConfiguredTemplates(cfg, { otp = true, notify = true } = {}) {
  const byKey = await templateIndex(cfg, { force: true });
  if (!byKey) {
    throw Object.assign(new Error('Could not reach Meta to verify template categories. Please try again.'), { status: 502 });
  }
  if (otp) await assertTemplateCategory(cfg, cfg.otpTemplate, cfg.otpLang, REQUIRED_CATEGORY.otp);
  if (notify && cfg.notifyTemplate) await assertTemplateCategory(cfg, cfg.notifyTemplate, cfg.notifyLang, REQUIRED_CATEGORY.notify);
}

// UTILITY template for status updates; params must match the approved body variables.
export async function sendBodyTemplate(cfg, to, name, lang, params) {
  await assertTemplateCategory(cfg, name, lang, REQUIRED_CATEGORY.notify);
  return graph(cfg, `${cfg.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digits(to),
    type: 'template',
    template: {
      name,
      language: { code: lang },
      components: [{
        type: 'body',
        parameters: params.map(text => ({ type: 'text', text: String(text ?? '').slice(0, 1000) }))
      }]
    }
  });
}
