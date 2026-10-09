const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['paid-booking-payment-ui.spec.js', 'client-treatment-credit.spec.js', 'workspace-card-accents.spec.js', 'workspace-action-consistency.spec.js', 'clinic-ipad-handover-ux.spec.js', 'ux-visual-accessibility.spec.js', 'clinic-ipad-ux-visual.spec.js', 'my-shiloh-passkey-ux.spec.js', 'workspace-compact-menu.spec.js', 'workspace-device-removal.spec.js', 'payment-status-return.spec.js', 'my-shiloh-couples-ux.spec.js', 'my-shiloh-booking-history-ux.spec.js', 'workspace-deposit-attention-ux.spec.js', 'workspace-action-refresh-polish.spec.js'],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  snapshotPathTemplate: '{testDir}/ux-baselines/{arg}{ext}',
  outputDir: 'artifacts/ux-playwright-results',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'artifacts/ux-playwright-report', open: 'never' }],
  ],
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: 'http://127.0.0.1:6006',
    locale: 'en-ZA',
    timezoneId: 'Africa/Johannesburg',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
