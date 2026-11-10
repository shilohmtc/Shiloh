'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { workspaceIconClientScript } = require('../src/presentation/workspaceIconClient');
const { workspaceNavigationClientScript } = require('../src/presentation/workspaceShell');
const { clientRecordedVisitsFixture } = require('./helpers/clientRecordedVisitsFixture');
const { createClientInsightsService } = require('../src/services/clientInsights');
const { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');

async function expectInformationalBubbles(page, clientCount) {
  const clients = page.locator('.insight-ranking li');
  await expect(clients).toHaveCount(clientCount);
  await expect(page.locator('.insight-bubble')).toHaveCount(clientCount * 4);
  await expect(
    page.locator('.insight-bubble a,.insight-bubble button,.insight-bubble [tabindex]'),
  ).toHaveCount(0);
  for (const client of await clients.all()) {
    await expect(client.locator('.insight-bubble')).toHaveCount(4);
    await expect(client.locator('.insight-bubble dt')).toHaveText([
      'Visits',
      'Last recorded visit',
      'Usual interval',
      'Most-received treatment',
    ]);
    const treatment = client.locator('.insight-treatment');
    await expect(treatment).toHaveClass('insight-bubble insight-treatment');
    const layout = await treatment.evaluate((element) => {
      const style = getComputedStyle(element),
        firstStyle = getComputedStyle(element.parentElement.querySelector('.insight-bubble'));
      return {
        matchingSurface: [
          'backgroundColor',
          'borderRadius',
          'paddingTop',
          'paddingRight',
          'paddingBottom',
          'paddingLeft',
        ].every((property) => style[property] === firstStyle[property]),
        spansGrid: style.gridColumnStart === '1' && style.gridColumnEnd === '-1',
        width: element.getBoundingClientRect().width,
        rowWidth: element.parentElement.getBoundingClientRect().width,
        interactive: element.matches(
          'a,button,input,[tabindex],[onclick],[role="button"],[role="link"]',
        ),
      };
    });
    expect(layout.matchingSurface).toBe(true);
    expect(layout.spansGrid).toBe(true);
    expect(layout.width).toBeCloseTo(layout.rowWidth, 0);
    expect(layout.interactive).toBe(false);
    const before = page.url(),
      text = await treatment.textContent();
    await treatment.click();
    expect(page.url()).toBe(before);
    await expect(treatment).toHaveText(text);
  }
}

async function expectComparisonCopy(page, clamped = false) {
  const comparison = page.locator('[aria-labelledby="insight-comparison-title"]'),
    cutoff = clamped
      ? 'Compared through the end of each date range.'
      : 'Compared up to 10:00 each month.';
  await expect(comparison.locator('.insight-caption').first()).toHaveText(
    `Same dates each month. ${cutoff} Each client counts once per month.`,
  );
  await expect(comparison.locator('li > small')).toHaveText(
    clamped
      ? ['01 Jan 2026 – 28 Jan 2026', '01 Feb 2026 – 28 Feb 2026', '01 Mar 2026 – 28 Mar 2026']
      : [
          /^01 Sept? 2026 – 08 Sept? 2026$/,
          '01 Oct 2026 – 08 Oct 2026',
          '01 Nov 2026 – 08 Nov 2026',
        ],
  );
  await expect(comparison.locator('ul + .insight-caption')).toHaveText(
    'Three-month comparison, regardless of the selected view.',
  );
  const text = await comparison.innerText();
  expect(text.split(cutoff).length - 1).toBe(1);
  if (clamped) {
    await expect(comparison).toContainText(
      'All three months end on day 28 because one month is shorter.',
    );
    expect(text).not.toMatch(/Compared up to|\d{2}:\d{2}|end of day/);
  } else {
    expect(text.match(/10:00/g)).toHaveLength(1);
    expect(text).not.toMatch(/All three months end|end of each date range/);
  }
}

async function expectConciseContext(page) {
  await expect(page.locator('[data-client-insights]')).not.toContainText(/\bSAST\b/);
  await expect(page.locator('.insight-dates span')).toHaveText('Includes this month so far');
  await expect(
    page.getByRole('heading', { name: 'Most frequent clients', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[aria-labelledby="insight-ranking-title"] header p')).toHaveText(
    'Most visits first, then alphabetical. Details are for the selected period.',
  );
  await expect(page.locator('[aria-labelledby="insight-trend-title"] .insight-caption')).toHaveText(
    'The current month is incomplete.',
  );
  await expect(page.locator('.insight-note')).toHaveText(
    'Based on completed and no-charge visits recorded in Shiloh, within your access. Older or unlinked history may be incomplete. Treatment reflects recorded visits, not personal preference.',
  );
}

for (const width of [390, 1440])
  test(`Client Insights periods and profile returns preserve a compact alphabetic Directory at ${width}`, async ({
    page,
  }, info) => {
    const f = await clientRecordedVisitsFixture();
    await f.db.query(
      "UPDATE crm_v2_clients SET name=CASE id WHEN 1 THEN 'Synthetic Zulu' ELSE 'Synthetic Alpha' END WHERE id IN (1,2)",
    );
    for (const [id, date] of [
      [1, '2026-10-01'],
      [2, '2026-10-08'],
      [3, '2026-10-15'],
      [4, '2026-10-22'],
      [5, '2026-11-05'],
    ])
      await f.add({ id, date });
    await f.add({ id: 6, client: 2, date: '2026-08-01', status: 'no_charge' });
    await f.add({ id: 7, client: 2, date: '2026-10-01' });
    const app = express(),
      insights = createClientInsightsService({
        db: f.db,
        accessService: f.service,
        now: () => new Date('2026-11-08T08:00:00Z'),
      });
    app.get('/calendar/workspace/nav.js', (_req, res) =>
      res.type('js').send(workspaceNavigationClientScript() + workspaceIconClientScript()),
    );
    app.get('/calendar/workspace/navigation', (_req, res) =>
      res.json({ clientInsights: { allowed: true, href: '/calendar/clients/insights' } }),
    );
    app.use(
      '/calendar/clients',
      createWorkspaceClientsRouter({
        env: {
          SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
          SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
        },
        service: f.service,
        insightsService: insights,
        sessionService: { validateSessionToken: async () => ({ ok: true, adminId: 41 }) },
        paymentService: { getDirectoryReviews: async () => ({}) },
        notificationService: { resolveAccess: async () => null },
        creditService: {
          canView: async () => {
            throw Error('Synthetic denied');
          },
        },
      }),
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`,
      requests = [];
    page.on('request', (r) => requests.push(r.method()));
    await page.route('**/calendar/pwa/icon-192.png*', (route) =>
      route.fulfill({
        path: require('node:path').resolve('public/assets/brand/shiloh-mark-192.png'),
      }),
    );
    await page.setViewportSize({ width, height: 950 });
    try {
      await page.goto(origin + '/calendar/clients?q=Synthetic&status=active');
      await expect(page.locator('.client-row').first()).toContainText('Synthetic Alpha');
      await expect(page.locator('.client-row [data-recorded-visit-summary]')).toHaveCount(0);
      await expect(
        page.locator('.client-last a,.client-last button,.client-last [tabindex]'),
      ).toHaveCount(0);
      const before = page.url();
      await page.locator('.client-last').first().click();
      expect(page.url()).toBe(before);
      await page.getByLabel('Name or mobile number').fill('Zulu');
      await expect(page.locator('.client-row')).toHaveCount(1);
      await expect(
        page.getByRole('link', { name: 'Client Insights', exact: true }),
      ).toHaveAttribute('href', /q%3DZulu/);
      await expect(
        page.locator('.workspace-main').getByRole('link', { name: 'Client Insights', exact: true }),
      ).toHaveCount(0);
      const menu = page.locator('[data-workspace-navigation-drawer]');
      const menuToggle = page.getByRole('button', { name: 'Open Shiloh Workspace navigation' });
      if (width === 390) {
        await menuToggle.click();
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
        await menuToggle.click();
        await page.goBack();
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
        await menuToggle.click();
      }
      await expect(
        menu.locator(
          '[data-workspace-destination="clients"] + [data-workspace-destination="clientInsights"]',
        ),
      ).toHaveText('Client Insights');
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-workspace-navigation-drawer]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`insights-menu-${width}.png`),
        fullPage: true,
      });
      await menu.getByRole('link', { name: 'Client Insights', exact: true }).click();
      await expect(menu.locator('[data-workspace-destination="clientInsights"]')).toHaveAttribute(
        'aria-current',
        'page',
      );
      if (width === 390) await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      const periods = page.getByRole('navigation', { name: 'Insights period' });
      await expect(periods.locator('[aria-current="page"]')).toHaveText('2 months');
      await expect(page.locator('.insight-dates')).toContainText('01 Oct 2026');
      await expect(page.locator('.insight-months li')).toHaveCount(2);
      await expect(page.locator('.insight-totals dt')).toHaveText([
        'Total visits',
        'Individual clients',
      ]);
      await expect(page.locator('.brand')).toContainText(
        'Recorded client visits and visiting patterns.',
      );
      await expect(page.locator('.insight-comparison li')).toHaveCount(3);
      await expect(page.locator('.insight-comparison li strong')).toHaveText([
        '0 clients',
        '2 clients',
        '1 client',
      ]);
      await expect(page.locator('.insight-comparison li').last()).toContainText('08 Nov 2026');
      await expectComparisonCopy(page);
      await expectConciseContext(page);
      await expect(page.locator('.insight-rank')).toHaveCount(0);
      await expectInformationalBubbles(page, 2);
      const insightsUrl = page.url();
      await page.locator('.insight-bubble').first().click();
      expect(page.url()).toBe(insightsUrl);
      await expect(page.locator('.insight-ranking li').nth(1)).toContainText('Not enough history');
      await expect(page.locator('.insight-ranking li').first()).toContainText('Synthetic Zulu');
      await expect(page.locator('.insight-ranking li').first()).toContainText('About every 7 days');
      await expect(
        page.locator('.insight-ranking li').first().locator('.insight-treatment'),
      ).toContainText('Back massage · 5 visits');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-client-insights]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`insights-two-months-${width}.png`),
        fullPage: true,
      });
      await periods.getByRole('link', { name: '5 months', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.insight-months li')).toHaveCount(5);
      await expect(page.locator('.insight-dates')).toContainText('01 Jul 2026');
      await expectComparisonCopy(page);
      await expectConciseContext(page);
      await expectInformationalBubbles(page, 2);
      await page.screenshot({
        path: info.outputPath(`insights-five-months-${width}.png`),
        fullPage: true,
      });
      await page.getByRole('link', { name: 'Synthetic Zulu', exact: true }).click();
      await expect(page.locator('[data-client-home-section]')).toHaveAttribute(
        'data-client-home-section',
        'overview',
      );
      await expect(page.getByRole('region', { name: 'Recorded visits' })).toBeVisible();
      await page.getByRole('link', { name: 'Back to Insights', exact: true }).click();
      await expect(periods.locator('[aria-current="page"]')).toHaveText('5 months');
      await page.getByRole('link', { name: 'Back to Client Directory', exact: true }).click();
      await expect(page.getByLabel('Name or mobile number')).toHaveValue('Zulu');
      await page.screenshot({
        path: info.outputPath(`insights-compact-directory-${width}.png`),
        fullPage: true,
      });
      expect(requests.every((method) => method === 'GET')).toBe(true);
      expect((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n).toBe(7);
    } finally {
      await page.close();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      await f.close();
    }
  });

for (const width of [390, 1440]) {
  for (const state of [
    'two-months',
    'five-months',
    'month-end-clamping',
    'comparison-unavailable',
    'sparse-intervals',
    'empty',
    'unavailable',
    'compact-directory',
  ]) {
    test(`Client Insights Storybook ${state} at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 950 });
      await page.route('**/calendar/pwa/icon-192.png*', (route) =>
        route.fulfill({
          path: require('node:path').resolve('public/assets/brand/shiloh-mark-192.png'),
        }),
      );
      await page.goto(`/iframe.html?id=workspace-client-insights--${state}&viewMode=story`);
      if (state === 'compact-directory') {
        await expect(
          page.getByRole('heading', { name: 'Client Directory', exact: true }),
        ).toBeVisible();
        await expect(page.locator('.client-last').first()).toContainText('Next appointment');
        await expect(page.locator('.client-last a,.client-last button')).toHaveCount(0);
      } else {
        await expect(
          page.getByRole('heading', { name: 'Client Insights', exact: true }),
        ).toBeVisible();
        await expect(page.locator('[data-client-insights]')).not.toContainText(/\bSAST\b/);
        if (state === 'unavailable') {
          await expect(
            page.getByRole('heading', { name: 'Client Insights unavailable' }),
          ).toBeVisible();
          await expect(page.locator('.insight-totals')).toHaveCount(0);
        } else {
          await expect(page.locator('.insight-totals dt')).toHaveText([
            'Total visits',
            'Individual clients',
          ]);
          await expectConciseContext(page);
          await expect(
            page.getByRole('heading', { name: 'Average individual clients', exact: true }),
          ).toBeVisible();
          await expect(page.locator('.insight-averages dt')).toHaveText([
            'Per calendar day',
            'Per calendar week',
            'Per calendar month',
          ]);
          await expect(page.locator('.insight-averages dd')).toHaveCount(3);
          if (state === 'empty')
            await expect(page.locator('.insight-averages dd')).toHaveText(['0.0', '0.0', '0.0']);

          if (state === 'comparison-unavailable') {
            await expect(
              page.getByText('Client comparison unavailable.', { exact: false }),
            ).toBeVisible();
            await expect(page.locator('.insight-comparison')).toHaveCount(0);
          } else {
            await expect(page.locator('.insight-comparison li')).toHaveCount(3);
            await expectComparisonCopy(page, state === 'month-end-clamping');
          }
          if (state === 'month-end-clamping') {
            await expect(
              page.getByText('All three months end on day 28', { exact: false }),
            ).toBeVisible();
            for (const month of ['Jan', 'Feb', 'Mar'])
              await expect(page.locator('.insight-comparison')).toContainText(`28 ${month} 2026`);
          }
          if (state === 'empty')
            await expect(page.locator('.insight-comparison li strong')).toHaveText([
              '0 clients',
              '0 clients',
              '0 clients',
            ]);
          if (state === 'sparse-intervals')
            await expect(
              page.locator('.insight-bubble dd').filter({ hasText: 'Not enough history' }),
            ).toHaveCount(3);
          if (state !== 'empty') {
            await expect(page.locator('.insight-rank')).toHaveCount(0);
            await expectInformationalBubbles(page, 3);
            const beforeBubble = page.url();
            await page.locator('.insight-bubble').first().click();
            expect(page.url()).toBe(beforeBubble);
            await expect(page.locator('.insight-treatment').first()).toContainText(
              'Most-received treatment',
            );
            await expect(page.locator('.insight-treatment').nth(1)).toContainText(
              '2 treatments tied',
            );
            await expect(page.locator('.insight-treatment').nth(1)).toContainText(
              'Facial · Foot massage',
            );
            await expect(page.locator('.insight-treatment').nth(2)).toContainText(
              'Treatment details incomplete',
            );
            await expect(page.locator('.insight-treatment').nth(2).locator('small')).toHaveText(
              '1 visit has incomplete details',
            );
          }
          await expect(page.locator('.insight-months li')).toHaveCount(
            state === 'five-months' ? 5 : 2,
          );
          if (state === 'empty') await expect(page.locator('.insight-ranking li')).toHaveCount(0);
        }
      }
      await page.route('**/calendar/workspace/navigation', (route) =>
        route.fulfill({
          json: { clientInsights: { allowed: true, href: '/calendar/clients/insights' } },
        }),
      );
      await page.addScriptTag({
        content: workspaceNavigationClientScript() + workspaceIconClientScript(),
      });
      if (width === 390)
        await page.getByRole('button', { name: 'Open Shiloh Workspace navigation' }).click();
      await expect(
        page.locator(
          '[data-workspace-destination="clients"] + [data-workspace-destination="clientInsights"]',
        ),
      ).toHaveText('Client Insights');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include('.workspace-frame')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`storybook-insights-${state}-${width}.png`),
        fullPage: true,
      });
    });
  }
}

for (const width of [390, 1440])
  for (const access of ['allowed', 'tools-only', 'unavailable']) {
    test(`Shared Client Insights menu ${access} at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 950 });
      await page.route('**/calendar/pwa/icon-192.png*', (route) =>
        route.fulfill({
          path: require('node:path').resolve('public/assets/brand/shiloh-mark-192.png'),
        }),
      );
      await page.route('**/calendar/workspace/navigation', (route) =>
        access === 'unavailable'
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({
              json: {
                clients: { allowed: true, href: '/calendar/clients' },
                clientInsights: {
                  allowed: access === 'allowed',
                  href: access === 'allowed' ? '/calendar/clients/insights' : null,
                },
              },
            }),
      );
      await page.goto('/iframe.html?id=workspace-client-insights--workspace-menu&viewMode=story');
      await expect(
        page.getByRole('heading', { name: 'Client Directory', exact: true }),
      ).toBeVisible();
      await page.addScriptTag({
        content: workspaceNavigationClientScript() + workspaceIconClientScript(),
      });
      if (width === 390)
        await page.getByRole('button', { name: 'Open Shiloh Workspace navigation' }).click();
      const insights = page.locator('[data-workspace-destination="clientInsights"]');
      if (access === 'allowed') {
        await expect(insights).toBeVisible();
        await expect(insights).toHaveAttribute('href', '/calendar/clients/insights');
        await expect(insights.locator('.workspace-nav-icon')).toBeVisible();
        await expect(
          page.locator(
            '[data-workspace-destination="clients"] + [data-workspace-destination="clientInsights"]',
          ),
        ).toHaveText('Client Insights');
      } else {
        await expect(insights).toBeHidden();
        await expect(page.getByRole('link', { name: 'Client Insights', exact: true })).toHaveCount(
          0,
        );
      }
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-workspace-navigation-drawer]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`insights-menu-${access}-${width}.png`),
        fullPage: true,
      });
    });
  }
