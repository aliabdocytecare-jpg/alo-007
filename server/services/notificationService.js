// Bible F-NOTIF / Part 7. In-app always real; WhatsApp is settings-driven (DEC-051).
// BR-017: callers must never put PHI (diagnosis, meds, clinical detail) in title/body.
import { db } from '../config/db.js';
import { getWhatsAppConfig, whatsappMode, sendBodyTemplate } from './whatsappService.js';

// Recipient phone lives on patients/staff_users; specialists pass it explicitly.
async function phoneFor(recipientType, recipientId) {
  if (!recipientId) return null;
  const table = recipientType === 'patient' ? 'patients' : recipientType === 'staff' ? 'staff_users' : null;
  if (!table) return null;
  const { data } = await db.from(table).select().eq('id', recipientId).maybeSingle();
  return data?.phone || null;
}

// DEC-051: returns {status, reason, messageId} so the log records what really happened.
// Mock mode keeps the pre-existing dev behaviour (terminal line, no network call).
async function whatsappSend({ recipientType, recipientId, recipientPhone, title, body }) {
  const cfg = await getWhatsAppConfig();
  const mode = whatsappMode(cfg, 'notify');
  if (mode === 'mock') {
    console.log(`[WhatsApp mock -> ${recipientType}:${recipientId || 'specialist'}] ${title} | ${body}`);
    return { status: 'mock_sent', reason: null };
  }
  if (!cfg.notifyEnabled) return { status: 'skipped', reason: 'notify_disabled' };
  if (!cfg.notifyTemplate) return { status: 'skipped', reason: 'notify_template_not_set' };
  if (mode === 'not_configured') return { status: 'failed', reason: 'whatsapp_not_configured' };
  const to = recipientPhone || await phoneFor(recipientType, recipientId);
  if (!to) return { status: 'skipped', reason: 'no_phone_on_file' };
  try {
    const r = await sendBodyTemplate(cfg, to, cfg.notifyTemplate, cfg.notifyLang, [title, body]);
    return { status: 'sent', reason: null, messageId: r?.messages?.[0]?.id };
  } catch (err) {
    console.error('[WhatsApp] send failed:', err.message);
    return { status: 'failed', reason: String(err.message).slice(0, 200) };
  }
}

export async function notify({ event, caseId = null, recipientType, recipientId = null, recipientPhone = null, title, body = '', channels = ['in-app', 'whatsapp'] }) {
  // Part 8.3 dedupe: same event + recipient + case within 60s is discarded.
  const since = new Date(Date.now() - 60_000).toISOString();
  let dupQuery = db.from('notification_log').select()
    .eq('event_type', event).eq('recipient_type', recipientType).gte('sent_at', since).limit(1);
  dupQuery = recipientId ? dupQuery.eq('recipient_id', recipientId) : dupQuery.is('recipient_id', null);
  if (caseId) dupQuery = dupQuery.eq('case_id', caseId);
  const { data: dup } = await dupQuery;
  if (dup?.length) return;

  if (recipientId && recipientType !== 'specialist') {
    await db.from('notifications').insert({
      recipient_type: recipientType, recipient_id: recipientId, case_id: caseId,
      event_type: event, title, body
    });
  }
  for (const channel of channels) {
    let status = 'sent', failureReason = null;
    const detail = { title, body };
    if (channel === 'whatsapp') {
      const out = await whatsappSend({ recipientType, recipientId, recipientPhone, title, body });
      status = out.status;
      failureReason = out.reason;
      if (out.messageId) detail.message_id = out.messageId;
    }
    if (channel === 'sms' || channel === 'email') { status = 'queued'; failureReason = 'provider_not_configured'; } // DEC-013: providers not wired yet
    await db.from('notification_log').insert({
      event_type: event, recipient_type: recipientType, recipient_id: recipientId, case_id: caseId,
      channel, template_id: event, delivery_status: status,
      failure_reason: failureReason,
      detail
    });
  }
}

export async function notifyStaffRole(role, payload) {
  const { data: staff } = await db.from('staff_users').select().eq('role', role).eq('is_active', true);
  for (const s of staff || []) await notify({ ...payload, recipientType: 'staff', recipientId: s.id });
}

export const notifyCoordinators = payload => notifyStaffRole('coordinator', payload);
export const notifyAdmins = payload => notifyStaffRole('admin', payload);