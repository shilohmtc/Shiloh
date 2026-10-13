'use strict';
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const express = require('express');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { install, serviceFor } = require('./helpers/priorPaymentFixture');
const { createCalendarPaymentsRouter } = require('../src/routes/calendarPayments');
const {
  renderCalendarPaymentPage,
  calendarPaymentsClientScript,
} = require('../src/presentation/calendarPaymentsUx');
let server, base, pg, db, service;
const directory = 'artifacts/prior-payments-review';
test.beforeAll(async () => {
  fs.mkdirSync(directory, { recursive: true });
  const app = express();
  app.use(express.json());
  app.use('/storybook', express.static('storybook-static'));
  app.get('/client.js', (_req, res) => res.type('js').send(calendarPaymentsClientScript()));
  app.get('/payment', async (_req, res) =>
    res.send(
      renderCalendarPaymentPage({
        model: await service.get({ adminId: 2, appointmentId: 201 }),
        csrfToken: 'prior-csrf',
        clientScriptPath: '/client.js',
      }),
    ),
  );
  app.use(
    '/calendar/payments',
    createCalendarPaymentsRouter({
      env: { NODE_ENV: 'test' },
      sessionService: {
        validateSessionToken: async (token) =>
          token === 'synthetic-session' ? { ok: true, adminId: 2 } : { ok: false },
        validateCsrfToken: (_session, token) => token === 'prior-csrf',
      },
      service: {
        recordPrior: (input) => service.recordPrior(input),
        reversePrior: (input) => service.reversePrior(input),
      },
    }),
  );
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(async ({ context }) => {
  pg = new PGlite();
  const query = async (sql, params) => {
    const result = params ? await pg.query(sql, params) : (await pg.exec(sql)).at(-1);
    return { ...result, rowCount: result.rows.length || result.affectedRows };
  };
  db = { query, connect: async () => ({ query, release() {} }) };
  await install(db);
  service = serviceFor(db);
  await context.addCookies([
    { name: 'shiloh_staff_session', value: 'synthetic-session', url: base },
  ]);
});
test.afterEach(async () => pg?.close());
async function shot(page, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${directory}/${label}.png`, fullPage: true });
}
for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['phone', { width: 390, height: 844 }],
  ['narrow', { width: 320, height: 844 }],
]) {
  test(`paid previously ${name}: Storybook review, real settlement, lost-response retry and reversal`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    for (const story of [
      'reception',
      'paid-previously',
      'view-only',
      'partial-prior-with-credit',
      'prior-receipt-review',
    ]) {
      await page.goto(
        `${base}/storybook/iframe.html?id=workspace-paid-previously--${story}&viewMode=story`,
      );
      await expect(page.locator('[data-payment-page]')).toBeVisible();
      if (story === 'reception')
        await expect(page.locator('[data-prior-payment="prior-payment"]')).toBeVisible();
      if (story === 'view-only') await expect(page.locator('[data-prior-payment]')).toHaveCount(0);
      if (story === 'partial-prior-with-credit')
        await expect(page.locator('.payment-head .state')).toHaveText('Partially paid');
      if (story === 'prior-receipt-review')
        await expect(page.locator('.payment-head .state')).toHaveText('Payment review needed');
      await shot(page, `${name}-storybook-${story}`);
      const violations = (
        await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      ).violations;
      expect(violations).toEqual([]);
    }
    await page.goto(`${base}/payment`);
    await page.locator('[data-payment-method]').selectOption('prior-payment');
    const form = page.locator('[data-prior-payment="prior-payment"]');
    await form.locator('[name="amount"]').fill('500');
    await form.locator('[name="paymentDate"]').fill('2026-09-15');
    await form.locator('[name="reference"]').fill('SYNTHETIC-SEP-PAYMENT');
    await form.locator('[name="reason"]').fill('Verified earlier receipt');
    await form.locator('[name="reviewed"]').check();
    await shot(page, `${name}-ready`);
    let lost = true;
    await page.route('**/appointments/201/prior-payment', async (route) => {
      const response = await route.fetch();
      if (lost) {
        lost = false;
        await route.fulfill({
          status: 500,
          json: { error: 'Synthetic response lost after saving' },
        });
      } else await route.fulfill({ response });
    });
    await form.getByRole('button', { name: 'Record paid previously' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record paid previously' }).click();
    await expect(form.locator('[data-prior-status]')).toContainText('Retry this unchanged request');
    await expect(page.locator('[data-payment-method]')).toBeDisabled();
    await page.reload();
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: 'Record paid previously' })).toBeEnabled();
    await form.getByRole('button', { name: 'Record paid previously' }).click();
    await expect(page.locator('[data-prior-history]')).toContainText('Paid previously');
    await expect(page.locator('.balance').first()).toContainText(/R\s?500[,.]00/);
    const result = await service.get({ adminId: 2, appointmentId: 201 });
    expect(result.payment.outstanding).toBe('0.00');
    expect(result.payment.receivedToday).toBe('0.00');
    expect(result.payment.previouslyPaid).toBe('500.00');
    expect(
      (await db.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    ).toBe(0);
    expect(
      (await db.query('SELECT COUNT(*)::int AS n FROM booking_prior_payment_entries')).rows[0].n,
    ).toBe(1);
    await shot(page, `${name}-settled`);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    const reversal = page.locator('[data-prior-payment="prior-payment-reverse"]');
    await reversal.locator('[name="reason"]').fill('Evidence requires correction');
    await reversal.locator('[name="reviewed"]').check();
    await reversal.getByRole('button', { name: 'Reverse prior payment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reverse prior payment' }).click();
    await expect(page.locator('[data-prior-history]')).toContainText('Prior payment reversed');
    expect((await service.get({ adminId: 2, appointmentId: 201 })).payment.outstanding).toBe(
      '500.00',
    );
    await shot(page, `${name}-reversed`);
  });
}
