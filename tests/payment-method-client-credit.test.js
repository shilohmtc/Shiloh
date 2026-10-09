'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceClientDetailHandler } = require('../src/routes/workspaceClients');
const {
  renderCalendarPaymentPage,
  calendarPaymentsClientScript,
} = require('../src/presentation/calendarPaymentsUx');
const { noncashMethodAvailability } = require('../src/presentation/bookingNoncashUx');
const { paymentFixture } = require('./fixtures/bookingPaymentPresentation');
const eligible = () => {
  const model = paymentFixture({ paid: false });
  model.payment.requests = [];
  return model;
};
test('one selector exposes five methods while manual ledger receives only its hidden cash method', () => {
  const html = renderCalendarPaymentPage({ model: eligible() });
  assert.equal((html.match(/data-payment-method aria/g) || []).length, 1);
  for (const label of ['Card machine', 'Cash', 'EFT', 'Voucher', 'Client credit'])
    assert.match(html, new RegExp(`>${label}</option>`));
  assert.doesNotMatch(html, /<select name="method">/);
  assert.match(html, /name="method" value="card_machine"/);
  assert.match(html, /data-payment-panel="gift-voucher"[^>]* hidden/);
  assert.match(html, /data-payment-panel="client-credit"[^>]* hidden/);
  assert.match(html, /data-payment-method-card open/);
  new (require('node:vm').Script)(calendarPaymentsClientScript());
});
test('unavailable noncash choices give accurate reasons and render no settlement form', () => {
  for (const [change, reason] of [
    [
      (m) => {
        m.deposit.requirement.state = 'awaiting';
      },
      /deposit still needs payment/,
    ],
    [
      (m) => {
        m.subject.status = 'confirmed';
      },
      /after treatment is completed/,
    ],
    [
      (m) => {
        m.subject.crmV2ClientId = null;
      },
      /linked client profile/,
    ],
    [
      (m) => {
        m.payment.requests = [{ state: 'created' }];
      },
      /active payment request/,
    ],
  ]) {
    const model = eligible();
    change(model);
    assert.match(noncashMethodAvailability(model).credit, reason);
    const html = renderCalendarPaymentPage({ model });
    assert.doesNotMatch(html, /data-booking-noncash=/);
    assert.match(html, /value="client-credit" disabled/);
    if (model.deposit.requirement.state === 'awaiting' || model.payment.requests.length) {
      assert.doesNotMatch(html, /data-payment-method-card open/);
    }
  }
  const model = eligible();
  model.noncash.credit.balance = 0;
  model.noncash.gift.vouchers = [];
  assert.match(noncashMethodAvailability(model).credit, /No client credit/);
  assert.match(noncashMethodAvailability(model).gift, /No eligible linked vouchers/);
  model.noncash.credit.canApply = false;
  assert.match(noncashMethodAvailability(model).credit, /Your access/);
});
async function profile(creditService) {
  const handler = createWorkspaceClientDetailHandler({
    env: {
      SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
      SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
    },
    service: {
      async getClientDetail() {
        return { client: { id: 101 } };
      },
    },
    notificationService: {
      async resolveAccess() {
        return false;
      },
    },
    creditService,
    renderPage: () =>
      '<style></style><main><section class="profile-grid"></section><section class="history-panel"><h2>History</h2></section></main>',
    injectManagement: (html) => html,
  });
  let html, status;
  const response = {
    setHeader() {},
    status(value) {
      status = value;
      return this;
    },
    type() {
      return this;
    },
    send(value) {
      html = value;
      return this;
    },
  };
  await handler({ staffBrowserSession: { adminId: 2 }, params: { id: '101' } }, response);
  assert.equal(status, 200);
  return html;
}
test('client profile Credit section reads the canonical model, sits above history and respects issue/correction access', async () => {
  let calls = 0;
  const service = {
    async canView() {},
    async getClientModel(input) {
      calls++;
      assert.deepEqual(input, { adminId: 2, clientId: 101 });
      return { balance: 500, authority: { canIssue: true, canCorrect: true } };
    },
  };
  const html = await profile(service);
  assert.equal(calls, 1);
  assert.match(html, /R.*500/);
  assert.match(html, />Add credit</);
  assert.match(html, />Manage credit history</);
  assert.ok(html.indexOf('data-client-credit-summary') < html.indexOf('<h2>History'));
  const viewOnly = await profile({
    ...service,
    async getClientModel() {
      return { balance: 0, authority: {} };
    },
  });
  assert.doesNotMatch(viewOnly, />Add credit</);
  assert.match(viewOnly, />View credit history</);
});
test('denied credit access reveals no balance; unavailable read never claims zero or disrupts client detail', async () => {
  const denied = await profile({
    async canView() {
      throw { httpStatus: 403 };
    },
    async getClientModel() {
      assert.fail('Unauthorized balance read');
    },
  });
  assert.doesNotMatch(denied, /data-client-credit-summary/);
  const unavailable = await profile({
    async canView() {},
    async getClientModel() {
      throw new Error('Synthetic outage');
    },
  });
  assert.match(unavailable, /balance is temporarily unavailable/);
  assert.doesNotMatch(unavailable, /Available client credit|R\s*0/);
  const revoked = await profile({
    async canView() {},
    async getClientModel() {
      throw { httpStatus: 403 };
    },
  });
  assert.doesNotMatch(revoked, /data-client-credit-summary/);
});

test('linked-booking availability reads the existing same-client/completed guard without creating a financial account', async () => {
  const express = require('express');
  const { createCalendarPaymentsRouter } = require('../src/routes/calendarPayments');
  let unsafe = true,
    loads = 0,
    reads = 0;
  const app = express();
  app.use(
    '/calendar/payments',
    createCalendarPaymentsRouter({
      sessionService: {
        async validateSessionToken() {
          return { ok: true, adminId: 2, sessionId: 2 };
        },
      },
      service: {
        async get() {
          const model = eligible();
          model.subject.groupId = 99;
          return model;
        },
      },
      groupReadDb: {
        async query(sql, values) {
          reads++;
          assert.match(sql, /^SELECT 1 FROM appointment_group_members/);
          assert.match(sql, /crm_v2_client_id IS DISTINCT FROM/);
          assert.match(sql, /a.status<>'completed'/);
          assert.deepEqual(values, [99, 101]);
          return { rowCount: unsafe ? 1 : 0 };
        },
      },
      creditService: {
        async getClientModel() {
          loads++;
          return { balance: 500, authority: { canApply: true } };
        },
      },
      giftSettlementService: {
        async getAvailable() {
          loads++;
          return { canApply: true, vouchers: [] };
        },
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/calendar/payments/appointments/779/state`,
      { headers: { Cookie: 'shiloh_staff_session=synthetic' } },
    );
    assert.equal(response.status, 200);
    const model = await response.json();
    assert.equal(model.noncash.eligible, false);
    assert.match(noncashMethodAvailability(model).credit, /Linked treatments/);
    assert.equal(loads, 0);
    unsafe = false;
    const valid = await fetch(
      `http://127.0.0.1:${server.address().port}/calendar/payments/appointments/779/state`,
      { headers: { Cookie: 'shiloh_staff_session=synthetic' } },
    );
    assert.equal((await valid.json()).noncash.eligible, true);
    assert.equal(loads, 2);
    assert.equal(reads, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
