// DEC-051/052/053: Admin > WhatsApp — login OTP and status updates are independent
// switches, both OFF by default; the token is write-only; MARKETING is never sendable.
// Expects local dev mode (ENABLE_MOCK_WHATSAPP not false), like the other UI suites.
import { test, expect } from '@playwright/test';
import { staffLogin } from './helpers.js';

test('WhatsApp admin tab: independent OTP/updates toggles, OFF by default, masked token', async ({ page }) => {
  await staffLogin(page, 'admin@alodoc.com', 'Admin@12345');
  await page.goto('/admin');
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();

  // 1. Both channels OFF by default; badges follow the toggles, not the mock switch.
  const otpToggle = page.getByRole('checkbox').nth(0);
  const notifyToggle = page.getByRole('checkbox').nth(1);
  const modeLine = page.locator('p').filter({ hasText: 'Login OTP:' });
  await expect(otpToggle).not.toBeChecked();
  await expect(notifyToggle).not.toBeChecked();
  await expect(modeLine).toContainText('Login OTP: OFF');
  await expect(modeLine).toContainText('Status updates: OFF');
  await expect(page.getByText('Independent switches, both OFF by default')).toBeVisible();

  // 2. Save credentials; the token field is write-only and stays blank afterwards.
  const fields = page.locator('.grid2 input');
  await fields.nth(0).fill('886522121108941');
  await fields.nth(1).fill('1289698650889413');
  await fields.nth(2).fill('DUMMY-TOKEN-abcdef123456');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.msg.ok')).toHaveText('Saved');
  await expect(fields.nth(2)).toHaveValue('');
  await expect(page.getByText('token on file …3456')).toBeVisible();

  // 3. DEC-053: notifications cannot be enabled without a UTILITY template.
  await notifyToggle.check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.msg.err')).toContainText('Set a status-update (UTILITY) template');
  await notifyToggle.uncheck();

  // 4. DEC-052: enabling OTP must verify categories with Meta. A dummy token cannot
  // be verified, so the guard refuses and the channel stays OFF (no silent ON).
  await otpToggle.check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.msg.err')).toContainText('Could not reach Meta to verify template categories');
  await expect(modeLine).toContainText('Login OTP: OFF');

  // 5. Test send still works locally: the mock kill switch precedes the toggles.
  await page.getByPlaceholder('+9665XXXXXXXX').fill('+966500001001');
  await page.getByRole('button', { name: 'Send test OTP' }).click();
  await expect(page.locator('.msg.ok')).toContainText('Mock mode');

  // 6. Template inspector surfaces the provider error for a bad token.
  await page.getByRole('button', { name: 'Load templates' }).click();
  await expect(page.locator('.msg.err')).toContainText('WhatsApp API');

  // 7. Both OFF again, then clear the stored secret (restore the default state).
  await otpToggle.uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.msg.ok')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Clear saved token' }).click();
  await expect(page.locator('.msg.ok')).toHaveText('Saved');
  await expect(page.getByText('token on file')).toHaveCount(0);

  // 8. Bilingual + RTL (DEC-005).
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'واتساب', exact: true })).toBeVisible();
  await expect(page.getByText('رمز الدخول:')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
