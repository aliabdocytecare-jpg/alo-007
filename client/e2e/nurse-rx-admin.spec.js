// Viewable session 4: nurse intake (vitals + checklist + read-only lock), doctor
// prescriptions (formulary auto-fill + free text), and the admin console
// (staff lifecycle, formulary, audit filter, SLA targets). Ends with the patient
// seeing the released report AND prescriptions (BR-015).
import { test, expect } from '@playwright/test';
import { RUN, shot, registerPatient, bookConsultation, staffLogin, futureSlot, openAssignedCase } from './helpers';

test('nurse intake + prescriptions + admin console', async ({ page, browser }) => {
  page.on('dialog', d => d.accept());
  const phone = `+9665${RUN}4`;
  await registerPatient(page, { name: 'Clinical Patient', phone });
  const caseNo = await bookConsultation(page, 'UI clinical journey case');

  // Coordinator: payment + assign nurse
  const coordCtx = await browser.newContext();
  const coord = await coordCtx.newPage();
  coord.on('dialog', d => d.accept());
  await staffLogin(coord, 'coordinator@alodoc.com', 'Coord@12345');
  await coord.goto('/staff');
  await coord.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'Open' }).click();
  await coord.getByPlaceholder(/Payment note/).fill('UI clinical ref 7');
  await coord.getByRole('button', { name: 'Confirm Payment' }).click();
  await coord.getByTestId('assign-staff').selectOption({ label: 'Nour Al-Khalidi (Nurse)' });
  await coord.getByRole('button', { name: 'Assign', exact: true }).click();

  // Nurse: vitals, save, then complete intake -> read-only (US-NUR-001/002)
  const nurCtx = await browser.newContext();
  const nur = await nurCtx.newPage();
  await staffLogin(nur, 'nurse@alodoc.com', 'Nurse@12345');
  await openAssignedCase(nur, caseNo);
  await expect(nur.locator('td', { hasText: 'ID Document' })).toBeVisible(); // required-doc checklist
  await nur.getByPlaceholder('120/80').fill('118/76');
  await nur.locator('label:has-text("Heart rate") + input').fill('72');
  await nur.locator('label:has-text("Temperature") + input').fill('36.6');
  await nur.locator('label:has-text("Weight") + input').fill('70');
  await nur.locator('label:has-text("Height") + input').fill('170');
  await nur.locator('label:has-text("SpO2") + input').fill('98');
  await nur.locator('label:has-text("Nursing notes") + textarea').fill('Patient stable, no acute distress.');
  await nur.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(nur.locator('td', { hasText: '118/76' })).toBeVisible();
  await shot(nur, 'n1-nurse-vitals');
  await nur.getByRole('button', { name: /Complete Intake/ }).click();
  await expect(nur.getByText(/Intake completed — read-only/)).toBeVisible();
  await expect(nur.getByPlaceholder('120/80')).toHaveCount(0); // form locked
  await shot(nur, 'n2-intake-done');

  // Coordinator: assign doctor, schedule, Meet link
  await coord.reload();
  await coord.getByTestId('assign-staff').selectOption({ label: 'Emmanuel Arcon (Doctor · General Medicine)' });
  await coord.getByRole('button', { name: 'Assign', exact: true }).click();
  await coord.locator('input[type="datetime-local"]').fill(futureSlot(1, 11));
  await coord.getByRole('button', { name: 'Schedule Appointment' }).click();
  await coord.getByPlaceholder('https://meet.google.com/xxx-xxxx-xxx').fill('https://meet.google.com/uvw-xyzz-abc');
  await coord.getByRole('button', { name: 'Google Meet link' }).click();

  // Doctor: start, notes, then prescriptions (F-RX: formulary + free text)
  const docCtx = await browser.newContext();
  const doc = await docCtx.newPage();
  doc.on('dialog', d => d.accept());
  await staffLogin(doc, 'doctor@alodoc.com', 'Doctor@12345');
  await openAssignedCase(doc, caseNo);
  await expect(doc.getByText(/BP 118\/76/)).toBeVisible(); // nurse vitals visible to doctor
  await doc.getByRole('button', { name: 'Start Consultation' }).click();
  await doc.locator('label:has-text("Chief complaint") + input').fill('sore throat');
  await doc.locator('label:has-text("Plan") + textarea').fill('analgesia and rest');
  await doc.getByRole('button', { name: 'Save', exact: true }).click();

  await doc.locator('label:has-text("Select from Formulary") + select').selectOption({ label: 'Paracetamol (Panadol)' });
  await expect(doc.locator('label:has-text("Drug name") + input')).toHaveValue('Paracetamol');
  await expect(doc.locator('label:has-text("Dosage") + input')).toHaveValue('500 mg');
  await expect(doc.locator('label:has-text("Route") + input')).toHaveValue('Oral');
  await doc.locator('label:has-text("Frequency") + input').fill('3x daily');
  await doc.locator('label:has-text("Duration") + input').fill('5 days');
  await doc.locator('label:has-text("Special instructions") + input').fill('After meals');
  await doc.getByRole('button', { name: 'Add Prescription' }).click();
  await expect(doc.locator('td', { hasText: 'Paracetamol' })).toBeVisible();

  await doc.getByRole('button', { name: 'Free Text' }).click();
  await doc.locator('label:has-text("Drug name") + input').fill('Vitamin D3');
  await doc.locator('label:has-text("Dosage") + input').fill('1000 IU');
  await doc.getByRole('button', { name: 'Add Prescription' }).click();
  await expect(doc.locator('td', { hasText: 'Vitamin D3' })).toBeVisible();
  await expect(doc.locator('td', { hasText: 'FREE_TEXT' })).toBeVisible();
  await shot(doc, 'n3-doctor-rx');

  await doc.getByPlaceholder('Medical report').fill('UI clinical final report: pharyngitis, resolved with analgesia.');
  await doc.getByRole('button', { name: 'Submit Final Report' }).click();

  // Coordinator release -> patient sees report + prescriptions
  await coord.reload();
  await coord.getByRole('button', { name: 'Review & Release Report' }).click();
  await page.goto('/cases');
  await page.locator('tr', { hasText: caseNo }).getByRole('link', { name: 'View' }).click();
  await expect(page.getByText('UI clinical final report')).toBeVisible();
  await expect(page.locator('td', { hasText: 'Paracetamol' })).toBeVisible();
  await expect(page.locator('td', { hasText: 'Vitamin D3' })).toBeVisible();
  await shot(page, 'n4-patient-rx');

  // Admin console (US-ADM-001..005)
  const admCtx = await browser.newContext();
  const adm = await admCtx.newPage();
  await staffLogin(adm, 'admin@alodoc.com', 'Admin@12345');
  await adm.goto('/admin');
  await expect(adm.locator('tr', { hasText: 'Nour Al-Khalidi' })).toBeVisible();
  const tempEmail = `ui.temp.${RUN}@alodoc.com`;
  await adm.locator('label:has-text("Full name") + input').fill('UI Temp Nurse');
  await adm.locator('label:has-text("Email") + input').fill(tempEmail);
  await adm.locator('label:has-text("Phone") + input').fill('+966500000009');
  await adm.locator('label:has-text("Password") + input').fill('Temp@12345');
  await adm.getByRole('button', { name: 'Create Staff Account' }).click();
  const tempRow = adm.locator('tr', { hasText: tempEmail });
  await expect(tempRow).toBeVisible();
  await tempRow.getByRole('button', { name: 'Deactivate' }).click();
  await expect(tempRow.getByText('Inactive')).toBeVisible();
  await shot(adm, 'n5-admin-staff');

  await adm.getByRole('button', { name: 'Drug Formulary' }).click();
  await expect(adm.locator('tr', { hasText: 'Paracetamol' })).toBeVisible();
  await adm.getByRole('button', { name: 'Audit Logs' }).click();
  await adm.locator('select').first().selectOption('nurse');
  await adm.getByRole('button', { name: 'Apply' }).click();
  await expect(adm.locator('td', { hasText: 'INTAKE_COMPLETED' }).first()).toBeVisible();
  await shot(adm, 'n6-admin-audit');
  await adm.getByRole('button', { name: 'SLA Targets' }).click();
  await expect(adm.locator('td', { hasText: 'INITIAL_REVIEW' })).toBeVisible();

  await coordCtx.close();
  await nurCtx.close();
  await docCtx.close();
  await admCtx.close();
});