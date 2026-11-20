// Viewable session 1: same patient-entry flow for DIFFERENT patient entries (personas),
// including an Arabic-first persona to prove RTL + translated file controls.
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, bookConsultation } from './helpers';

const PERSONAS = [
  { name: 'Hessa Al-Rashidi', gender: 'FEMALE', lang: 'en' },
  { name: 'أحمد الحربي', gender: 'MALE', lang: 'ar' },
  { name: 'John Mathew', gender: 'MALE', lang: 'en' }
];

PERSONAS.forEach((p, i) => {
  test(`patient entry — ${p.name}`, async ({ page }) => {
    const phone = `+9665${RUN}${i}`;
    await registerPatient(page, { ...p, phone });
    await shot(page, `p${i}-1-home`);

    const caseNo = await bookConsultation(page, `UI verification for ${p.name}`);
    expect(caseNo).toMatch(/^ALO-\d{4}-\d{5}$/);
    await shot(page, `p${i}-2-confirmation`);

    await page.getByRole('link', { name: /View|عرض/ }).first().click();
    await expect(page.locator('.badge')).toBeVisible();
    await expect(page.getByText(/Next step|الخطوة التالية/)).toBeVisible();
    await expect(page.locator('.timeline li').first()).toBeVisible();
    // BR-016 regression: internal enums must never reach the patient UI
    await expect(page.locator('body')).not.toContainText('CONSULTATION /');
    await shot(page, `p${i}-3-caseview`);

    if (p.lang === 'ar') {
      await page.getByRole('button', { name: 'العربية' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByText('اختر الملفات')).toBeVisible();
      await expect(page.getByText('لم يتم اختيار ملف')).toBeVisible();
      await shot(page, `p${i}-4-arabic-rtl`);
    }

    await page.getByRole('link', { name: /My Cases|حالاتي/ }).first().click();
    await expect(page.getByText(caseNo)).toBeVisible();
    await shot(page, `p${i}-5-mycases`);
  });
});