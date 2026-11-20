// Viewable session 7: follow-up booking with parent context (BR-012, US-PAT-012)
// and the in-app notification center (F-NOTIF-02). Clinical setup runs through the
// API (same pattern as the GMO session); every follow-up-specific step is real UI.
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, bookConsultation, staffLogin, futureSlot, openAssignedCase } from './helpers';

test('follow-up with parent context + notification center', async ({ page, browser }) => {
  const phone = `+9665${RUN}3`;
  await registerPatient(page, { name: 'Followup Patient', phone });
  const parentNo = await bookConsultation(page, 'UI followup parent case');

  // Fast-forward the parent to COMPLETED via API (UI-proven in sessions 3/4)
  const coordCtx = await browser.newContext();
  const coord = await coordCtx.newPage();
  await staffLogin(coord, 'coordinator@alodoc.com', 'Coord@12345');
  const cases = await (await coord.request.get('/api/v1/cases')).json();
  const parent = cases.find(c => c.case_number === parentNo);
  await coord.request.post(`/api/v1/cases/${parent.id}/confirm-payment`, { data: { note: 'ui followup' } });
  const dir = await (await coord.request.get('/api/v1/staff/directory')).json();
  const doctor = dir.find(s => s.role === 'doctor');
  await coord.request.post(`/api/v1/cases/${parent.id}/assign`, { data: { staff_id: doctor.id } });
  await coord.request.post(`/api/v1/cases/${parent.id}/schedule`, { data: { scheduled_at: new Date(futureSlot()).toISOString() } });

  const docCtx = await browser.newContext();
  const doc = await docCtx.newPage();
  await staffLogin(doc, 'doctor@alodoc.com', 'Doctor@12345');
  await doc.request.post(`/api/v1/cases/${parent.id}/start`);
  await doc.request.post(`/api/v1/cases/${parent.id}/report`, { data: { report: 'UI parent final report: resolved tension headache.' } });
  await coord.request.post(`/api/v1/cases/${parent.id}/release`);

  // Patient: request follow-up from the completed case — profile/history pre-filled
  await page.goto('/cases');
  await page.locator('tr', { hasText: parentNo }).getByRole('link', { name: 'View' }).click();
  await page.getByRole('link', { name: 'Request Follow-up' }).click();
  await expect(page.locator('h1')).toContainText(parentNo);
  await expect(page.locator('select').first()).toHaveValue('FOLLOW_UP');
  await expect(page.locator('textarea').first()).toHaveValue(/^Follow-up: UI followup parent case/);
  await shot(page, 'f1-followup-prefilled');
  await page.getByRole('button', { name: /Review & Submit/ }).click();
  await expect(page.getByText(/Case created/)).toBeVisible();
  const followNo = (await page.locator('section.box p strong').first().textContent()).replace(/.*:\s*/, '').trim();
  expect(followNo).not.toBe(parentNo);
  await shot(page, 'f2-followup-created');

  // Coordinator assigns the doctor; doctor sees the parent consultation context
  const cases2 = await (await coord.request.get('/api/v1/cases')).json();
  const follow = cases2.find(c => c.case_number === followNo);
  // DEC-035: assignment requires the ready window — confirm payment first.
  await coord.request.post(`/api/v1/cases/${follow.id}/confirm-payment`, { data: { note: 'ui followup assign' } });
  await coord.request.post(`/api/v1/cases/${follow.id}/assign`, { data: { staff_id: doctor.id } });
  await doc.goto('/staff');
  await openAssignedCase(doc, followNo);
  const ctxPanel = doc.locator('details', { hasText: 'Previous Consultation' });
  await expect(ctxPanel).toBeVisible();
  await expect(ctxPanel).toContainText(parentNo);
  await expect(ctxPanel).toContainText('UI parent final report');
  await shot(doc, 'f3-doctor-parent-context');

  // Patient notification center: unread count drops after Mark read
  await page.getByRole('link', { name: /Notifications/ }).first().click();
  const h1 = page.locator('h1');
  await expect(h1).toContainText('unread');
  const unreadOf = async () => parseInt(((await h1.textContent()).match(/\[(\d+)/) || [0, '0'])[1], 10);
  const before = await unreadOf();
  expect(before).toBeGreaterThan(0);
  await shot(page, 'f4-notifications');
  await page.getByRole('button', { name: 'Mark read' }).first().click();
  await expect.poll(unreadOf).toBe(before - 1);
  await shot(page, 'f5-notification-read');

  await coordCtx.close();
  await docCtx.close();
});