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
        recordNoCharge: (input) => service.recordNoCharge(input),
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
])
  for (const role of ['booking_operator', 'business_admin']) {
    const label = role === 'business_admin' ? `${name}-jp` : name;
    test(`paid previously ${label}: Storybook review, real settlement, lost-response retry and reversal`, async ({
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
        if (story === 'view-only')
          await expect(page.locator('[data-prior-payment]')).toHaveCount(0);
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
      if (role === 'business_admin')
        await db.query(
          "UPDATE staff_admin_accounts SET business_role='business_admin',display_name='Synthetic Business Admin' WHERE id=2",
        );
      await page.goto(`${base}/payment`);
      await page.locator('[data-payment-method]').selectOption('prior-payment');
      const form = page.locator('[data-prior-payment="prior-payment"]');
      await form.locator('[name="amount"]').fill('500');
      await form.locator('[name="paymentDate"]').fill('2026-09-15');
      await form.locator('[name="reference"]').fill('SYNTHETIC-SEP-PAYMENT');
      await form.locator('[name="reason"]').fill('Verified earlier receipt');
      await form.locator('[name="reviewed"]').check();
      await shot(page, `${label}-ready`);
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
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Record paid previously' })
        .click();
      await expect(form.locator('[data-prior-status]')).toContainText(
        'Retry this unchanged request',
      );
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
      await shot(page, `${label}-settled`);
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
      await shot(page, `${label}-reversed`);
    });
  }

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['phone', { width: 390, height: 844 }],
  ['narrow', { width: 320, height: 844 }],
])
  test(`no charge ${name}: Storybook, business-admin confirmation, exact lost-response retry and truthful history`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    for (const story of ['no-charge', 'no-charge-recorded']) {
      await page.goto(
        `${base}/storybook/iframe.html?id=workspace-paid-previously--${story}&viewMode=story`,
      );
      await expect(page.locator('[data-payment-page]')).toBeVisible();
      if (story === 'no-charge')
        await expect(page.locator('[data-prior-payment="no-charge"]')).toBeVisible();
      else await expect(page.locator('.payment-head .state')).toHaveText('No charge');
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
          .violations,
      ).toEqual([]);
      await shot(page, `${name}-storybook-${story}`);
    }
    await db.query(
      "UPDATE staff_admin_accounts SET business_role='business_admin',display_name='Synthetic Business Admin' WHERE id=2",
    );
    await page.goto(`${base}/payment`);
    await page.locator('[data-payment-method]').selectOption('no-charge');
    const form = page.locator('[data-prior-payment="no-charge"]');
    await form.locator('[name="reason"]').fill('Owner approved complimentary visit');
    await form.locator('[name="reviewed"]').check();
    await shot(page, `${name}-no-charge-ready`);
    await form.getByRole('button', { name: 'Record no charge' }).click();
    await expect(page.getByRole('dialog')).toContainText('practitioner earnings become R0');
    await page.getByRole('dialog').getByRole('button', { name: 'Go back' }).click();
    expect((await service.get({ adminId: 2, appointmentId: 201 })).payment.amountDue).toBe(
      '500.00',
    );
    let lost = true;
    await page.route('**/appointments/201/no-charge', async (route) => {
      const response = await route.fetch();
      if (lost) {
        lost = false;
        await route.fulfill({
          status: 500,
          json: { error: 'Synthetic response lost after saving' },
        });
      } else await route.fulfill({ response });
    });
    await form.getByRole('button', { name: 'Record no charge' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record no charge' }).click();
    await expect(form.locator('[data-prior-status]')).toContainText('Retry this unchanged request');
    await page.reload();
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'Record no charge' }).click();
    await expect(page.locator('.payment-head .state')).toHaveText('No charge');
    await expect(page.locator('[data-no-charge-history]')).toContainText(
      'Owner approved complimentary visit',
    );
    await expect(page.locator('[data-no-charge-history]')).toContainText(
      'Synthetic Business Admin',
    );
    const model = await service.get({ adminId: 2, appointmentId: 201 });
    expect(model.subject.originalPrice).toBe('500.00');
    expect(model.payment.outstanding).toBe('0.00');
    expect(model.payment.previouslyPaid).toBe('0.00');
    expect(model.payment.receivedToday).toBe('0.00');
    expect(
      (
        await db.query(
          "SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.no_charge_recorded'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await db.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    ).toBe(0);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await shot(page, `${name}-no-charge-saved`);
  });
