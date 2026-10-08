'use strict';
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { workspaceNavigationClientScript } = require('../src/presentation/workspaceShell');
const { createWorkspaceTreatmentCreditRouter } = require('../src/routes/workspaceTreatmentCredit');
let server, base, requests, mode;
const model = { client: { id: 101, name: 'Synthetic Client' }, balance: 350, authority: { canIssue: true, canApply: true, canCorrect: true }, appointments: [{ id: 201, title: 'Synthetic completed treatment', starts_at: '2026-10-08T08:00Z' }], entries: [{ id: 1, correctable_amount: '350', entry_type: 'issue', credit_type: 'service_exchange', signed_amount: '350', reason: 'Synthetic supplier exchange', reference: 'SYNTHETIC-INVOICE-101', actor_name: 'Synthetic Reception', created_at: '2026-10-08T08:00Z' }, { id: 2, correctable_amount: '100', entry_type: 'apply', signed_amount: '-100', reason: 'Synthetic applied credit', appointment_id: 201, actor_name: 'Synthetic Reception', created_at: '2026-10-08T09:00Z' }] };
test.beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.get('/calendar/workspace/nav.js', (_req, res) => res.type('js').send(workspaceNavigationClientScript()));
  app.get('/calendar/workspace/navigation', (_req, res) => res.json({}));
  app.get('/calendar/pwa/icon-192.png', (_req, res) => res.sendFile(path.resolve('public/assets/pwa/shiloh-pwa-192.png')));
  app.use('/calendar/treatment-credit', createWorkspaceTreatmentCreditRouter({ env: {}, sessionService: { async validateSessionToken(token) { return token === 'synthetic' ? { ok: true, adminId: 2, sessionId: 2 } : { ok: false }; }, async rotateCsrfToken() { return { ok: true, csrfToken: 'synthetic' }; }, validateCsrfToken: (_session, token) => token === 'synthetic' }, service: {
    async getClientModel() { return model; },
    async issue(input) { requests.push(input); if (mode === 'lost') throw new Error('Synthetic lost response'); return { status: 'issued' }; },
    async apply(input) { requests.push(input); return { status: 'applied' }; },
    async reduce(input) { requests.push(input); if (mode === 'lost') throw new Error('Synthetic lost correction response'); return { status: 'reduced' }; },
    async undo(input) { requests.push(input); return { status: 'returned' }; },
  } }));
  app.use((_error, _req, res, _next) => res.status(500).json({ error: 'Credit could not be saved. Review and retry.' }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => new Promise(resolve => server.close(resolve)));
test.beforeEach(async () => { requests = []; mode = 'normal'; });
for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }], ['narrow', { width: 320, height: 844 }]]) {
  test(`treatment credit ${name}: Storybook, accessibility and responsive history`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const state of ['credit-history', 'empty', 'view-only', 'corrected-history']) {
      await page.goto(`/iframe.html?id=shiloh-client-treatment-credit--${state}&viewMode=story`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Treatment credit', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
      const result = await new AxeBuilder({ page }).analyze(); expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      fs.mkdirSync('artifacts/treatment-credit', { recursive: true });
      await page.screenshot({ path: `artifacts/treatment-credit/${name}-${state}.png`, fullPage: true });
      if (state === 'corrected-history') {
        await expect(page.getByText('Returned from treatment', { exact: true })).toBeVisible();
        const details = page.locator('.credit-correction').first(); await details.locator('summary').click();
        await expect(details.getByLabel('Correction reason')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const correctionAxe = await new AxeBuilder({ page }).analyze(); expect(correctionAxe.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);
        await page.screenshot({ path: `artifacts/treatment-credit/${name}-correction-open.png`, fullPage: true });
      }
      if(state==='credit-history'&&name!=='desktop'){await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.credit-history li>div>span').evaluateAll(nodes=>nodes.every(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length===1;}))).toBe(true);await page.screenshot({path:`artifacts/treatment-credit/${name}-enlarged-history.png`,fullPage:true});}
    }
  });
  test(`treatment credit ${name}: secure interface, confirmations, duplicate taps and stable retry`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await context.addCookies([{ name: 'shiloh_staff_session', value: 'synthetic', url: base }]);
    await page.goto(`${base}/calendar/treatment-credit/clients/101`);
    if(name!=='desktop'){await page.getByRole('button',{name:'Open Shiloh Workspace navigation'}).click();await expect(page.locator('[data-workspace-navigation-drawer]')).toHaveClass(/open/);await page.keyboard.press('Escape');await expect(page.locator('[data-workspace-navigation-drawer]')).not.toHaveClass(/open/);}
    const issue = page.locator('[data-credit-form="issue"]');
    await issue.getByLabel('Type').selectOption('service_exchange');
    await issue.getByLabel('Amount (R)').fill('100'); await issue.getByLabel('Reason').fill('Synthetic exchange');
    await expect(issue.getByLabel('Reference / supplier invoice')).toHaveAttribute('required', '');
    await issue.getByLabel('Reference / supplier invoice').fill('SYNTHETIC-INVOICE-102');
    await issue.getByRole('button', { name: 'Add credit', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Go back', exact: true }).click(); expect(requests).toHaveLength(0);
    mode = 'lost';
    await issue.getByRole('button', { name: 'Add credit', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm credit', exact: true }).click();
    await expect(issue.getByRole('status')).toContainText('Credit could not be saved'); expect(requests).toHaveLength(1);
    await page.reload();
    await expect(issue.getByLabel('Reference / supplier invoice')).toHaveValue('SYNTHETIC-INVOICE-102');
    mode = 'normal';
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), issue.getByRole('button', { name: 'Add credit', exact: true }).dblclick()]);
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[0].operationId).toBe(requests[1].operationId); expect(requests[1].adminId).toBe(2);
    await expect(page.getByRole('heading', { name: 'Treatment credit', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }]]) {
  test(`treatment credit ${name}: explicit reviewed corrections and stable retry`, async ({ page, context }) => {
    await page.setViewportSize(viewport); await context.addCookies([{ name: 'shiloh_staff_session', value: 'synthetic', url: base }]);
    await page.goto(`${base}/calendar/treatment-credit/clients/101`);
    for (const action of ['reduce','undo']) {
      const form = page.locator(`[data-credit-form="${action}"]`);
      await form.locator('..').locator('summary').click();
      await form.getByLabel('Correction amount (R)').fill('25'); await form.getByLabel('Correction reason').fill('Synthetic reviewed mistake');
      await expect(form.getByRole('checkbox')).toHaveAttribute('required', '');
      await form.getByRole('checkbox').check(); await form.getByRole('button').click();
      await expect(page.getByRole('dialog')).toContainText('does not send a cash refund');
      await page.getByRole('button', { name: 'Go back', exact: true }).click();
      const before = requests.length; mode = action === 'reduce' ? 'lost' : 'normal';
      await form.getByRole('button').click();
      const navigation = action === 'undo' ? page.waitForNavigation({waitUntil:'networkidle'}) : null;
      await page.getByRole('button', { name: 'Confirm credit', exact: true }).dblclick();
      if (action === 'reduce') {
        await expect(form.getByRole('status')).toContainText('Credit could not be saved'); expect(requests).toHaveLength(before + 1);
        const operation = requests.at(-1).operationId;
        await page.reload(); await form.locator('..').locator('summary').click();
        await expect(form.getByLabel('Correction reason')).toHaveValue('Synthetic reviewed mistake'); await expect(form.getByRole('checkbox')).toBeChecked();
        mode = 'normal'; await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}), form.getByRole('button').dblclick()]);
        expect(requests.at(-1).operationId).toBe(operation); expect(requests).toHaveLength(before + 2);
      } else { await navigation; await expect.poll(() => requests.length).toBe(before + 1); await expect(page.getByRole('heading', { name: 'Treatment credit', exact: true })).toBeVisible(); }
      expect(requests.at(-1).reviewed).toBe('on'); expect(requests.at(-1).adminId).toBe(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
