'use strict';
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const express = require('express');
const fs = require('node:fs');
const { renderCalendarPaymentPage, calendarPaymentsClientScript } = require('../src/presentation/calendarPaymentsUx');
const { paymentFixture } = require('./fixtures/bookingPaymentPresentation');
let server, base;
test.beforeAll(async () => {
  fs.mkdirSync('artifacts/paid-booking-payment', { recursive: true });
  const app = express();
  app.get('/client.js', (_req, res) => res.type('js').send(calendarPaymentsClientScript()));
  app.get('/:state', (req, res) => res.send(renderCalendarPaymentPage({ model: paymentFixture({ paid: req.params.state === 'paid', awaitingDeposit: req.params.state === 'deposit' }), clientScriptPath: '/client.js' })));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(resolve => server.close(resolve)));
for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }], ['narrow', { width: 320, height: 844 }]]) {
  test(`paid booking ${name}: Storybook, history, accessibility and checkbox alignment`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const state of ['paid-with-earlier-deposit', 'balance-with-satisfied-deposit', 'awaiting-deposit']) {
      await page.goto(`/iframe.html?id=workspace-booking-payment-recovery--${state}&viewMode=story`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
      await expect(page.getByText('Reception help', { exact: true })).toHaveCount(0);
      if (state === 'paid-with-earlier-deposit') {
        await expect(page.locator('[data-ozow-form],[data-rewards-form],[data-copy-link]')).toHaveCount(0);
        await expect(page.getByText('Earlier request · no collection needed', { exact: false })).toBeVisible();
        await expect(page.locator('details.manual-payment')).not.toHaveAttribute('open');
      } else {
        const boxes = await page.locator('[data-ozow-form] input[type=checkbox], [data-rewards-form] input[type=checkbox]').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, target: node.closest('label').getBoundingClientRect().height })));
        for (const box of boxes) { expect(box.width).toBe(18); expect(box.height).toBe(18); expect(box.target).toBeGreaterThanOrEqual(44); }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).include('[data-payment-page]').analyze();
      expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({ path: `artifacts/paid-booking-payment/${name}-${state}.png`, fullPage: true });
    }
    await page.goto(`${base}/paid`);
    await page.locator('details.manual-payment > summary').click();
    await page.locator('[data-payment-method]').selectOption('card_machine');
    const form = page.locator('[data-manual-form]'), button = form.getByRole('button', { name: 'Record payment', exact: true });
    await expect(button).toBeDisabled();
    await form.getByRole('checkbox').check();
    for (const invalid of ['0', '-1', 'NaN', 'Infinity', '1.001', '']) {
      await form.getByLabel('Amount (R)', { exact: true }).fill(invalid);
      await expect(button).toBeDisabled();
    }
    await form.getByLabel('Amount (R)', { exact: true }).fill('25.50');
    await expect(button).toBeEnabled();
    await form.getByRole('checkbox').uncheck();
    await expect(button).toBeDisabled();
    let posts = 0;
    await page.route('**/manual', route => { posts++; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic review required' }) }); });
    await form.evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(posts).toBe(0);
    await form.getByRole('checkbox').check();
    await button.click();
    await expect(page.locator('[data-payment-status]')).toContainText('Synthetic review required');
    expect(posts).toBe(1);
    await expect(button).toBeEnabled();
    await page.screenshot({ path: `artifacts/paid-booking-payment/${name}-manual-confirmation.png`, fullPage: true });
  });
}
