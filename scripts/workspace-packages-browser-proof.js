const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { PGlite } = require('@electric-sql/pglite');
const { createWorkspaceServicesService } = require('../src/services/workspaceServices');
const {
  createWorkspaceServiceCreationService,
} = require('../src/services/workspaceServiceCreation');
const { createWorkspacePackages } = require('../src/services/workspacePackages');
const { createWorkspaceServicesRouter } = require('../src/routes/workspaceServices');
const {
  createWorkspaceServicesMutationRouter,
} = require('../src/routes/workspaceServicesMutations');
const { createWorkspacePackagesRouter } = require('../src/routes/workspacePackages');
const { renderClientPackages } = require('../src/presentation/workspacePackagesUx');
const { renderMyShilohBookingPage } = require('../src/presentation/myShilohBooking');
const out = path.join(process.cwd(), 'artifacts', 'workspace-packages');
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const db = new PGlite();
  await db.exec(fs.readFileSync('tests/fixtures/package-schema.sql', 'utf8'));
  for (const file of ['061_massage_packages.sql', '185_workspace_packages_and_service_trash.sql'])
    await db.exec(fs.readFileSync('migrations/' + file, 'utf8'));
  const conn = {
    query: (...a) => db.query(...a),
    connect: async () => ({ query: (...a) => db.query(...a), release() {} }),
  };
  const service = createWorkspaceServicesService({ db: conn }),
    creation = createWorkspaceServiceCreationService({ db: conn }),
    packages = createWorkspacePackages({
      db: conn,
      serviceAuthority: service,
      creationAuthority: creation,
    });
  const env = {
    NODE_ENV: 'test',
    SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
  };
  const sessionService = {
    async validateSessionToken(token) {
      return token === 'synthetic'
        ? { ok: true, adminId: 1, viewer: { calendarScope: 'business_all_staff' }, sessionId: 1 }
        : { ok: false };
    },
    validateCsrfToken(_s, token) {
      return token === 'synthetic-csrf';
    },
  };
  const clientService = {
    async resolveAccess() {
      return true;
    },
    async listClients() {
      return {
        clients: [{ id: 101, name: 'Synthetic Client', normalized_mobile: 'Synthetic mobile' }],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/storybook', express.static('storybook-static'));
  app.post('/calendar/staff-auth/csrf', (_req, res) => res.json({ csrfToken: 'synthetic-csrf' }));
  app.get('/calendar/staff/client.js', (_req, res) => res.type('js').send(''));
  app.use(
    '/calendar/services/packages',
    createWorkspacePackagesRouter({
      sessionService,
      env,
      service: packages,
      creationService: creation,
      clientService,
    }),
  );
  app.use(
    '/calendar/services',
    createWorkspaceServicesRouter({
      sessionService,
      env,
      service,
      creationService: creation,
      clientAccessService: clientService,
      staffAccessService: {
        async resolveAccess() {
          return false;
        },
      },
    }),
  );
  app.use(
    '/calendar/services',
    createWorkspaceServicesMutationRouter({
      sessionService,
      env,
      service,
      creationService: creation,
    }),
  );
  app.get('/my-shiloh/packages', async (_req, res) =>
    res.send(renderClientPackages(await packages.forClient(101))),
  );
  app.get('/my-shiloh/book', (_req, res) =>
    res.send(
      renderMyShilohBookingPage({
        prepaidPackageMode: true,
        selectedServiceId: '3',
        csrfToken: 'test',
        catalogue: [
          {
            id: '3',
            name: 'Sports Massage package treatment',
            category: 'Prepaid treatments',
            duration: '50 min',
            price: 'R0',
          },
        ],
      }),
    ),
  );
  app.use('/my-shiloh/assets', express.static('public/my-shiloh/assets'));
  app.get('/my-shiloh/api/booking/practitioners', (_req, res) =>
    res.json({ practitioners: [{ id: 1, name: 'Clinic therapist', depositExempt: true }] }),
  );
  app.get('/my-shiloh/api/booking/availability', (_req, res) =>
    res.json({
      slots: [
        {
          startsAt: '2027-01-10T07:00:00Z',
          endsAt: '2027-01-10T07:50:00Z',
          time: '09:00',
          endTime: '09:50',
          practitionerId: 1,
          practitionerName: 'Clinic therapist',
        },
      ],
    }),
  );
  app.post('/my-shiloh/api/booking/confirm', (_req, res) =>
    res.json({ message: 'One prepaid treatment reserved. No further payment due.' }),
  );
  app.use((e, _req, res, _next) => res.status(500).json({ error: e.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const executablePath = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].find((p) => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 1000 }],
      ['phone', { width: 390, height: 844 }],
    ]) {
      const context = await browser.newContext({ viewport });
      await context.addCookies([{ name: 'shiloh_staff_session', value: 'synthetic', url: base }]);
      const page = await context.newPage();
      const failures = [];
      page.on('pageerror', (e) => failures.push(e.message));
      async function check(surface) {
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          'No horizontal overflow',
        );
        const a = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        assert.deepEqual(
          a.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          [],
        );
        await page.screenshot({
          path: path.join(out, name + '-' + surface + '.png'),
          fullPage: true,
        });
      }
      const storyIndex=JSON.parse(fs.readFileSync('storybook-static/index.json','utf8'));
      for (const entry of Object.values(storyIndex.entries).filter(e=>e.title==='Workspace/Packages')) {
        await page.goto(base+'/storybook/iframe.html?id='+entry.id+'&viewMode=story');
        await page.locator('#storybook-root h2:visible').first().waitFor();
        await check('storybook-'+entry.id);
      }
      await page.goto(base + '/calendar/services');
      await check('services');
      await page.locator('a.service-row').first().click();
      await page.getByRole('button', { name: 'Delete service', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete service', exact: true })
        .click();
      await page.waitForURL(base + '/calendar/services');
      await page.getByLabel('Status', { exact: true }).selectOption('deleted');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.locator('a.service-row').filter({ hasText: 'Sports Massage' }).first().click();
      await check('deleted');
      await page.getByRole('button', { name: 'Restore service', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Restore service', exact: true })
        .click();
      await page.waitForURL(/status=inactive/);
      await page.goto(base + '/calendar/services/1');
      await page.getByRole('button', { name: 'Reactivate service', exact: true }).click();
      await page.getByRole('button', { name: 'Deactivate service', exact: true }).waitFor();
      await page.goto(base + '/calendar/services/packages');
      await check('packages');
      await page.getByText('Edit package', { exact: true }).first().click();
      await check('package-edit');
      await page.getByText('Create a package', { exact: true }).click();
      const create = page.locator('[data-package-create]');
      await create
        .getByLabel('Package name', { exact: true })
        .fill('Synthetic ' + name + ' package');
      await create.getByLabel('Full upfront price (R)', { exact: true }).fill('900');
      await create
        .getByLabel('Client description', { exact: true })
        .fill('Three prepaid treatments within one month of the first treatment.');
      await create.getByLabel('Category', { exact: true }).selectOption('1');
      await create.getByLabel('Therapist', { exact: true }).check();
      await check('package-create');
      const created = page.waitForResponse(r => r.url() === base + '/calendar/services/packages/create' && r.request().method() === 'POST');
      const createReload = page.waitForNavigation({ waitUntil:'networkidle' });
      await create.getByRole('button', { name: 'Create package', exact: true }).click();
      const createResponse = await created;
      assert.equal(createResponse.status(), 201, createResponse.status() === 201 ? 'Package created' : await createResponse.text());
      await createReload;
      await page.getByRole('heading', { name: 'Synthetic ' + name + ' package', exact: true }).waitFor();
      if (name === 'desktop') {
        const payment = page.locator('[data-package-payment]');
        await payment.getByLabel('Package', { exact: true }).selectOption('1');
        await page.getByLabel('Find client', { exact: true }).fill('Synthetic');
        await page.getByRole('button', { name: 'Search clients', exact: true }).click();
        await payment.getByLabel('Matching clients', { exact: true }).selectOption('101');
        await payment
          .getByLabel('Receipt or payment reference', { exact: true })
          .fill('SYNTHETIC-ONLY');
        await payment
          .getByLabel('I confirm the full upfront amount has been received.', { exact: true })
          .check();
        await payment
          .getByRole('button', { name: 'Record payment & add treatments', exact: true })
          .click();
        const paymentReload = page.waitForNavigation({ waitUntil:'networkidle' });
        const recorded = page.waitForResponse(r => r.url() === base + '/calendar/services/packages/paid' && r.request().method() === 'POST');
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Record paid package', exact: true })
          .click();
        const paidResponse = await recorded;
        assert.equal(paidResponse.status(), 201, paidResponse.status() === 201 ? 'Payment recorded' : await paidResponse.text());
        await paymentReload;
      }
      await page.goto(base + '/my-shiloh/packages');
      await check('client-balance');
      assert.ok(
        await page.getByRole('link', { name: 'Book a package treatment', exact: true }).isVisible(),
      );
      await page.getByRole('link', { name: 'Book a package treatment', exact: true }).click();
      await page.getByRole('button', { name: /Clinic therapist/ }).waitFor();
      await check('prepaid-booking');
      assert.equal(await page.locator('[data-add-booking]').isVisible(), false);
      assert.deepEqual(failures, []);
      await context.close();
    }
    fs.writeFileSync(
      path.join(out, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          surfaces: [
            'services',
            'deleted',
            'packages',
            'package-edit',
            'package-create',
            'client-balance',
            'prepaid-booking',
          ],
          viewports: ['desktop', 'phone'],
          accessibility: 'WCAG 2 A/AA and 2.1 AA',
          authenticatedSynthetic: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await db.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
