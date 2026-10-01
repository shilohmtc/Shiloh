const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createFixture, createCertificate, chromeExecutable } = require('./calendar-operational-mutations-browser-proof');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-recovery-proof-'));
  const out = path.join(process.cwd(), 'artifacts', 'workspace-error-recovery');
  fs.mkdirSync(out, { recursive: true });
  const { app, state } = createFixture();
  state.recoveryFailure = 'CALENDAR_OPERATION_SERVICE_MAPPING';
  const server = https.createServer(createCertificate(directory), app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const evidence = [];
  try {
    browser = await chromium.launch({ executablePath: chromeExecutable() || undefined, args: ['--no-sandbox'] });
    for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1440, 960]]) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', () => errors.push('Unexpected native dialog'));
      state.recoveryManage = true;
      state.recoveryScope = true;
      await page.goto(`https://127.0.0.1:${server.address().port}/proof/christel`);
      await page.locator('[data-appointment-management-target="true"]').first().click();
      const panel = page.locator('[data-calendar-management-panel]');
      await panel.locator('[data-appointment-editor-toggle="practitioner"]').click();
      const form = panel.locator('[data-panel-action="appointment:reassign"]');
      await form.locator('select').selectOption('2');
      await form.locator('button[type="submit"]').click();
      const status = panel.locator('[data-calendar-panel-status]');
      await status.getByRole('button', { name: 'Choose another therapist' }).waitFor();
      assert.equal(await form.locator('select').inputValue(), '2');
      assert.equal(await status.getByRole('link', { name: 'Review therapist’s services' }).getAttribute('href'), '/calendar/services/901#service-practitioners');
      assert.equal(await status.getByRole('link').getAttribute('target'), '_blank');
      const attempts = state.requests.filter(request => request.path.endsWith('/reassign')).length;
      await status.getByRole('button', { name: 'Choose another therapist' }).click();
      assert.equal(await form.locator('select').evaluate(node => node === document.activeElement), true);
      assert.equal(state.requests.filter(request => request.path.endsWith('/reassign')).length, attempts);
      assert.equal(state.operations.length, 0);
      // Deliberately retry after reviewing, still refusing the incompatible assignment.
      await form.locator('button[type="submit"]').click();
      await status.getByRole('link', { name: 'Review therapist’s services' }).waitFor();
      const axe = await new AxeBuilder({ page }).include('[data-calendar-management-panel]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact)), []);
      assert.equal(await status.evaluate(node => {const box=node.getBoundingClientRect(),heading=node.closest('.management-card').querySelector('.panel-head').getBoundingClientRect();return box.right<=innerWidth&&box.top>=heading.bottom&&box.bottom<=innerHeight;}), true, 'Recovery text and controls must be visible below the sticky heading');
      await page.screenshot({ path: path.join(out, `${name}-service-mismatch.png`) });
      state.recoveryManage = false;
      await form.locator('button[type="submit"]').click();
      await status.getByText('Ask a clinic administrator', { exact: false }).waitFor();
      assert.equal(await status.getByRole('link', { name: 'Review therapist’s services' }).count(), 0);
      await page.screenshot({ path: path.join(out, `${name}-restricted-recovery.png`) });
      // Expired session recovery keeps the appointment form and selected therapist.
      await page.route('**/calendar/staff-auth/csrf', route => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
      await form.locator('button[type="submit"]').click();
      await status.getByRole('link', { name: 'Sign in to Workspace' }).waitFor();
      assert.equal(await form.locator('select').inputValue(), '2');
      assert.equal(await panel.evaluate(node => node.open), true);
      await page.screenshot({ path: path.join(out, `${name}-session-recovery.png`) });
      await page.unroute('**/calendar/staff-auth/csrf');
      // Changed records are reviewed separately; no destructive reload or replay.
      state.recoveryFailure = 'CALENDAR_OPERATION_STALE_REVISION';
      await form.locator('button[type="submit"]').click();
      await status.getByRole('link', { name: 'Review latest record' }).waitFor();
      assert.equal(await form.locator('select').inputValue(), '2');
      assert.equal(state.operations.length, 0);
      await page.screenshot({ path: path.join(out, `${name}-stale-recovery.png`) });
      evidence.push({ name, viewport: { width, height }, authenticated: true, writes: state.operations.length, seriousAccessibility: 0, errors });
      assert.deepEqual(errors, []);
      state.recoveryFailure = 'CALENDAR_OPERATION_SERVICE_MAPPING';
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), evidence }, null, 2));
    console.log('Authenticated Workspace error recovery Phone/Desktop proof passed; zero domain writes.');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
