'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { clientRecordedVisitsFixture } = require('./helpers/clientRecordedVisitsFixture');
const { createClientInsightsService } = require('../src/services/clientInsights');
const { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');

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
      await page.getByRole('link', { name: 'Client Insights', exact: true }).click();
      const periods = page.getByRole('navigation', { name: 'Insights period' });
      await expect(periods.locator('[aria-current="page"]')).toHaveText('2 months');
      await expect(page.locator('.insight-dates')).toContainText('01 Oct 2026');
      await expect(page.locator('.insight-months li')).toHaveCount(2);
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
  for (const state of ['two-months', 'five-months', 'empty', 'unavailable', 'compact-directory']) {
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
        if (state === 'unavailable') {
          await expect(
            page.getByRole('heading', { name: 'Client Insights unavailable' }),
          ).toBeVisible();
          await expect(page.locator('.insight-totals')).toHaveCount(0);
        } else {
          if (state !== 'empty') {
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
          }
          await expect(page.locator('.insight-months li')).toHaveCount(
            state === 'five-months' ? 5 : 2,
          );
          if (state === 'empty') await expect(page.locator('.insight-ranking li')).toHaveCount(0);
        }
      }
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
