// Bible F-NOTIF / Part 7. In-app always real; WhatsApp mocked behind flag (DEC-007/013).
// BR-017: callers must never put PHI (diagnosis, meds, clinical detail) in title/body.
import { db, MOCK_WHATSAPP } from '../config/db.js';

export async function notify({ event, caseId = null, recipientType, recipientId = null, title, body = '', channels = ['in-app', 'whatsapp'] }) {
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
    let status = 'sent';
    if (channel === 'whatsapp') status = MOCK_WHATSAPP ? 'mock_sent' : 'queued';
    if (channel === 'sms' || channel === 'email') status = 'queued'; // DEC-013: providers not wired yet
    await db.from('notification_log').insert({
      event_type: event, recipient_type: recipientType, recipient_id: recipientId, case_id: caseId,
      channel, template_id: event, delivery_status: status,
      failure_reason: status === 'queued' ? 'provider_not_configured' : null,
      detail: { title, body }
    });
    if (channel === 'whatsapp' && MOCK_WHATSAPP) {
      console.log(`[WhatsApp mock -> ${recipientType}:${recipientId || 'specialist'}] ${title} | ${body}`);
    }
  }
}

export async function notifyStaffRole(role, payload) {
  const { data: staff } = await db.from('staff_users').select().eq('role', role).eq('is_active', true);
  for (const s of staff || []) await notify({ ...payload, recipientType: 'staff', recipientId: s.id });
}

export const notifyCoordinators = payload => notifyStaffRole('coordinator', payload);
export const notifyAdmins = payload => notifyStaffRole('admin', payload);