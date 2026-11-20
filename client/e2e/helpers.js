// Shared UI helpers for Playwright sessions.
import { expect } from '@playwright/test';

export const RUN = Date.now().toString().slice(-6);
// DEC-029: fullPage capture in HEADED Chromium expands the visual viewport and
// restores it asynchronously. Without settling, the next click can be dispatched
// against the still-tall viewport and land outside the real window (silent miss).
// Two animation frames guarantee the restore has been rendered before proceeding.
export const shot = async (page, name) => {
  await page.screenshot({ path: `e2e-shots/${name}.png`, fullPage: true });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};

export async function registerPatient(page, { name, phone, gender = 'FEMALE', lang = 'en' }) {
  await page.goto('/login');
  await page.getByPlaceholder('+9665XXXXXXXX').fill(phone);
  await page.getByRole('button', { name: /Send OTP|إرسال الرمز/ }).click();
  await expect(page.getByText(/Mock mode active|الوضع التجريبي/)).toBeVisible();
  await expect(page.getByText(/Create your patient account|أنشئ حساب مريض/)).toBeVisible(); // DEC-043: new-patient register state is explicit
  await page.locator('input[maxlength="6"]').fill('123456');
  await page.locator('section.box input').nth(2).fill(name);
  await page.locator('input[type="date"]').fill('1990-01-01');
  await page.locator('select').first().selectOption(gender);
  await page.getByRole('button', { name: /^Register$|^إنشاء حساب$/ }).click();
  await expect(page.locator('.cards .card')).toHaveCount(3);
}

export async function bookConsultation(page, reason) {
  await page.locator('.cards .card').first().click();
  await page.locator('select').nth(1).selectOption('General Medicine');
  await page.locator('select').nth(2).selectOption({ index: 1 });
  await page.locator('input[type="datetime-local"]').fill(futureSlot());
  await page.locator('textarea').first().fill(reason);
  await page.getByRole('button', { name: /Review & Submit|مراجعة وإرسال/ }).click();
  await expect(page.getByText(/Case created|تم إنشاء الحالة/)).toBeVisible();
  const text = await page.locator('section.box p strong').first().textContent();
  return text.replace(/.*:\s*/, '').trim();
}

export async function staffLogin(page, email, password) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Staff sign-in|دخول الموظفين/ }).click();
  const boxes = page.locator('section.box input');
  await boxes.nth(0).fill(email);
  await boxes.nth(1).fill(password);
  await page.locator('section.box button').last().click();
  await expect(page.locator('header.top')).toBeVisible();
}

export const pdfFile = name => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${name}`)
});

// DEC-033: dynamic future slot — hardcoded dates become past dates and break scheduling.
export const futureSlot = (days = 1, hour = 10) => {
  const d = new Date(Date.now() + days * 86400_000);
  d.setHours(hour, 0, 0, 0);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// DEC-033: dashboards list a case in several queues (Due Today + Assigned Cases);
// always open from the Assigned Cases section to keep locators strict-mode safe.
export const openAssignedCase = (page, caseNo) =>
  page.locator('details').filter({ hasText: 'Assigned Cases' })
    .locator('tr', { hasText: caseNo }).getByRole('link', { name: 'Open' }).click();