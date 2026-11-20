// Viewable session 3: complete consultation journey across all four portals,
// with a screenshot at every hand-off (Bible Test A through the real UI).
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, bookConsultation, staffLogin, futureSlot, openAssignedCase } from './helpers';

test('full consultation journey across portals', async ({ page, browser }) => {
  page.on('dialog', d => d.accept());
  const phone = `+9665${RUN}8`;
  await registerPatient(page, { name: 'Journey Patient', phone });
  const caseNo = await bookConsultation(page, 'UI journey headache case');
  await shot(page, 'j1-patient-confirmation');

  const coordCtx = await browser.newContext();
  const coord = await coordCtx.newPage();
  coord.on('dialog', d => d.accept());
  await staffLogin(coord, 'coordinator@alodoc.com', 'Coord@12345');
  await coord.goto('/staff');
  await shot(coord, 'j2-coordinator-dashboard');
  await coord.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'Open' }).click();

  await coord.getByPlaceholder(/Payment note/).fill('UI transfer ref 42');
  await coord.getByRole('button', { name: 'Confirm Payment' }).click();
  await coord.getByTestId('assign-staff').selectOption({ label: 'Emmanuel Arcon (Doctor · General Medicine)' });
  await coord.getByRole('button', { name: 'Assign', exact: true }).click();
  await coord.locator('input[type="datetime-local"]').fill(futureSlot());
  await coord.getByRole('button', { name: 'Schedule Appointment' }).click();
  await coord.getByPlaceholder('https://meet.google.com/xxx-xxxx-xxx').fill('https://meet.google.com/abc-defg-hij');
  await coord.getByRole('button', { name: 'Google Meet link' }).click();
  await shot(coord, 'j3-coordinator-scheduled');

  const docCtx = await browser.newContext();
  const doc = await docCtx.newPage();
  doc.on('dialog', d => d.accept());
  await staffLogin(doc, 'doctor@alodoc.com', 'Doctor@12345');
  await openAssignedCase(doc, caseNo);
  await doc.getByRole('button', { name: 'Start Consultation' }).click();
  await doc.locator('label:has-text("Chief complaint") + input').fill('headache');
  await doc.locator('label:has-text("Plan") + textarea').fill('rest and analgesia');
  await doc.getByRole('button', { name: 'Save', exact: true }).click();
  await doc.getByPlaceholder('Medical report').fill('UI journey final report: tension headache, resolved with rest.');
  await doc.getByRole('button', { name: 'Submit Final Report' }).click();
  await shot(doc, 'j4-doctor-report');

  await coord.reload();
  await coord.getByRole('button', { name: 'Review & Release Report' }).click();
  await shot(coord, 'j5-coordinator-released');

  await page.goto('/cases');
  await page.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'View' }).click();
  await expect(page.getByText('UI journey final report')).toBeVisible();
  await expect(page.getByRole('button', { name: /Print/ })).toBeVisible();
  await shot(page, 'j6-patient-report');

  await coordCtx.close();
  await docCtx.close();
});