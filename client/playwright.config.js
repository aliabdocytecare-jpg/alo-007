import { defineConfig, devices } from '@playwright/test';

// Viewable UI sessions: `npm run test:ui` opens a real browser window (headed).
// `npm run test:ui:debug` opens the Playwright inspector for step-by-step watching.
// DEC-054: retired by default — these specs assert "Mock mode active" and OTP 123456, and
// would create patients/cases in the single production database. Kept for reference; opt in
// only against a disposable target with E2E_ALLOW=true.
if (process.env.E2E_ALLOW !== 'true') {
  throw new Error('UI suite retired (DEC-054): it requires mock auth + demo staff and writes to the production database. Test manually per TESTING.md, or set E2E_ALLOW=true only against a disposable target.');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } }
  ]
});