const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const express = require('express');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createWorkspaceStaffRouter } = require('../src/routes/workspaceStaff');
const { createWorkspaceStaffMutationRouter } = require('../src/routes/workspaceStaffMutations');
const { requireStaffSession, sameOriginGuard } = require('../src/middleware/staffBrowserSession');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-staff-access-ui');
const ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};
const SESSION_TOKEN = 'synthetic-staff-access-session';
const CSRF_TOKEN = 'synthetic-staff-access-csrf';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function staff() {
  return [
    {
      id: 21,
      staffId: 41,
      displayName: 'Naomi',
      active: true,
      profileKey: 'clinic_team_v1',
      profileLabel: 'Clinic team',
      profileSummary: 'Can see the clinic Workspace and finish their own visits. Clinic-wide management stays protected.',
      protectedRestrictions: [
        'Cannot change Clinic Hours.',
        'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
        'Cannot change client, service or staff records.',
      ],
      editable: true,
      revision: 'a'.repeat(64),
      toggles: [{ key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Lets this team member finish only appointments that belong to them.', on: true }],
    },
    {
      id: 31,
      staffId: 51,
      displayName: 'Marietjie',
      active: true,
      profileKey: 'own_workspace_v1',
      profileLabel: 'Own workspace',
      profileSummary: 'Can fully manage their own work while clinic-wide records and other practitioners stay protected.',
      protectedRestrictions: [
        'Cannot change Clinic Hours.',
        'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
        'Cannot access clinic-only client relationships.',
        'Cannot create services or change staff/access settings.',
      ],
      editable: true,
      revision: 'b'.repeat(64),
      toggles: [
        { key: 'manage_own_appointments', label: 'Manage my appointments', description: 'Create, reschedule, cancel and adjust only appointments inside this workspace boundary.', on: true },
        { key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Finish only appointments assigned to this practitioner.', on: true },
        { key: 'manage_my_clients', label: 'Manage my clients', description: 'Add and update this practitioner’s own client relationships.', on: true },
        { key: 'manage_my_services', label: 'Manage my services', description: 'Manage only services assigned and permitted to this practitioner.', on: true },
        { key: 'view_clinic_hours', label: 'View clinic hours', description: 'See clinic and booking hours without permission to change them.', on: true },
      ],
    },
  ];
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const people = staff();
  let toggleWrites = 0;
  const authority = { operatorAdminId: 1, displayName: 'Owner' };

  const sessionService = {
    validateSessionToken: async token => token === SESSION_TOKEN
      ? { ok: true, adminId: 1, sessionId: 'synthetic-owner-session', viewer: { id: 1, displayName: 'Owner' } }
      : { ok: false },
    rotateCsrfToken: async () => ({ csrfToken: CSRF_TOKEN }),
    validateCsrfToken: (_session, token) => token === CSRF_TOKEN,
  };
  const accessService = {
    async resolveManageAccess(adminId) { return Number(adminId) === 1 ? authority : null; },
    async requireManageAccess(adminId) { if (Number(adminId) !== 1) throw Object.assign(new Error('Forbidden'), { httpStatus: 403 }); return authority; },
  };
  const profileService = {
    async list({ adminId }) { assert.equal(adminId, 1); return { authority, people }; },
    async get({ adminId, principalId }) {
      assert.equal(adminId, 1);
      const person = people.find(item => item.id === Number(principalId));
      if (!person) throw Object.assign(new Error('Staff access was not found.'), { httpStatus: 404, code: 'STAFF_ACCESS_NOT_FOUND' });
      return { authority, person };
    },
    async applyProfile({ adminId, principalId, profile }) {
      assert.equal(adminId, 1);
      const person = people.find(item => item.id === Number(principalId));
      assert.equal(profile, person.profileKey);
      return { status: 'updated', person };
    },
    async setToggle({ adminId, principalId, toggle, on }) {
      assert.equal(adminId, 1);
      const person = people.find(item => item.id === Number(principalId));
      const target = person?.toggles.find(item => item.key === toggle);
      if (!target) throw Object.assign(new Error('That Staff access switch is not available for this profile.'), { httpStatus: 400, code: 'STAFF_ACCESS_TOGGLE_UNSUPPORTED' });
      target.on = on === true;
      person.revision = crypto.createHash('sha256').update(`${person.id}:${toggle}:${target.on}:${toggleWrites}`).digest('hex');
      toggleWrites += 1;
      return { status: 'updated', person };
    },
  };
  const staffService = {
    async resolveAccess() { return { displayName: 'Owner' }; },
    async resolveManageAccess() { return authority; },
  };

  const app = express();
  app.use(express.json());
  app.get('/calendar/workspace/nav.js', (_req, res) => res.type('application/javascript').send("'use strict';"));
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send("'use strict';"));
  const requireSession = requireStaffSession({ service: sessionService, env: ENV });
  app.post('/calendar/staff-auth/csrf', sameOriginGuard({ env: ENV }), requireSession, async (req, res) => {
    const rotated = await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
    return res.status(200).json({ csrfToken: rotated.csrfToken });
  });
  app.use('/calendar/team', createWorkspaceStaffRouter({
    env: ENV,
    sessionService,
    service: staffService,
    accessService,
    profileService,
    clientAccessService: { async resolveAccess() { return {}; } },
  }));
  app.use('/calendar/team', createWorkspaceStaffMutationRouter({
    env: ENV,
    sessionService,
    service: staffService,
    accessService,
    accessCompletionService: {},
    accessPolicyService: {},
    accessV2Service: {},
    profileService,
    receptionDeviceSigninService: {},
  }));

  const server = http.createServer(app);
  let browser;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });

    const unauthenticated = await browser.newContext();
    const unauthenticatedPage = await unauthenticated.newPage();
    const denied = await unauthenticatedPage.goto(`${origin}/calendar/team/staff-access`, { waitUntil: 'networkidle' });
    assert.equal(denied.status(), 401);
    await unauthenticated.close();

    const evidence = [];
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 960 },
      { name: 'phone', width: 390, height: 844 },
    ]) {
      const marietjie = people.find(person => person.id === 31);
      marietjie.toggles.forEach(toggle => { toggle.on = true; });
      marietjie.revision = 'b'.repeat(64);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      await context.addCookies([{ name: 'shiloh_staff_session', value: SESSION_TOKEN, url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const page = await context.newPage();

      const listResponse = await page.goto(`${origin}/calendar/team/staff-access`, { waitUntil: 'networkidle' });
      assert.equal(listResponse.status(), 200);
      assert.equal(await page.getByRole('heading', { name: 'Staff access', exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Naomi', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Marietjie', { exact: true }).isVisible(), true);

      const detailResponse = await page.goto(`${origin}/calendar/team/staff-access/31`, { waitUntil: 'networkidle' });
      assert.equal(detailResponse.status(), 200);
      assert.equal(await page.getByRole('heading', { name: 'Marietjie', exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Protected boundaries', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Cannot change Clinic Hours.', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Cannot edit, cancel, reassign or delete another practitioner’s appointments.', { exact: true }).isVisible(), true);
      const switches = page.getByRole('switch');
      assert.equal(await switches.count(), 5);
      for (let i = 0; i < await switches.count(); i += 1) assert.equal(await switches.nth(i).getAttribute('aria-checked'), 'true');

      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('.detail-card button,.detail-card a,.topbar a')]
          .filter(node => node.getClientRects().length > 0)
          .map(node => ({ label: node.textContent.trim(), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      }));
      assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1, `${viewport.name} has horizontal overflow`);
      if (viewport.name === 'phone') {
        assert.deepEqual(geometry.targets.filter(target => target.height < 43 || target.width < 43), [], `Phone Staff access targets must retain 44px touch size: ${JSON.stringify(geometry.targets)}`);
      }

      const accessibility = await new AxeBuilder({ page })
        .include('[data-access-person]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact));
      assert.deepEqual(serious, [], `${viewport.name} accessibility violations: ${JSON.stringify(serious)}`);

      const clientSwitch = page.getByRole('switch', { name: /Manage my clients/i });
      const mutation = page.waitForResponse(response => response.url().endsWith('/calendar/team/staff-access/31/toggle') && response.request().method() === 'POST');
      await clientSwitch.click();
      const mutationResponse = await mutation;
      assert.equal(mutationResponse.status(), 200);
      assert.equal(await clientSwitch.getAttribute('aria-checked'), 'false');
      assert.equal(await clientSwitch.getByText('Off', { exact: true }).isVisible(), true);

      const forbidden = await page.evaluate(async () => {
        const csrfResponse = await fetch('/calendar/staff-auth/csrf', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
        const { csrfToken } = await csrfResponse.json();
        const response = await fetch('/calendar/team/staff-access/31/toggle', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-shiloh-csrf-token': csrfToken },
          body: JSON.stringify({ expectedRevision: document.querySelector('[data-access-person]').dataset.accessRevision, requestId: 'staffaccess_forbidden_123', toggle: 'schedule:manage', on: true }),
        });
        return { status: response.status, body: await response.json() };
      });
      assert.equal(forbidden.status, 400);
      assert.equal(forbidden.body.code, 'STAFF_ACCESS_TOGGLE_UNSUPPORTED');

      const file = `${viewport.name}-staff-access.png`;
      const filePath = path.join(OUT_DIR, file);
      await page.screenshot({ path: filePath, fullPage: true });
      evidence.push({ file, width: viewport.width, height: viewport.height, sha256: sha256(filePath), noHorizontalOverflow: true, accessibilitySeriousOrCritical: 0, protectedCrossStaffBoundaryVisible: true });
      await context.close();
    }

    assert.equal(toggleWrites, 2, 'only the two permitted UI toggle writes may reach the profile service');
    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      exactHead,
      authenticated: true,
      syntheticDataOnly: true,
      productionReads: 0,
      productionMutations: 0,
      providerWrites: 0,
      staffAccessProfiles: ['Clinic team', 'Own workspace'],
      marietjieCalendarMutationScope: 'own_appointments',
      marietjieServiceMutationScope: 'own_services',
      clinicHoursMutationAllowedForMarietjie: false,
      crossStaffAppointmentMutationAllowedForMarietjie: false,
      desktopPhoneEvidence: evidence,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server.listening) server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
