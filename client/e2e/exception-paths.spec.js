// Viewable session 6: exception paths — coordinator requests documents (N-05),
// patient uploads and the case auto-resumes, coordinator escalates (admin alert),
// then cancels with a mandatory reason (N-14). Patient sees the reason and is
// blocked from booking a follow-up on a cancelled case (Part 8.4).
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, bookConsultation, staffLogin, pdfFile } from './helpers';

test('exception paths: docs request, escalate, cancel', async ({ page, browser }) => {
  page.on('dialog', d => d.accept());
  const phone = `+9665${RUN}6`;
  await registerPatient(page, { name: 'Exception Patient', phone });
  const caseNo = await bookConsultation(page, 'UI exception path case');

  const coordCtx = await browser.newContext();
  const coord = await coordCtx.newPage();
  coord.on('dialog', d => d.accept());
  await staffLogin(coord, 'coordinator@alodoc.com', 'Coord@12345');
  await coord.goto('/staff');
  await coord.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'Open' }).click();
  await coord.getByPlaceholder('Which documents are needed?').fill('Please upload your ID document');
  await coord.getByRole('button', { name: 'Request Documents' }).click();
  await expect(coord.locator('.badge')).toHaveText('We need a few more documents from you');

  // Patient: sees the request note, uploads, case auto-resumes to INITIAL_REVIEW
  await page.goto('/cases');
  await page.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'View' }).click();
  const caseId = page.url().split('/cases/')[1];
  await expect(page.locator('.badge')).toHaveText('We need a few more documents from you');
  await expect(page.locator('section.box', { hasText: 'Documents requested' }).getByText('Please upload your ID document')).toBeVisible();
  await shot(page, 'x1-docs-requested');
  await page.setInputFiles('#uploader-files', [pdfFile('id-document.pdf')]);
  await page.getByTestId('doc-category').selectOption('ID Document');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.locator('.badge')).toHaveText('Our team is reviewing your case');
  await expect(page.locator('td', { hasText: 'id-document.pdf' })).toBeVisible();
  await shot(page, 'x2-docs-resumed');

  // Coordinator: escalate (admin alert), then cancel with reason
  await coord.reload();
  await coord.getByPlaceholder('Escalation note').fill('UI escalation: patient unreachable');
  await coord.getByRole('button', { name: 'Escalate' }).click();
  await expect(coord.getByText('[Escalate]', { exact: true })).toBeVisible();
  await shot(coord, 'x3-escalated');
  await coord.getByPlaceholder('Cancellation reason (required)').fill('Patient requested cancellation');
  await coord.getByRole('button', { name: 'Cancel Case' }).click();
  await expect(coord.locator('.badge')).toHaveText('Cancelled');

  // Patient: cancelled badge + reason in timeline, no follow-up/service actions
  await page.reload();
  await expect(page.locator('.badge')).toHaveText('Cancelled');
  await expect(page.getByText('Patient requested cancellation')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request Follow-up' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Request Related Service' })).toHaveCount(0);
  await shot(page, 'x4-cancelled');

  // Part 8.4 negative: direct follow-up URL on a cancelled parent is rejected
  await page.goto(`/book?type=CONSULTATION&parent=${caseId}`);
  await page.getByRole('button', { name: /Review & Submit/ }).click();
  await expect(page.getByText(/follow-up cannot be created from a cancelled case/i)).toBeVisible();
  await shot(page, 'x5-followup-blocked');

  await coordCtx.close();
});