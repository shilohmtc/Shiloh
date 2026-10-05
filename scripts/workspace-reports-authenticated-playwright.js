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
const { createWorkspaceStaffEarningsService } = require('../src/services/workspaceStaffEarnings');
const { summarizeExpenses, cashCalculation } = require('../src/domain/workspaceFinancialRecords');
const { fingerprint } = require('../src/services/workspaceFinancialRecords');
const { summarizeFinancials } = require('../src/domain/workspaceFinancialReports');
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
      dayCount: 30, from:'2026-08-16T22:00:00Z', to:'2026-09-15T22:00:00Z', previousFrom:'2026-07-17T22:00:00Z',previousTo:'2026-08-16T22:00:00Z',previousStartKey:'2026-07-18',previousEndKey:'2026-08-17',
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
  const principals = {
    41: { active: true, display_name: 'Christel', business_role: 'owner', calendar_scope: 'all_business', permissions: { 'appointment:view': true, 'staff_earnings:manage': true } },
    4: { active: true, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', permissions: { 'appointment:view': true, 'staff_earnings:manage': true } },
    51: { active: true, display_name: 'Reception', business_role: 'booking_operator', calendar_scope: 'all_business', permissions: { 'appointment:view': true } },
  };
  const gate = createWorkspaceStaffEarningsService({ db: { async query(_sql, params) { return { rows: principals[params[0]] ? [principals[params[0]]] : [] }; } } });
  const sessionService = {
    validateSessionToken: async token => principals[Number(String(token || '').replace('synthetic-reports-session-', ''))]
      ? { ok: true, adminId: Number(String(token || '').replace('synthetic-reports-session-', '')), sessionId: 51 }
      : { ok: false },
    rotateCsrfToken: async () => ({ ok: true, csrfToken: 'synthetic-csrf' }),
    validateCsrfToken: (_session, token) => token === 'synthetic-csrf',
  };
  const service = {
    async buildReport({ adminId }) {
      assert.ok(principals[adminId]);
      buildCalls += 1;
      return { ...model(), authority: { displayName: principals[adminId].display_name, reportScope: 'all_business' } };
    },
  };
  const earningsService = {
    async requireOwner(adminId) { return gate.requireOwner(adminId); },
    async build({ adminId }) {
      await gate.requireOwner(adminId);
      return {
        earliestNewRuleDate: '2026-09-16',
        staff: [{ staffId: 11, name: 'Abigail', completedValue: 590, commission: 118, completedCount: 1, reviewCount: 1, appointments: [
          { id: 732, startsAt: '2026-09-15T08:00:00Z', serviceNames: ['Swedish Massage'], price: 590, ratePercent: 20, commission: 118 },
          { id: 733, startsAt: '2026-09-15T10:00:00Z', serviceNames: ['Couples Massage'], price: 1080, reason: 'Shared appointment — review allocation' },
        ] }],
        services: [{ id: 1, name: 'Swedish Massage' }],
        rules: [{ staff_id: 11, service_id: null, effective_from: '1970-01-01', rate_percent: 20 }],
      };
    },
    async addRule({ adminId, staffId }) { await gate.requireOwner(adminId); assert.equal(staffId, '11'); return { id: 7 }; },
  };

  const recordState = { expenses: [], closes: [], writes: 0 };
  const receiptRows = [{id:1,source:'booking',created_at:'2026-09-15T08:00:00Z',entry_type:'payment',amount:'295',method:'cash',appointment_id:732}];
  const recordsService = {
    async requireAccess(adminId) { await gate.requireOwner(adminId); },
    async build({adminId}) { await gate.requireOwner(adminId); return {...summarizeExpenses(recordState.expenses),today:'2026-09-15',closes:recordState.closes}; },
    async addExpense(input) {
      await gate.requireOwner(input.adminId); recordState.writes++;
      recordState.expenses.push({id:recordState.writes,paid_on:input.paidOn,category:input.category,description:input.description,reference:input.reference,amount:input.amount,method:input.method,created_by:principals[input.adminId].display_name});
      return {id:recordState.writes};
    },
    async voidExpense({adminId,expenseId,reason}) {
      await gate.requireOwner(adminId);recordState.writes++;
      const row=recordState.expenses.find(item=>item.id===Number(expenseId));assert.ok(row);row.voided_at='2026-09-15T16:00:00Z';row.voided_by=principals[adminId].display_name;row.void_reason=reason;return {id:row.id};
    },
    async preview({adminId,date}) {
      await gate.requireOwner(adminId);const period=model().period;
      const hash=fingerprint(receiptRows,recordState.expenses,date);
      return {date,fingerprint:hash,revision:recordState.closes.length,methods:summarizeFinancials({period,receipts:receiptRows}).methods,
        cashExpenses:summarizeExpenses(recordState.expenses.filter(row=>row.method==='cash')).total,
        changedSinceClose:recordState.closes.length>0 && recordState.closes[0].source_fingerprint!==hash};
    },
    async saveCashup(input) {
      await gate.requireOwner(input.adminId);const source=await this.preview(input);
      assert.equal(input.fingerprint,source.fingerprint);assert.equal(input.revision,source.revision);
      const calculation=cashCalculation(source,input);recordState.writes++;
      recordState.closes.unshift({id:recordState.writes,business_date:input.date,revision:source.revision+1,source_fingerprint:source.fingerprint,
        opening_float:input.openingFloat,cash_added:input.cashAdded,cash_removed:input.cashRemoved,counted_cash:input.countedCash,expected_cash:calculation.expectedCash,difference:calculation.difference,
        note:input.note,created_by:principals[input.adminId].display_name,created_at:'2026-09-15T16:00:00Z',snapshot:{cashExpenses:source.cashExpenses}});
      return {id:recordState.writes,...calculation};
    },
  };
  const app = express();
  app.get('/calendar/pwa/icon-192.png', (_req, res) => res.sendFile(path.join(process.cwd(), 'public/assets/pwa/shiloh-pwa-192.png')));
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send(''));
  app.use('/calendar/reports', createWorkspaceReportsRouter({
    env: ENV,
    sessionService,
    service,
    earningsService,
    recordsService,
    financialService: {
      async requireAccess(adminId) { await gate.requireOwner(adminId); },
      async build({adminId,period}) {
        await gate.requireOwner(adminId);
        return {...summarizeFinancials({period,treatments:[{id:732,starts_at:'2026-09-15T08:00:00Z',value:'590',treatment:'Swedish Massage'}],receipts:[{id:1,created_at:'2026-09-15T08:00:00Z',entry_type:'payment',amount:'295',method:'cash',appointment_id:732}]}),period};
      },
    },
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
    assert.equal((await unauthenticated.request.get(`${origin}/calendar/reports/sections.js`)).status(),401);
    await unauthenticated.close();

    const screenshots = [];
    for (const adminId of [41, 4, 51]) for (const viewport of [
      { name: 'desktop', width: 1440, height: 960 },
      { name: 'phone', width: 390, height: 844 },
    ]) {
      recordState.expenses=[];recordState.closes=[];
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      await context.addCookies([{
        name: 'shiloh_staff_session',
        value: `synthetic-reports-session-${adminId}`,
        url: origin,
        httpOnly: true,
        sameSite: 'Strict',
      }]);
      const page = await context.newPage();
      const response = await page.goto(`${origin}/calendar/reports?range=30d`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      await page.locator('[data-workspace-reports="true"]').waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Clinic reports', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'View report' }).isVisible(), true);
      assert.equal(await page.getByRole('heading', { name: 'Team booking time' }).isVisible(), true);
      const hasEarnings = adminId !== 51;
      assert.equal(await page.getByRole('heading',{name:'Financial overview',exact:true}).count(),hasEarnings ? 1 : 0);
      assert.equal((await context.request.get(`${origin}/calendar/reports/financial.csv?from=2026-08-17&to=2026-09-15`)).status(),hasEarnings ? 200 : 403);
      assert.equal(await page.getByRole('heading', { name: 'Team treatment value & commission' }).count(), hasEarnings ? 1 : 0);
      assert.equal(await page.locator('details[data-report-section][open]').count(), 0);
      await page.screenshot({path:path.join(OUT_DIR, `${viewport.name}-${adminId}-reports-compact.png`),fullPage:true});
      if (hasEarnings) await page.getByRole('link', {name:'Earnings',exact:true}).click();
      if (hasEarnings) assert.match(await page.locator('#staff-earnings').getByRole('link', { name: 'Appointment #732', exact: true }).getAttribute('href'), /appointment=732/);
      assert.equal((await context.request.get(`${origin}/calendar/reports/sections.js`)).status(),200);
      const scriptResponse = await context.request.get(`${origin}/calendar/reports/commission.js`);
      assert.equal(scriptResponse.status(), hasEarnings ? 200 : 403);
      assert.equal(await page.getByRole('heading', { name: 'Treatments booked' }).isVisible(), true);
      assert.equal(await page.getByRole('heading', { name: 'New and returning clients' }).isVisible(), true);

      assert.equal((await context.request.get(`${origin}/calendar/reports/finance-records.js`)).status(),hasEarnings ? 200 : 403);
      assert.equal((await context.request.get(`${origin}/calendar/reports/cashup-preview?date=2026-09-15`)).status(),hasEarnings ? 200 : 403);
      if (hasEarnings) {
        await page.getByRole('link',{name:'Expenses',exact:true}).click();
        await page.getByLabel('Description',{exact:true}).fill('Browser proof oils');
        await page.getByLabel('Category',{exact:true}).selectOption('supplies');
        await page.getByLabel('Paid from',{exact:true}).selectOption('cash');
        await page.getByLabel('Amount paid (R)',{exact:true}).fill('25');
        await page.getByRole('button',{name:'Save expense',exact:true}).click();
        await page.getByRole('heading',{name:'Browser proof oils · R25,00',exact:true}).waitFor();
        await page.getByRole('link',{name:'Cash-up',exact:true}).click();
        if (viewport.name==='phone') assert.equal(await page.evaluate(()=>document.querySelector('#financial-cashup > summary').getBoundingClientRect().top >= document.querySelector('.jump-row').getBoundingClientRect().bottom + 2),true,'Cash-up heading must clear the sticky section menu');
        await page.getByRole('button',{name:'Review this day',exact:true}).click();
        await page.getByText('Day reviewed. Enter your cash count and save.',{exact:true}).waitFor();
        await page.getByLabel('Opening float (R)',{exact:true}).fill('100');
        await page.getByLabel('Cash counted, including float (R)',{exact:true}).fill('365');
        await page.getByLabel('Note / reason for a difference or revised close',{exact:true}).fill('Drawer R5 short, receipts reviewed.');
        assert.match(await page.locator('[data-cashup-calculation]').innerText(),/Expected cash: R370,00/);
        assert.match(await page.locator('[data-cashup-calculation]').innerText(),/Difference: R-5,00/);
        await page.getByRole('button',{name:'Save daily close',exact:true}).click();
        await page.getByRole('heading',{name:'2026-09-15 · Close 1',exact:true}).waitFor();
        await page.screenshot({path:path.join(OUT_DIR, `${viewport.name}-${adminId}-cashup-saved.png`),fullPage:true});
        await page.getByRole('link',{name:'Expenses',exact:true}).click();
        await page.getByText('Correct this expense',{exact:true}).click();
        await page.getByLabel('Reason for correction',{exact:true}).fill('Duplicate expense');
        await page.getByRole('button',{name:'Void expense',exact:true}).click();
        await page.getByText('Voided by '+principals[adminId].display_name+': Duplicate expense',{exact:true}).waitFor();
        await page.getByRole('link',{name:'Cash-up',exact:true}).click();
        await page.getByRole('button',{name:'Review this day',exact:true}).click();
        await page.getByText('Day reviewed. Enter your cash count and save.',{exact:true}).waitFor();
        assert.match(await page.locator('[data-cashup-source]').innerText(),/Entries changed since this close/);
        const csvResponse=await context.request.get(`${origin}/calendar/reports/financial.csv?from=2026-08-17&to=2026-09-15`);
        assert.match(await csvResponse.text(),/Duplicate expense/);
      } else {
        const denied=await context.request.post(`${origin}/calendar/reports/expenses`,{headers:{Origin:origin,'X-Shiloh-CSRF-Token':'synthetic-csrf'},data:{}});
        assert.equal(denied.status(),403);
      }

      if (hasEarnings) { await page.getByRole('link',{name:'Expenses',exact:true}).click(); }
      await page.getByRole('link', {name:'Team',exact:true}).click();
      assert.equal(await page.locator('#team-time').getAttribute('open'), '');
      await page.getByRole('link', {name:'Treatments',exact:true}).click();
      assert.equal(await page.locator('#treatments .service-list').isVisible(), true);
      await page.getByRole('navigation',{name:'Report sections'}).getByRole('link', {name:'Clients',exact:true}).click();
      assert.equal(await page.locator('#clients .client-grid').isVisible(), true);

      const bodyText = await page.locator('body').innerText();
      assert.doesNotMatch(bodyText, /canonical|business-wide operational|practitioner authority|service snapshot|aggregate identity|utilisation|fail closed/i);

      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('button,input,select,a,summary')]
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

      const file = `${viewport.name}-${adminId}-reports.png`;
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
      await page.goto(`${origin}/calendar/reports?range=30d#treatments`, {waitUntil:'networkidle'});
      assert.equal(await page.locator('#treatments').getAttribute('open'), '');
      assert.equal(await page.locator('#treatments .service-list').isVisible(), true);
      await context.close();
    }

    assert.ok(buildCalls >= 2);
    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      exactHead,
      authenticated: true,
      syntheticDataOnly: true,
      productionReads: 0, syntheticFinancialWrites: recordState.writes,
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
