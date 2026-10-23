const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['workspace-client-documents-ux.spec.js', 'couples-request-flow-ux.spec.js', 'my-shiloh-whatsapp-retirement-ux.spec.js', 'client-planning-requests-ux.spec.js', 'workspace-client-delete-ux.spec.js', 'my-shiloh-booking-draft-ux.spec.js', 'booking-prior-payments.spec.js', 'staff-detail-signin-ux.spec.js', 'calendar-couples-editing.spec.js', 'my-shiloh-consultation-completion.spec.js', 'payment-method-client-credit.spec.js', 'south-african-phone-ui.spec.js', 'my-shiloh-crm-sign-in-ux.spec.js', 'paid-booking-payment-ui.spec.js', 'client-treatment-credit.spec.js', 'workspace-card-accents.spec.js', 'workspace-action-consistency.spec.js', 'clinic-ipad-handover-ux.spec.js', 'ux-visual-accessibility.spec.js', 'clinic-ipad-ux-visual.spec.js', 'my-shiloh-passkey-ux.spec.js', 'workspace-compact-menu.spec.js', 'workspace-device-removal.spec.js', 'payment-status-return.spec.js', 'my-shiloh-couples-ux.spec.js', 'my-shiloh-booking-history-ux.spec.js', 'workspace-deposit-attention-ux.spec.js', 'workspace-action-refresh-polish.spec.js'],
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

// Keep this focused addition separate from the shared browser catalogue.
module.exports.testMatch.push('payment-price-review-ux.spec.js');
module.exports.testMatch.push('planning-request-completion-ux.spec.js');
module.exports.testMatch.push('workspace-browser-review-ux.spec.js');
module.exports.testMatch.push('workspace-desktop-layout-ux.spec.js');

module.exports.testMatch.push('booking-deposit-waiver.spec.js', 'booking-deposit-waiver-client-payment.spec.js');
module.exports.testMatch.push('workspace-dashboard-deposit-organisation-ux.spec.js');

module.exports.testMatch.push('dashboard-deposit-waiver-shortcut.spec.js');
module.exports.testMatch.push('payment-waiver-alignment.spec.js');
module.exports.testMatch.push('rebook-action-style.spec.js');

module.exports.testMatch.push('notification-clarity.spec.js');

module.exports.testMatch.push('my-shiloh-assistant-upgrade.spec.js');

module.exports.testMatch.push('booking-problems-ux.spec.js');

module.exports.testMatch.push('calendar-appointment-details.spec.js');

module.exports.testMatch.push('workspace-return-status-visits.spec.js');

module.exports.testMatch.push('public-audit-followup.spec.js');
module.exports.testMatch.push('client-payment-choice.spec.js');

module.exports.testMatch.push('public-staff-workspace-menu.spec.js');

module.exports.testMatch.push('workspace-mobile-dashboard.spec.js');

module.exports.testMatch.push('app-update-versions.spec.js');
module.exports.testMatch.push("my-shiloh-optional-invitations.spec.js");

module.exports.testMatch.push("audit-form-return-labels.spec.js");

module.exports.testMatch.push('owner-phone-polish.spec.js');

module.exports.testMatch.push("workspace-account-finish.spec.js");

module.exports.testMatch.push('workspace-passkey-enrollment.spec.js');
module.exports.testMatch.push('calendar-couples-creation.spec.js');

module.exports.testMatch.push("website-publishing-ux.spec.js");

module.exports.testMatch.push('desktop-booking-handoff.spec.js');
