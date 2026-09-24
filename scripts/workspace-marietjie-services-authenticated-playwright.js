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
const { createWorkspaceServicesRouter } = require('../src/routes/workspaceServices');
const { createWorkspaceServicesMutationRouter } = require('../src/routes/workspaceServicesMutations');
const { requireStaffSession, sameOriginGuard } = require('../src/middleware/staffBrowserSession');
const { WorkspaceServicesError } = require('../src/services/workspaceServices');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-marietjie-services-ui');
const ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};
const SESSION_TOKEN = 'synthetic-marietjie-services-session';
const CSRF_TOKEN = 'synthetic-marietjie-services-csrf';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function serviceRows() {
  return [
    {
      id: 7,
      name: 'Marietjie Signature Massage',
      category_name: 'Massage',
      duration_minutes: 60,
      processing_time_minutes: 0,
      extra_time_minutes: 0,
      total_minutes: 60,
      variable_price: false,
      price: '650.00',
      display_price: null,
      status: 'active',
      assigned_staff_count: 1,
      client_bookable_staff_count: 1,
      booking_eligibility: { eligible: true, clientBookableStaffCount: 1 },
    },
    {
      id: 8,
      name: 'Marietjie Deep Tissue',
      category_name: 'Massage',
      duration_minutes: 75,
      processing_time_minutes: 0,
      extra_time_minutes: 0,
      total_minutes: 75,
      variable_price: false,
      price: '780.00',
      display_price: null,
      status: 'active',
      assigned_staff_count: 1,
      client_bookable_staff_count: 1,
      booking_eligibility: { eligible: true, clientBookableStaffCount: 1 },
    },
  ];
}

function authority(capability = 'services:view') {
  return {
    key: capability === 'services:manage' ? 'workspace_services_manage_v1' : 'workspace_services_view_v1',
    operatorAdminId: 81,
    displayName: 'Marietjie',
    linkedStaffId: 55,
    businessRole: 'tenant_practitioner',
    serviceScope: 'own_services',
    capability,
  };
}

function listModel() {
  return {
    authority: authority(),
    services: serviceRows(),
    hasMore: false,
    offset: 0,
    pageSize: 30,
    query: '',
    status: 'active',
  };
}

function detailModel() {
  return {
    authority: authority(),
    service: {
      ...serviceRows()[0],
      category_id: 3,
      revision: 'a'.repeat(64),
      customer_description: 'A treatment in Marietjie’s assigned service set.',
      booking_note: 'Please arrive a few minutes before your appointment.',
    },
    categories: [
      { id: 1, name: 'Pedicures & Foot Care', displayOrder: 1, status: 'active' },
      { id: 3, name: 'Massage', displayOrder: 3, status: 'active' },
    ],
    assignedStaff: [
      { id: 55, display_name: 'Marietjie', resource_type: 'practitioner', status: 'active', client_bookable: true },
    ],
    practitioners: [
      { id: 55, display_name: 'Marietjie', status: 'active', client_bookable: true, assigned: true },
      { id: 56, display_name: 'Abigail', status: 'active', client_bookable: true, assigned: false },
    ],
    bookingEligibility: { eligible: true, clientBookableStaffCount: 1, authority: 'read_projection_only' },
  };
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let updateCalls = 0;
  let lastUpdate = null;
  let descriptionCalls = 0;
  let lastDescription = null;
  const sessionService = {
    validateSessionToken: async token => token === SESSION_TOKEN
      ? {
          ok: true,
          adminId: 81,
          sessionId: 'synthetic-marietjie-session-id',
          viewer: { id: 81, displayName: 'Marietjie' },
        }
      : { ok: false },
    rotateCsrfToken: async sessionId => {
      assert.equal(sessionId, 'synthetic-marietjie-session-id');
      return { csrfToken: CSRF_TOKEN };
    },
    validateCsrfToken: (_session, token) => token === CSRF_TOKEN,
  };

  const service = {
    async resolveAccess(adminId) {
      assert.equal(adminId, 81);
      return authority('services:view');
    },
    async resolveManageAccess(adminId) {
      assert.equal(adminId, 81);
      return authority('services:manage');
    },
    async listServices({ adminId }) {
      assert.equal(adminId, 81);
      return listModel();
    },
    async getServiceDetail({ adminId, serviceId }) {
      assert.equal(adminId, 81);
      if (Number(serviceId) !== 7) {
        throw new WorkspaceServicesError('WORKSPACE_SERVICE_NOT_FOUND', 'Service was not found.', 404);
      }
      return detailModel();
    },
    async updateService(input) {
      assert.equal(input.adminId, 81);
      assert.equal(Number(input.serviceId), 7);
      updateCalls += 1;
      lastUpdate = input;
      return { status: 'updated', serviceId: 7, revision: 'b'.repeat(64) };
    },
    async updateCustomerDescription(input) {
      assert.equal(input.adminId, 81);
      assert.equal(Number(input.serviceId), 7);
      descriptionCalls += 1;
      lastDescription = input;
      return { status: 'updated', serviceId: 7, revision: 'c'.repeat(64) };
    },
    async setServiceStatus() { throw new Error('status mutation is not part of this proof'); },
    async assignPractitioner() { throw new Error('assignment mutation is not part of this proof'); },
    async unassignPractitioner() { throw new Error('unassignment mutation is not part of this proof'); },
  };

  const creationService = {
    async resolveCreateAccess() { return null; },
    async listCreateOptions() {
      throw new WorkspaceServicesError('WORKSPACE_SERVICES_CREATE_FORBIDDEN', 'Service creation is not permitted.', 403);
    },
    async createService() {
      throw new WorkspaceServicesError('WORKSPACE_SERVICES_CREATE_FORBIDDEN', 'Service creation is not permitted.', 403);
    },
  };
  const noAccessService = { async resolveAccess() { return null; } };

  const app = express();
  app.use(express.json());
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send("'use strict';"));
  const requireSession = requireStaffSession({ service: sessionService, env: ENV });
  app.post('/calendar/staff-auth/csrf', sameOriginGuard({ env: ENV }), requireSession, async (req, res) => {
    const rotated = await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
    return res.status(200).json({ csrfToken: rotated.csrfToken });
  });
  app.use('/calendar/services', createWorkspaceServicesRouter({
    env: ENV,
    sessionService,
    service,
    creationService,
    clientAccessService: noAccessService,
    staffAccessService: noAccessService,
  }));
  app.use('/calendar/services', createWorkspaceServicesMutationRouter({
    env: ENV,
    sessionService,
    service,
    creationService,
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
    const unauthorized = await unauthenticatedPage.goto(`${origin}/calendar/services`, { waitUntil: 'networkidle' });
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
        value: SESSION_TOKEN,
        url: origin,
        httpOnly: true,
        sameSite: 'Strict',
      }]);
      const page = await context.newPage();

      const listResponse = await page.goto(`${origin}/calendar/services`, { waitUntil: 'networkidle' });
      assert.equal(listResponse.status(), 200);
      await page.locator('[data-workspace-services="true"]').waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Services', exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Marietjie Signature Massage', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Marietjie Deep Tissue', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('+ Add service', { exact: true }).count(), 0);
      assert.equal(await page.locator('.service-row').count(), 2);

      const detailResponse = await page.goto(`${origin}/calendar/services/7`, { waitUntil: 'networkidle' });
      assert.equal(detailResponse.status(), 200);
      await page.locator('[data-service-edit-form]').waitFor();
      assert.equal(await page.locator('[data-service-edit-form]').isVisible(), true);
      assert.equal(await page.getByLabel('Category').inputValue(), '3');
      assert.equal(await page.getByLabel('Category').locator('option').filter({ hasText: 'Pedicures & Foot Care' }).count(), 1);
      assert.equal(await page.locator('[data-service-description-form]').isVisible(), true);
      assert.equal(await page.locator('[data-description-preview]').isVisible(), true);
      assert.equal(await page.locator('[data-service-assign-form]').isVisible(), true);

      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('button,input:not([type="checkbox"]),textarea,select,a,.check-field')]
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
        .include('[data-workspace-services="true"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact));
      assert.deepEqual(serious, [], `${viewport.name} accessibility violations: ${JSON.stringify(serious)}`);

      const responsePromise = page.waitForResponse(response =>
        response.url().endsWith('/calendar/services/7/update') && response.request().method() === 'POST'
      );
      const serviceReload = page.waitForNavigation({ waitUntil: 'networkidle' });
      await page.locator('[data-service-edit-form] input[name="name"]').fill('Marietjie Signature Massage');
      await page.getByRole('button', { name: 'Save service' }).click();
      const mutationResponse = await responsePromise;
      assert.equal(mutationResponse.status(), 200);
      await serviceReload;

      const descriptionResponsePromise = page.waitForResponse(response =>
        response.url().endsWith('/calendar/services/7/description') && response.request().method() === 'POST'
      );
      const descriptionReload = page.waitForNavigation({ waitUntil: 'networkidle' });
      const description = `A warm approved ${viewport.name} description that clients can read on the website.`;
      await page.locator('[data-service-description-form] textarea[name="customerDescription"]').fill(description);
      assert.equal(await page.locator('[data-description-preview]').textContent(), description);
      await page.getByRole('button', { name: 'Approve and publish wording' }).click();
      const descriptionResponse = await descriptionResponsePromise;
      assert.equal(descriptionResponse.status(), 200);
      await descriptionReload;

      const file = `${viewport.name}-marietjie-services.png`;
      const filePath = path.join(OUT_DIR, file);
      await page.screenshot({ path: filePath, fullPage: true });
      screenshots.push({
        file,
        width: viewport.width,
        height: viewport.height,
        sha256: sha256(filePath),
        noHorizontalOverflow: true,
        accessibilitySeriousOrCritical: 0,
        authenticatedManagementMutation: true,
        authenticatedDescriptionPublication: true,
      });
      await context.close();
    }

    assert.equal(updateCalls, 2);
    assert.equal(descriptionCalls, 2);
    assert.equal(lastUpdate.name, 'Marietjie Signature Massage');
    assert.equal(String(lastUpdate.categoryId), '3');
    assert.match(lastDescription.customerDescription, /approved phone description/);
    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      exactHead,
      authenticated: true,
      syntheticDataOnly: true,
      productionReads: 0,
      productionMutations: 0,
      providerWrites: 0,
      tenantPrincipal: 'Marietjie',
      visibleAssignedServices: 2,
      serviceCreationGranted: false,
      managementMutations: updateCalls,
      descriptionPublicationMutations: descriptionCalls,
      screenshots,
    }, null, 2));
    console.log(`Authenticated Marietjie Services Playwright proof passed at ${exactHead}: Desktop + Phone; assigned-only list; management enabled; zero production reads/writes.`);
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
