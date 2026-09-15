const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'workspace-reports-storybook.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: 'artifacts/workspace-reports-storybook',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'artifacts/workspace-reports-storybook-report', open: 'never' }],
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
