// Viewable session 9: admin configuration with patient-side effect proof —
// services on/off + coming-soon (BR-026), SLA target persistence, staff-portals RTL.
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, staffLogin } from './helpers';

test('admin services/SLA config + staff RTL', async ({ page, browser }) => {
  const phone = `+9665${RUN}13`;
  await registerPatient(page, { name: 'Config Patient', phone });

  const admCtx = await browser.newContext();
  const adm = await admCtx.newPage();
  await staffLogin(adm, 'admin@alodoc.com', 'Admin@12345');
  await adm.goto('/admin');
  await adm.getByRole('button', { name: 'Services', exact: true }).click();
  const hijama = adm.locator('tr', { hasText: 'Hijama' });

  // 1) active OFF + coming OFF -> service hidden from patient catalog (BR-026)
  await hijama.getByRole('button').first().click();
  await expect(hijama.getByRole('button').first()).toHaveText('OFF');
  await page.goto('/book?type=SERVICE');
  await expect(page.locator('option[value="HIJAMA"]')).toHaveCount(0);

  // 2) coming-soon ON -> visible but not bookable, labelled Coming Soon
  await hijama.getByRole('button').nth(1).click();
  await expect(hijama.getByRole('button').nth(1)).toHaveText('ON');
  await page.reload();
  const opt = page.locator('option[value="HIJAMA"]');
  await expect(opt).toBeDisabled();
  await expect(opt).toContainText('Coming Soon');
  await shot(page, 'a3-coming-soon');

  // 3) back ON -> bookable again (restore seed state)
  await hijama.getByRole('button').first().click();
  await expect(hijama.getByRole('button').first()).toHaveText('ON');
  await page.reload();
  await expect(page.locator('option[value="HIJAMA"]')).toBeEnabled();
  await shot(adm, 'a4-services-restored');

  // SLA target edit persists across navigation
  await adm.getByRole('button', { name: 'SLA Targets' }).click();
  const slaRow = adm.locator('tr', { hasText: 'INITIAL_REVIEW' });
  const original = await slaRow.locator('input').inputValue();
  await slaRow.locator('input').fill('1234');
  const saved = adm.waitForResponse(r => r.url().includes('/admin/sla/INITIAL_REVIEW') && r.request().method() === 'PATCH');
  await slaRow.getByRole('button', { name: 'Save' }).click();
  await saved;
  await expect(adm.locator('.msg.ok')).toHaveText('OK');
  await adm.goto('/admin');
  await adm.getByRole('button', { name: 'SLA Targets' }).click();
  await expect(adm.locator('tr', { hasText: 'INITIAL_REVIEW' }).locator('input')).toHaveValue('1234');
  await shot(adm, 'a5-sla-saved');
  await adm.locator('tr', { hasText: 'INITIAL_REVIEW' }).locator('input').fill(original);
  const restored = adm.waitForResponse(r => r.url().includes('/admin/sla/INITIAL_REVIEW') && r.request().method() === 'PATCH');
  await adm.locator('tr', { hasText: 'INITIAL_REVIEW' }).getByRole('button', { name: 'Save' }).click();
  await restored;

  // Staff portal Arabic RTL (P7 beyond the patient portal)
  await adm.getByRole('button', { name: 'العربية' }).click();
  await expect(adm.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(adm.locator('h1')).toHaveText('المدير');
  await shot(adm, 'a6-staff-rtl');
  await adm.getByRole('button', { name: 'English' }).click();
  await expect(adm.locator('html')).toHaveAttribute('dir', 'ltr');

  await admCtx.close();
});