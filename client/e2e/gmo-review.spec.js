// Viewable session 2: GMO submission with real file uploads, then the anonymous
// mobile-style magic-link review (draft persistence, submit, auto-revoke).
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, staffLogin, pdfFile } from './helpers';

test('GMO submission + specialist magic-link review', async ({ page, browser }) => {
  const phone = `+9665${RUN}7`;
  await registerPatient(page, { name: 'GMO UI Patient', phone });
  await page.locator('.cards .card').nth(1).click();
  await page.locator('select').nth(0).selectOption('Oncology');
  await page.locator('select').nth(1).selectOption('Additional / Second Opinion');
  await page.locator('textarea').first().fill('UI GMO biopsy review request');
  await page.setInputFiles('#book-files', [pdfFile('biopsy-ui.pdf'), pdfFile('imaging-ui.pdf')]);
  await expect(page.getByText('biopsy-ui.pdf')).toBeVisible();
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Review & Submit/ }).click();
  await expect(page.getByText(/Case created/)).toBeVisible();
  const caseNo = (await page.locator('section.box p strong').first().textContent()).replace(/.*:\s*/, '').trim();
  await shot(page, 'gmo-1-confirmation');

  await page.getByRole('link', { name: /View/ }).first().click();
  await expect(page.getByText('biopsy-ui.pdf')).toBeVisible();
  await expect(page.getByText('imaging-ui.pdf')).toBeVisible();
  await shot(page, 'gmo-2-documents');

  // Coordinator ops via a second visible context
  const coordCtx = await browser.newContext();
  const coord = await coordCtx.newPage();
  coord.on('dialog', d => d.accept());
  await staffLogin(coord, 'coordinator@alodoc.com', 'Coord@12345');
  const cases = await (await coord.request.get('/api/v1/cases')).json();
  const target = cases.find(c => c.case_number === caseNo);
  await coord.request.post(`/api/v1/cases/${target.id}/confirm-payment`, { data: { note: 'ui gmo' } });
  const assignRes = await coord.request.post(`/api/v1/cases/${target.id}/assign`, { data: { specialist_name: 'UI Specialist', specialist_phone: '+919800000001' } });
  const { review_url } = await assignRes.json();
  await coord.goto('/staff');
  await shot(coord, 'gmo-3-coordinator-dashboard');

  // Anonymous specialist session (no login) — mobile-first page
  const revCtx = await browser.newContext();
  const rev = await revCtx.newPage();
  await rev.goto(review_url);
  await expect(rev.getByText(caseNo)).toBeVisible();
  await expect(rev.getByText('biopsy-ui.pdf', { exact: true })).toBeVisible();
  // DEC-030: PDF previews are click-to-load — open one to prove rendering works.
  await rev.getByRole('button', { name: /Preview PDF/ }).first().click();
  await expect(rev.locator('iframe.docframe')).toBeVisible();
  // Let the PDF viewer finish initializing (its focus-steal window) before form input.
  await rev.waitForTimeout(1200);
  await shot(rev, 'gmo-4-review-open');

  await rev.locator('textarea').nth(0).fill('UI clinical findings: records reviewed in full, benign features observed throughout the series.');
  await rev.locator('textarea').nth(1).fill('UI recommendation: routine surveillance in six months with clinical correlation advised.');
  await rev.getByRole('button', { name: /Save Draft/ }).click();
  await expect(rev.getByText(/Draft Saved/)).toBeVisible();
  await rev.reload();
  await expect(rev.locator('textarea').nth(0)).toHaveValue(/UI clinical findings/);
  await shot(rev, 'gmo-5-draft-restored');

  // US-INT-004: specialist requests more information -> coordinator timeline
  await rev.getByRole('button', { name: 'Request More Information' }).click();
  await rev.locator('textarea').nth(2).fill('Please confirm the biopsy date.');
  await rev.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(rev.getByText('OK', { exact: true })).toBeVisible();
  const coordView = await (await coord.request.get(`/api/v1/cases/${target.id}`)).json();
  expect(coordView.timeline.some(e => (e.note || '').includes('requests more information'))).toBe(true);

  rev.on('dialog', d => d.accept());
  await rev.getByRole('button', { name: /Submit Final Opinion/ }).click();
  await expect(rev.getByText(/Thank you/)).toBeVisible();
  await shot(rev, 'gmo-6-submitted');

  await rev.reload();
  await expect(rev.getByText(/no longer active/)).toBeVisible();
  await shot(rev, 'gmo-7-revoked');

  // Test B tail via UI: coordinator releases the opinion, patient reads it (BR-015)
  await coord.reload();
  await coord.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'Open' }).click();
  await coord.getByRole('button', { name: 'Review & Release Report' }).click();
  await expect(coord.locator('.badge')).toHaveText('Your case is complete');
  await shot(coord, 'gmo-8-released');

  await page.goto('/cases');
  await page.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'View' }).click();
  await expect(page.getByText(/UI clinical findings/)).toBeVisible();
  await expect(page.getByText(/UI recommendation/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Print/ })).toBeVisible();
  await shot(page, 'gmo-9-patient-opinion');

  await coordCtx.close();
  await revCtx.close();
});