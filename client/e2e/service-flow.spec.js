// Viewable session 5: SERVICE request lifecycle (US-PAT-013) — patient requests a
// service, coordinator confirms payment, assigns staff, and completes the service
// via the UI (DEC-031), patient sees the completed case.
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, staffLogin } from './helpers';

test('service request lifecycle', async ({ page, browser }) => {
  page.on('dialog', d => d.accept());
  const phone = `+9665${RUN}5`;
  await registerPatient(page, { name: 'Service Patient', phone });
  await page.locator('.cards .card').nth(2).click();
  await page.locator('select').first().selectOption('PHARMACY');
  await page.locator('textarea').first().fill('UI monthly medication refill request');
  await page.getByRole('button', { name: /Review & Submit/ }).click();
  await expect(page.getByText(/Case created/)).toBeVisible();
  const caseNo = (await page.locator('section.box p strong').first().textContent()).replace(/.*:\s*/, '').trim();
  await shot(page, 's1-service-confirmation');

  const coordCtx = await browser.newContext();
  const coord = await coordCtx.newPage();
  coord.on('dialog', d => d.accept());
  await staffLogin(coord, 'coordinator@alodoc.com', 'Coord@12345');
  await coord.goto('/staff');
  await coord.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'Open' }).click();
  await coord.getByPlaceholder(/Payment note/).fill('UI service ref 9');
  await coord.getByRole('button', { name: 'Confirm Payment' }).click();
  await coord.getByTestId('assign-staff').selectOption({ label: 'Nour Al-Khalidi (Nurse)' });
  await coord.getByRole('button', { name: 'Assign', exact: true }).click();
  await coord.getByRole('button', { name: 'Complete Service' }).click();
  await expect(coord.locator('.badge')).toHaveText('Your case is complete');
  await shot(coord, 's2-service-completed');

  await page.goto('/cases');
  await page.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'View' }).click();
  await expect(page.locator('.badge')).toHaveText('Your case is complete');
  // DEC-032: service completion message, no phantom report box
  await expect(page.getByText(/Your service request is complete/)).toBeVisible();
  await expect(page.getByText(/report is being prepared/)).toHaveCount(0);
  await shot(page, 's3-service-patient-view');

  await coordCtx.close();
});