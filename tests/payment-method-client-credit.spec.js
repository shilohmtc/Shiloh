'use strict';
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const express = require('express');
const fs = require('node:fs');
const {
  renderCalendarPaymentPage,
  calendarPaymentsClientScript,
} = require('../src/presentation/calendarPaymentsUx');
const { paymentMethodFixture } = require('./fixtures/paymentMethodClientCredit');
let server, base, model, mode, requests, applied;
const directory = 'artifacts/payment-method-client-credit';
test.beforeAll(async () => {
  fs.mkdirSync(directory, { recursive: true });
  const app = express();
  app.use(express.json());
  app.get('/client.js', (_req, res) => res.type('js').send(calendarPaymentsClientScript()));
  app.get('/payment', (_req, res) =>
    res.send(renderCalendarPaymentPage({ model, clientScriptPath: '/client.js' })),
  );
  app.post('/calendar/payments/appointments/779/:action', (req, res) => {
    const action = req.params.action;
    requests.push({ action, ...req.body });
    if (!applied.has(req.body.operationId)) {
      applied.add(req.body.operationId);
      const amount = Number(req.body.amount);
      model.payment.outstanding = (Number(model.payment.outstanding) - amount).toFixed(2);
      model.payment.state = Number(model.payment.outstanding) ? 'partially_paid' : 'paid';
      if (action === 'manual') {
        model.payment.netPaid = (Number(model.payment.netPaid) + amount).toFixed(2);
        model.payment.entries.push({
          entry_type: 'payment',
          method: req.body.method,
          amount,
          created_at: '2026-10-09T08:00:00Z',
        });
      } else {
        model.payment.noncashEntries = [
          ...(model.payment.noncashEntries || []),
          {
            kind: action === 'client-credit' ? 'treatment_credit' : 'gift_voucher',
            amount,
            action: 'apply',
            actor: 'Synthetic Reception',
            reason: 'Synthetic reviewed use',
            created_at: '2026-10-09T08:00:00Z',
          },
        ];
        if (action === 'client-credit') {
          model.noncash.credit.balance -= amount;
          model.payment.treatmentCreditApplied = amount;
        } else {
          model.payment.giftVoucherApplied = amount;
          model.noncash.gift.vouchers = model.noncash.gift.vouchers
            .map((v) => ({
              ...v,
              balance:
                v.voucher_code === req.body.voucherCode ? Number(v.balance) - amount : v.balance,
            }))
            .filter((v) => Number(v.balance) > 0);
        }
      }
    }
    if (mode === 'lost')
      return res.status(500).json({ error: 'Synthetic response lost. Review and retry.' });
    return res.json({ status: action === 'manual' ? 'recorded' : 'applied' });
  });
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => {
  model = paymentMethodFixture();
  mode = 'normal';
  requests = [];
  applied = new Set();
});
async function openPayment(page) {
  await page.goto(`${base}/payment`);
  if ((await page.locator('[data-payment-method-card]').getAttribute('open')) === null)
    await page.locator('[data-payment-method-card] summary').click();
}
async function screenshot(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
}
for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['phone', { width: 390, height: 844 }],
  ['narrow', { width: 320, height: 844 }],
]) {
  test(`payment method ${name}: production Storybook states and profile Credit access`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const state of [
      'card-machine',
      'voucher',
      'partial-client-credit',
      'active-request',
      'client-credit-section',
      'view-only-credit-section',
      'credit-unavailable',
    ]) {
      await page.goto(
        `/iframe.html?id=workspace-payment-method-and-client-credit--${state}&viewMode=story`,
        { waitUntil: 'networkidle' },
      );
      if (state.includes('section') || state === 'credit-unavailable') {
        await expect(page.locator('[data-client-credit-summary]')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Add credit', exact: true })).toHaveCount(
          state === 'client-credit-section' ? 1 : 0,
        );
        if (state === 'credit-unavailable')
          await expect(
            page.getByText('Credit balance is temporarily unavailable.', { exact: false }),
          ).toBeVisible();
      } else {
        await expect(page.getByLabel('Payment method', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Payment method', { exact: true })).toHaveValue(
          { voucher: 'gift-voucher', 'partial-client-credit': 'client-credit' }[state] ||
            'card_machine',
        );
        if (state === 'partial-client-credit')
          await expect(
            page.locator('[data-booking-noncash="client-credit"] [data-noncash-preview]'),
          ).toContainText('300');
        if (state === 'active-request')
          await expect(page.locator('option[value="client-credit"]')).toBeDisabled();
      }
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual(
        [],
      );
      await screenshot(page, `${name}-${state}`);
    }
  });
  test(`payment method ${name}: method reset, linked voucher choice and R500 credit plus R300 cash`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openPayment(page);
    const selector = page.getByLabel('Payment method', { exact: true }),
      manual = page.locator('[data-manual-form]');
    await manual.getByLabel('Amount (R)', { exact: true }).fill('100');
    await manual.getByRole('checkbox').check();
    await selector.selectOption('gift-voucher');
    await expect(manual).toBeHidden();
    expect(await manual.locator('input[type=checkbox]').isChecked()).toBe(false);
    const gift = page.locator('[data-booking-noncash="gift-voucher"]');
    await gift.getByLabel('Amount to use (R)').fill('50');
    await gift.getByLabel('Available gift voucher').selectOption('SV-SYNTHETIC02');
    await expect(gift.getByLabel('Amount to use (R)')).toHaveValue('');
    await expect(gift.locator('[data-gift-available]')).toContainText('100');
    await gift.getByLabel('Amount to use (R)').fill('101');
    await expect(gift.getByRole('button')).toBeDisabled();
    await selector.selectOption('client-credit');
    const credit = page.locator('[data-booking-noncash="client-credit"]');
    await credit.getByLabel('Amount to use (R)').fill('500');
    await expect(credit.locator('[data-noncash-preview]')).toContainText('300');
    await screenshot(page, `${name}-credit-500-preview`);
    await credit.getByRole('button').click();
    await expect(selector).toBeDisabled();
    await page.getByRole('button', { name: 'Go back', exact: true }).click();
    expect(requests).toHaveLength(0);
    await expect(selector).toBeEnabled();
    await credit.getByRole('button').click();
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: 'Confirm use', exact: true }).dblclick(),
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].action).toBe('client-credit');
    expect(Number(model.payment.netPaid)).toBe(0);
    expect(Number(model.payment.outstanding)).toBe(300);
    if ((await page.locator('[data-payment-method-card]').getAttribute('open')) === null)
      await page.locator('[data-payment-method-card] summary').click();
    await selector.selectOption('cash');
    await manual.getByLabel('Amount (R)', { exact: true }).fill('300');
    await manual.getByRole('checkbox').check();
    await Promise.all([
      page.waitForNavigation(),
      manual.getByRole('button', { name: 'Record payment', exact: true }).dblclick(),
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].action).toBe('manual');
    expect(requests[1].method).toBe('cash');
    expect(requests[1].receivedOutsideOzowConfirmed).toBe('on');
    expect(Number(model.payment.netPaid)).toBe(300);
    expect(Number(model.payment.outstanding)).toBe(0);
    await expect(page.getByText('Client credit used · noncash', { exact: true })).toBeVisible();
    await expect(page.locator('[data-booking-noncash], [data-ozow-form]')).toHaveCount(0);
    await expect(page.locator('[data-payment-method-card]')).not.toHaveAttribute('open');
    await screenshot(page, `${name}-mixed-payment-settled`);
  });
  test(`payment method ${name}: manual lost response retries same receipt and locks stale choices`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openPayment(page);
    mode = 'lost';
    const manual = page.locator('[data-manual-form]'),
      selector = page.locator('[data-payment-method]');
    await manual.getByLabel('Amount (R)', { exact: true }).fill('500');
    await manual.getByRole('checkbox').check();
    await manual.getByRole('button').click();
    await expect(page.locator('[data-payment-status]')).toContainText(
      'Retry this unchanged receipt',
    );
    await expect(selector).toBeDisabled();
    const operation = requests[0].operationId;
    await page.route('**/manual', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic access changed' }),
      }),
    );
    await manual.getByRole('button').click();
    await expect(page.locator('[data-payment-status]')).toContainText('Synthetic access changed');
    await expect(selector).toBeDisabled();
    await page.unroute('**/manual');
    await page.reload();
    await expect(manual.getByLabel('Amount (R)', { exact: true })).toHaveValue('500');
    await expect(manual.getByLabel('Amount (R)', { exact: true })).toHaveAttribute('readonly', '');
    await selector.evaluate((node) => {
      node.value = 'client-credit';
      node.dispatchEvent(new Event('change'));
    });
    await expect(selector).toHaveValue('card_machine');
    await screenshot(page, `${name}-manual-retry`);
    mode = 'normal';
    await Promise.all([page.waitForNavigation(), manual.getByRole('button').dblclick()]);
    expect(requests).toHaveLength(2);
    expect(requests[1].operationId).toBe(operation);
    expect(applied.size).toBe(1);
    expect(Number(model.payment.netPaid)).toBe(500);
    if ((await page.locator('[data-payment-method-card]').getAttribute('open')) === null)
      await page.locator('[data-payment-method-card] summary').click();
    await expect(selector).toBeEnabled();
    await expect(manual.getByLabel('Amount (R)', { exact: true })).toHaveValue('300.00');
  });
  test(`payment method ${name}: spent voucher after lost response resolves by original operation`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    model.noncash.gift.vouchers = [model.noncash.gift.vouchers[0]];
    await openPayment(page);
    mode = 'lost';
    await page.locator('[data-payment-method]').selectOption('gift-voucher');
    const gift = page.locator('[data-booking-noncash="gift-voucher"]');
    await gift.getByLabel('Amount to use (R)').fill('500');
    await gift.getByRole('button').click();
    await page.getByRole('button', { name: 'Confirm use', exact: true }).click();
    await expect(gift.getByRole('status')).toContainText('Review and retry');
    const operation = requests[0].operationId;
    await page.reload();
    await expect(page.locator('[data-payment-method]')).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Retry earlier request', exact: true }),
    ).toBeVisible();
    await screenshot(page, `${name}-voucher-retry`);
    mode = 'normal';
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: 'Retry earlier request', exact: true }).click(),
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].operationId).toBe(operation);
    expect(applied.size).toBe(1);
    expect(Number(model.payment.outstanding)).toBe(300);
    expect(Number(model.payment.netPaid)).toBe(0);
  });
}
