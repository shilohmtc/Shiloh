const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_DOWNLOAD_CONNECTION_TIMEOUT_MS,
  createInstallPlan,
} = require('../scripts/install-playwright-chromium');

test('Playwright installer requests only the headless Chromium browser with a longer timeout', () => {
  const plan = createInstallPlan({ PATH: '/test/bin' });

  assert.equal(plan.command, process.execPath);
  assert.match(plan.args[0], /@playwright[\\/]test[\\/]cli\.js$/);
  assert.deepEqual(plan.args.slice(1), ['install', '--only-shell', 'chromium']);
  assert.equal(
    plan.env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT,
    DEFAULT_DOWNLOAD_CONNECTION_TIMEOUT_MS,
  );
  assert.equal(plan.env.PATH, '/test/bin');
});

test('Playwright installer preserves an explicitly configured connection timeout', () => {
  const plan = createInstallPlan({ PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '240000' });

  assert.equal(plan.env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT, '240000');
});
