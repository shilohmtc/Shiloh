const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { targetsFixture } = require('../stories/fixtures/workspaceBusinessTargets');
const {
  renderReportsPage,
  reportSectionsClientScript,
} = require('../src/presentation/workspaceReportsUx');
const { targetsClientScript } = require('../src/presentation/workspaceBusinessTargetsUx');
const { resolvePeriod } = require('../src/services/workspaceReports');
let server, base, model, writes, fail;
test.beforeAll(async () => {
  const app = express();
  app.use('/assets', express.static('public/assets'));
  app.get('/calendar/pwa/icon-192.png', (_q, r) =>
    r.sendFile(require('node:path').resolve('public/assets/pwa/shiloh-pwa-192.png')),
  );
  app.use(express.json());
  app.use('/storybook', express.static('storybook-static'));
  app.get('/calendar/reports', (_req, res) =>
    res.send(
      renderReportsPage(
        {
          authority: { displayName: 'Synthetic owner', reportScope: 'all_business' },
          period: resolvePeriod({ from: '2026-11-01', to: '2026-11-06' }),
          targets: model,
        },
        { csrfToken: 'synthetic' },
      ),
    ),
  );
  app.get('/calendar/reports/targets.js', (_q, r) => r.type('js').send(targetsClientScript()));
  app.get('/calendar/reports/sections.js', (_q, r) =>
    r.type('js').send(reportSectionsClientScript()),
  );
  app.get('/calendar/staff/client.js', (_q, r) => r.type('js').send(''));
  app.post('/calendar/reports/targets', (q, r) => {
    writes.push(q.body);
    if (fail)
      return r
        .status(409)
        .json({ error: 'This target changed. Refresh and review before saving.' });
    const m = model.metrics.find((m) => m.key === q.body.metric);
    m.target =
      q.body.action === 'clear'
        ? null
        : Number(q.body.target) * (m.key === 'net_receipts' ? 100 : 1);
    Object.assign(m,require('../src/domain/workspaceBusinessTargets').comparison(m.actual,m.target));
    m.revision++;
    r.status(201).json({ revision: m.revision });
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(() => new Promise((r) => server.close(r)));
test.beforeEach(() => {
  model = targetsFixture({ unset: true });
  writes = [];
  fail = false;
});
for (const width of [390, 1440])
  test(`monthly targets save, clear, cancel and stale edit at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/calendar/reports#targets');
    const card = page.locator('.target-card').first();
    await expect(card).toContainText('Not set');
    expect(writes).toHaveLength(0);
    await card.getByText('Set target', { exact: true }).click();
    await card.locator('input').fill('90000');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(card.locator('input')).toBeHidden();
    expect(writes).toHaveLength(0);
    await card.getByText('Set target', { exact: true }).click();
    await card.locator('input').fill('90000');
    await card.getByRole('button', { name: 'Save target', exact: true }).click();
    await expect(card).toContainText('20% of target');
    await expect(card.getByText('Edit target', { exact: true })).toBeVisible();
    expect(writes[0]).toMatchObject({
      metric: 'net_receipts',
      month: '2026-11',
      revision: 0,
      target: '90000',
      action: 'set',
    });
    expect(writes[0].operationId).toMatch(/^[\da-f-]{36}$/);
    await card.getByText('Edit target', { exact: true }).click();
    await card.getByRole('button', { name: 'Clear target', exact: true }).click();
    await expect(card.getByText('Set target', { exact: true })).toBeVisible();
    await expect(card).toContainText('Not set');
    expect(writes[1].action).toBe('clear');
    await card.getByText('Set target', { exact: true }).click();
    await card.locator('input').fill('100');
    fail = true;
    await card.getByRole('button', { name: 'Save target', exact: true }).click();
    await expect(card.getByRole('status')).toContainText('Refresh and review');
    await expect(card.getByRole('button', { name: 'Clear target', exact: true })).toBeDisabled();
    await expect(card.locator('input')).toHaveValue('100');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const axe = await new AxeBuilder({ page })
      .include('#targets')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`targets-stale-${width}.png`), fullPage: true });
  });
for (const width of [390, 1440])
  test(`Storybook monthly targets populated and unset at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    for (const story of ['monthly-targets', 'monthly-targets-unset']) {
      await page.goto(
        base + '/storybook/iframe.html?id=workspace-reports--' + story + '&viewMode=story',
      );
      await expect.poll(()=>page.locator('img').first().evaluate(img=>({src:img.src,loaded:img.complete&&img.naturalWidth>0}))).toMatchObject({loaded:true});
      await page.locator('#targets > summary').click();
      await expect(page.locator('.target-card')).toHaveCount(2);
      await expect(page.locator('#targets')).toContainText(
        story.endsWith('unset') ? 'Not set' : '20% of target',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const axe = await new AxeBuilder({ page })
        .include('#targets')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(axe.violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`${story}-${width}.png`), fullPage: true });
    }
  });

 test('interrupted target save preserves entered value and offers an honest recovery message',async({page})=>{
 await page.goto(base+'/calendar/reports#targets');const card=page.locator('.target-card').first();await card.getByText('Set target',{exact:true}).click();await card.locator('input').fill('100');await page.route('**/calendar/reports/targets',route=>route.abort());await card.getByRole('button',{name:'Save target',exact:true}).click();await expect(card.getByRole('status')).toContainText('Could not confirm this change. Refresh and review');await expect(card.locator('input')).toHaveValue('100');await expect(card.getByRole('button',{name:'Save target',exact:true})).toBeEnabled();await expect(card.getByRole('button',{name:'Clear target',exact:true})).toBeDisabled();expect(writes).toHaveLength(0);
 });
