const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createWorkspaceReportsRouter } = require('../src/routes/workspaceReports');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-reports-ui');
const ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function model() {
  return {
    authority: { displayName: 'Christel', reportScope: 'all_business' },
    period: {
      preset: '30d',
      startKey: '2026-08-17',
      endInclusiveKey: '2026-09-15',
      dayCount: 30,
    },
    selectedStaffId: null,
    permittedStaff: [
      { id: 11, displayName: 'Abigail' },
      { id: 12, displayName: 'Christel' },
      { id: 13, displayName: 'Marietjie' },
    ],
    appointments: {
      operational: 54,
      allRecorded: 58,
      statusCounts: { scheduled: 18, completed: 36, cancelled: 4 },
    },
    totals: { bookedMinutes: 3420, remainingMinutes: 4980, utilisationPct: 41 },
    capacity: [
      { staffId: 11, name: 'Abigail', scheduledMinutes: 3120, bookedMinutes: 1380, blockedMinutes: 180, leaveMinutes: 240, remainingMinutes: 1320, utilisationPct: 51 },
      { staffId: 12, name: 'Christel', scheduledMinutes: 3300, bookedMinutes: 1260, blockedMinutes: 120, leaveMinutes: 0, remainingMinutes: 1920, utilisationPct: 40 },
      { staffId: 13, name: 'Marietjie', scheduledMinutes: 2940, bookedMinutes: 780, blockedMinutes: 120, leaveMinutes: 360, remainingMinutes: 1680, utilisationPct: 32 },
    ],
    services: [
      { name: 'Full Body Swedish', category: 'Massage', appointments: 17 },
      { name: 'Sports Massage Full Body', category: 'Massage', appointments: 14 },
      { name: 'Quick Relief: Back & Neck', category: 'Massage', appointments: 11 },
      { name: 'Medi-Heel Pedicure & Foot Massage', category: 'Feet', appointments: 8 },
    ],
    clients: { uniqueClients: 43, newClients: 12, returningClients: 31 },
    closures: 1,
    trend: { delta: 6, currentOperationalAppointments: 54, previousOperationalAppointments: 48 },
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let buildCalls = 0;
  const sessionService = {
    validateSessionToken: async token => token === 'synthetic-reports-session'
      ? { ok: true, adminId: 41 }
      : { ok: false },
  };
  const service = {
    async buildReport({ adminId }) {
      assert.equal(adminId, 41);
      buildCalls += 1;
      return model();
    },
  };

  const app = express();
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send(''));
  app.use('/calendar/reports', createWorkspaceReportsRouter({
    env: ENV,
    sessionService,
    service,
  }));

  const server = http.createServer(app);
  let browser;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({ headless: true });

    const unauthenticated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const unauthenticatedPage = await unauthenticated.newPage();
    const unauthorized = await unauthenticatedPage.goto(`${origin}/calendar/reports`, { waitUntil: 'networkidle' });
    assert.equal(unauthorized.status(), 401);
    await unauthenticated.close();

    const screenshots = [];
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 960 },
      { name: 'phone', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      await context.addCookies([{
        name: 'shiloh_staff_session',
        value: 'synthetic-reports-session',
        url: origin,
        httpOnly: true,
        sameSite: 'Strict',
      }]);
      const page = await context.newPage();
      const response = await page.goto(`${origin}/calendar/reports?range=30d`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      await page.locator('[data-workspace-reports="true"]').waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Reports', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'View report' }).isVisible(), true);
      assert.equal(await page.getByRole('heading', { name: 'Team booking time' }).isVisible(), true);
      assert.equal(await page.getByRole('heading', { name: 'Treatments booked' }).isVisible(), true);
      assert.equal(await page.getByRole('heading', { name: 'New and returning clients' }).isVisible(), true);

      const bodyText = await page.locator('body').innerText();
      assert.doesNotMatch(bodyText, /canonical|business-wide operational|practitioner authority|service snapshot|aggregate identity|utilisation|fail closed/i);

      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('button,input,select,a')]
          .filter(node => node.getClientRects().length > 0)
          .map(node => ({
            label: node.textContent.trim() || node.getAttribute('aria-label') || node.id,
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
          })),
      }));
      assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1, `${viewport.name} has horizontal overflow`);
      if (viewport.name === 'phone') {
        const tooSmall = geometry.targets.filter(target => target.height < 43 || target.width < 43);
        assert.deepEqual(tooSmall, [], `Phone controls must retain 44px touch targets: ${JSON.stringify(tooSmall)}`);
      }

      const accessibility = await new AxeBuilder({ page })
        .include('[data-workspace-reports="true"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact));
      assert.deepEqual(serious, [], `${viewport.name} accessibility violations: ${JSON.stringify(serious)}`);

      const file = `${viewport.name}-reports.png`;
      const filePath = path.join(OUT_DIR, file);
      await page.screenshot({ path: filePath, fullPage: true });
      screenshots.push({
        file,
        width: viewport.width,
        height: viewport.height,
        sha256: sha256(filePath),
        noHorizontalOverflow: true,
        accessibilitySeriousOrCritical: 0,
      });
      await context.close();
    }

    assert.ok(buildCalls >= 2);
    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      exactHead,
      authenticated: true,
      syntheticDataOnly: true,
      productionReads: 0,
      productionMutations: 0,
      providerWrites: 0,
      reportBuildCalls: buildCalls,
      screenshots,
    }, null, 2));
    console.log(`Authenticated Reports Playwright proof passed at ${exactHead}: Desktop + Phone; zero production reads/writes.`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
