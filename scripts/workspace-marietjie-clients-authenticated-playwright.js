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
const { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');
const { createWorkspaceClientMutationRouter } = require('../src/routes/workspaceClientMutations');
const { requireStaffSession, sameOriginGuard } = require('../src/middleware/staffBrowserSession');
const { WorkspaceClientsError } = require('../src/services/workspaceClients');
const { WorkspaceClientMutationError } = require('../src/services/workspaceClientMutations');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-marietjie-clients-ui');
const ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};
const SESSION_TOKEN = 'synthetic-marietjie-clients-session';
const CSRF_TOKEN = 'synthetic-marietjie-clients-csrf';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function authority() {
  return {
    key: 'workspace_client_lookup_v2',
    operatorAdminId: 81,
    displayName: 'Marietjie',
    capability: 'client:lookup',
    businessRole: 'tenant_practitioner',
    linkedStaffId: 55,
    clientScope: { kind: 'tenant_staff', ownerStaffId: 55 },
    manageAllowed: true,
  };
}

function clientRows(state) {
  return [
    {
      id: 701,
      name: state.name,
      normalized_mobile: '27821234001',
      date_of_birth: '1988-05-14',
      gender: 'female',
      profile_status: 'registered',
      mobile_verified_at: '2026-09-10T08:00:00.000Z',
      status: state.relationshipStatus,
      last_appointment_at: '2026-09-14T08:00:00.000Z',
    },
    {
      id: 702,
      name: 'Shared Shiloh Client',
      normalized_mobile: '27821234002',
      date_of_birth: '1992-03-09',
      gender: 'female',
      profile_status: 'registered',
      mobile_verified_at: '2026-09-12T09:00:00.000Z',
      status: 'active',
      last_appointment_at: '2026-09-13T10:00:00.000Z',
    },
  ];
}

function listModel(state, requestedStatus = 'active') {
  const rows = clientRows(state).filter(client => requestedStatus === 'all' || client.status === requestedStatus);
  return {
    authority: authority(),
    manageAllowed: true,
    clients: rows,
    hasMore: false,
    offset: 0,
    pageSize: 24,
    query: '',
    status: requestedStatus,
  };
}

function detailModel(state) {
  const own = clientRows(state)[0];
  return {
    authority: authority(),
    manageAllowed: true,
    client: { ...own, revision: state.revision },
    appointments: [
      {
        id: 9101,
        starts_at: '2026-09-14T08:00:00.000Z',
        ends_at: '2026-09-14T09:00:00.000Z',
        status: 'completed',
        title: 'Marietjie appointment',
        services: [{ name: 'Marietjie Signature Massage' }],
        staff: [{ name: 'Marietjie' }],
      },
    ],
    communications: [
      {
        intent: 'booking_confirmation',
        label: 'Booking confirmation',
        statusLabel: 'Read on WhatsApp',
        occurredAt: '2026-09-13T10:00:00.000Z',
        appointmentId: 9101,
        templateName: 'shiloh_booking_confirmation_v2',
      },
    ],
    communicationsUnavailable: false,
    hasMore: false,
    historyOffset: 0,
    pageSize: 20,
  };
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = {
    name: 'Marietjie Client One',
    relationshipStatus: 'active',
    revision: 'a'.repeat(64),
  };
  let updateCalls = 0;
  let archiveCalls = 0;
  let createCalls = 0;

  const sessionService = {
    validateSessionToken: async token => token === SESSION_TOKEN
      ? {
          ok: true,
          adminId: 81,
          sessionId: 'synthetic-marietjie-clients-session-id',
          viewer: { id: 81, displayName: 'Marietjie' },
        }
      : { ok: false },
    rotateCsrfToken: async sessionId => {
      assert.equal(sessionId, 'synthetic-marietjie-clients-session-id');
      return { csrfToken: CSRF_TOKEN };
    },
    validateCsrfToken: (_session, token) => token === CSRF_TOKEN,
  };

  const readService = {
    async resolveAccess(adminId) {
      assert.equal(adminId, 81);
      return authority();
    },
    async requireAccess(adminId) {
      assert.equal(adminId, 81);
      return authority();
    },
    async listClients({ adminId, status }) {
      assert.equal(adminId, 81);
      return listModel(state, status || 'active');
    },
    async getClientDetail({ adminId, clientId }) {
      assert.equal(adminId, 81);
      if (Number(clientId) === 999) {
        throw new WorkspaceClientsError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);
      }
      if (Number(clientId) !== 701) {
        throw new WorkspaceClientsError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);
      }
      return detailModel(state);
    },
  };

  const mutationService = {
    async resolveManageAccess(adminId) {
      assert.equal(adminId, 81);
      return { ...authority(), capability: 'client:manage' };
    },
    async createClient(input) {
      assert.equal(input.adminId, 81);
      createCalls += 1;
      return { status: 'linked', clientId: 701, revision: state.revision };
    },
    async updateClient(input) {
      assert.equal(input.adminId, 81);
      assert.equal(Number(input.clientId), 701);
      updateCalls += 1;
      state.name = input.name;
      state.revision = 'b'.repeat(64);
      return { status: 'updated', clientId: 701, revision: state.revision };
    },
    async archiveClient(input) {
      assert.equal(input.adminId, 81);
      assert.equal(Number(input.clientId), 701);
      archiveCalls += 1;
      state.relationshipStatus = 'archived';
      state.revision = 'c'.repeat(64);
      return { status: 'archived', clientId: 701, revision: state.revision };
    },
  };

  const notificationService = { async resolveAccess() { return null; } };

  const app = express();
  app.use(express.json());
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send("'use strict';"));
  const requireSession = requireStaffSession({ service: sessionService, env: ENV });
  app.post('/calendar/staff-auth/csrf', sameOriginGuard({ env: ENV }), requireSession, async (req, res) => {
    const rotated = await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
    return res.status(200).json({ csrfToken: rotated.csrfToken });
  });
  app.use('/calendar/clients', createWorkspaceClientsRouter({
    env: ENV,
    sessionService,
    service: readService,
    mutationService,
    notificationService,
  }));
  app.use('/calendar/clients', createWorkspaceClientMutationRouter({
    env: ENV,
    sessionService,
    service: mutationService,
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
    const unauthorized = await unauthenticatedPage.goto(`${origin}/calendar/clients`, { waitUntil: 'networkidle' });
    assert.equal(unauthorized.status(), 401);
    await unauthenticated.close();

    const screenshots = [];
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 960 },
      { name: 'phone', width: 390, height: 844 },
    ]) {
      state.name = 'Marietjie Client One';
      state.relationshipStatus = 'active';
      state.revision = 'a'.repeat(64);

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

      const listResponse = await page.goto(`${origin}/calendar/clients`, { waitUntil: 'networkidle' });
      assert.equal(listResponse.status(), 200);
      await page.locator('[data-workspace-clients="true"]').waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Clients', exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Marietjie Client One', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Shared Shiloh Client', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Clinic Only Client', { exact: true }).count(), 0);
      assert.equal(await page.locator('.client-row').count(), 2);
      assert.equal(await page.locator('[data-tenant-client-base="true"]').count() > 0, true);

      const denied = await page.goto(`${origin}/calendar/clients/999`, { waitUntil: 'networkidle' });
      assert.equal(denied.status(), 404);
      assert.equal((await page.locator('body').innerText()).includes('Clinic Only Client'), false);

      const detailResponse = await page.goto(`${origin}/calendar/clients/701`, { waitUntil: 'networkidle' });
      assert.equal(detailResponse.status(), 200);
      await page.locator('[data-client-management]').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Remove from my clients', exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Marietjie Signature Massage', { exact: true }).isVisible(), true);

      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('button,input:not([type="checkbox"]),select,a')]
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
        .include('[data-workspace-clients="true"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact));
      assert.deepEqual(serious, [], `${viewport.name} accessibility violations: ${JSON.stringify(serious)}`);

      const updateResponsePromise = page.waitForResponse(response =>
        response.url().endsWith('/calendar/clients/701/update') && response.request().method() === 'POST'
      );
      await page.locator('[data-client-edit-form] input[name="name"]').fill('Marietjie Client One');
      await page.getByRole('button', { name: 'Save client', exact: true }).click();
      const updateResponse = await updateResponsePromise;
      assert.equal(updateResponse.status(), 200);
      await page.waitForLoadState('networkidle');

      page.once('dialog', dialog => dialog.accept());
      const archiveResponsePromise = page.waitForResponse(response =>
        response.url().endsWith('/calendar/clients/701/archive') && response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Remove from my clients', exact: true }).click();
      const archiveResponse = await archiveResponsePromise;
      assert.equal(archiveResponse.status(), 200);
      await page.waitForURL(/\/calendar\/clients\?status=archived$/);
      assert.equal(await page.getByText('Marietjie Client One', { exact: true }).isVisible(), true);

      const file = `${viewport.name}-marietjie-clients.png`;
      const filePath = path.join(OUT_DIR, file);
      await page.screenshot({ path: filePath, fullPage: true });
      screenshots.push({
        file,
        width: viewport.width,
        height: viewport.height,
        sha256: sha256(filePath),
        noHorizontalOverflow: true,
        accessibilitySeriousOrCritical: 0,
        clinicOnlyDirectUrlDenied: true,
        authenticatedEdit: true,
        relationshipArchiveOnly: true,
      });
      await context.close();
    }

    assert.equal(updateCalls, 2);
    assert.equal(archiveCalls, 2);
    assert.equal(createCalls, 0);
    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      exactHead,
      authenticated: true,
      syntheticDataOnly: true,
      productionReads: 0,
      productionMutations: 0,
      providerWrites: 0,
      tenantPrincipal: 'Marietjie',
      clientScope: 'tenant_staff:55',
      visibleTenantClients: 2,
      clinicOnlyClientLeaked: false,
      canonicalClientDeleteUsed: false,
      relationshipArchiveOnly: true,
      editMutations: updateCalls,
      archiveMutations: archiveCalls,
      screenshots,
    }, null, 2));
    console.log(`Authenticated Marietjie Clients Playwright proof passed at ${exactHead}: Desktop + Phone; tenant-only list/direct URL/history boundary; relationship archive; zero production reads/writes.`);
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
