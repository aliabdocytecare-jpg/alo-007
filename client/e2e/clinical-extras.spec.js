// Viewable session 8: (a) BR-023 Meet visibility window — Join appears inside the
// window, waiting-room text outside it; document soft-delete by coordinator disappears
// from the patient view. (b) US-PAT-002 AC2 — 5 wrong OTPs lock the account (UI proof).
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, staffLogin, pdfFile } from './helpers';

test('meet window + document lifecycle', async ({ page, browser }) => {
  const phone = `+9665${RUN}10`;
  await registerPatient(page, { name: 'Window Patient', phone });

  const coordCtx = await browser.newContext();
  const coord = await coordCtx.newPage();
  await staffLogin(coord, 'coordinator@alodoc.com', 'Coord@12345');
  const dir = await (await coord.request.get('/api/v1/staff/directory')).json();
  const doctor = dir.find(s => s.role === 'doctor');

  const mkCase = async reason => (await page.request.post('/api/v1/cases', {
    data: { service_type: 'CONSULTATION', service_subtype: 'ONLINE', specialty: 'General Medicine', reason }
  })).json();
  const prep = async (id, when, meet) => {
    await coord.request.post(`/api/v1/cases/${id}/confirm-payment`, { data: { note: 'ui window' } });
    await coord.request.post(`/api/v1/cases/${id}/assign`, { data: { staff_id: doctor.id } });
    await coord.request.post(`/api/v1/cases/${id}/schedule`, { data: { scheduled_at: when.toISOString() } });
    await coord.request.patch(`/api/v1/cases/${id}/meet-link`, { data: { meet_url: meet } });
  };

  // Case 1: appointment in 4 minutes -> inside join window (BR-023)
  const c1 = await mkCase('UI meet window soon case');
  await prep(c1.id, new Date(Date.now() + 4 * 60_000), 'https://meet.google.com/soo-nwin-dow');
  // Case 2: appointment in 3 hours -> link must NOT be visible yet
  const c2 = await mkCase('UI meet window later case');
  await prep(c2.id, new Date(Date.now() + 3 * 3600_000), 'https://meet.google.com/lat-erwin-dow');

  await page.goto(`/cases/${c1.id}`);
  const join = page.getByRole('link', { name: /Join Consultation/ });
  await expect(join).toBeVisible();
  await expect(join).toHaveAttribute('href', 'https://meet.google.com/soo-nwin-dow');
  await shot(page, 'm1-join-window-open');

  await page.goto(`/cases/${c2.id}`);
  await expect(page.getByText('Your meeting link will appear here 2 hours before your appointment.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Join Consultation/ })).toHaveCount(0);
  await expect(page.getByText('lat-erwin-dow')).toHaveCount(0);
  await shot(page, 'm2-join-window-hidden');

  // Document soft-delete: patient uploads, coordinator deletes, patient no longer sees it
  await page.goto(`/cases/${c1.id}`);
  await page.setInputFiles('#uploader-files', [pdfFile('to-delete.pdf')]);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const patRow = page.locator('tr', { hasText: 'to-delete.pdf' });
  await expect(patRow).toBeVisible();
  await expect(patRow.getByRole('button', { name: '×' })).toHaveCount(0); // patients cannot delete
  await coord.goto('/staff');
  await coord.locator('tr', { hasText: c1.case_number }).getByRole('link', { name: 'Open' }).click();
  await coord.locator('tr', { hasText: 'to-delete.pdf' }).getByRole('button', { name: '×' }).click();
  await expect(coord.locator('tr', { hasText: 'to-delete.pdf' })).toHaveCount(0);
  await shot(coord, 'm3-coordinator-deleted');
  await page.reload();
  await expect(page.locator('tr', { hasText: 'to-delete.pdf' })).toHaveCount(0);
  await shot(page, 'm4-patient-doc-gone');

  await coordCtx.close();
});

test('OTP lockout after 5 failures', async ({ page }) => {
  const phone = `+9665${RUN}12`;
  // Register first: an unknown phone shows the registration form, not OTP verify.
  await registerPatient(page, { name: 'Lockout Patient', phone });
  const loggedOut = page.waitForResponse(r => r.url().includes('/auth/logout'));
  await page.getByRole('button', { name: 'Logout' }).click();
  await loggedOut;
  await page.goto('/login');
  await expect(page.getByPlaceholder('+9665XXXXXXXX')).toBeVisible();
  await page.getByPlaceholder('+9665XXXXXXXX').fill(phone);
  await page.getByRole('button', { name: /Send OTP/ }).click();
  await expect(page.getByText(/Mock mode active/)).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.locator('input[maxlength="6"]').fill('000000');
    const failed = page.waitForResponse(r => r.url().includes('/auth/verify-otp') && r.status() === 401);
    await page.getByRole('button', { name: /Verify & Sign In/ }).click();
    await failed;
    await expect(page.getByText(/Incorrect OTP/)).toBeVisible();
  }
  await shot(page, 'm5-otp-failures');
  await page.locator('input[maxlength="6"]').fill('000000');
  await page.getByRole('button', { name: /Verify & Sign In/ }).click();
  await expect(page.getByText(/Account temporarily locked/)).toBeVisible();
  await shot(page, 'm6-otp-locked');
});