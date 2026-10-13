'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { install, serviceFor, priorInput } = require('./helpers/priorPaymentFixture');
const { remainingTreatmentCents } = require('../src/services/clientTreatmentCredit');
const { BALANCES_SQL, RECEIPTS_SQL } = require('../src/services/workspaceFinancialReports');
const { paymentState } = require('../src/services/myShilohClientContext');
const { renderCalendarPaymentPage } = require('../src/presentation/calendarPaymentsUx');
const { priorPaymentFixture } = require('./fixtures/bookingPriorPaymentPresentation');
async function setup(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  const query = async (sql, params) => {
    const result = params ? await pg.query(sql, params) : await pg.exec(sql);
    if (Array.isArray(result))
      return {
        ...result.at(-1),
        rowCount: result.at(-1).rows.length || result.at(-1).affectedRows,
      };
    return { ...result, rowCount: result.rows.length || result.affectedRows };
  };
  const db = { query, connect: async () => ({ query, release() {} }) };
  await install(db);
  return { pg, db, service: serviceFor(db) };
}
test('partial earlier payment remains payment when combined with goodwill credit', () => {
  const model = priorPaymentFixture();
  model.payment = {
    ...model.payment,
    state: 'partially_paid',
    priorPaid: '200.00',
    previouslyPaid: '200.00',
    treatmentCreditApplied: '100.00',
    outstanding: '200.00',
  };
  const html = renderCalendarPaymentPage({ model });
  assert.match(html, /Partially paid/);
  assert.doesNotMatch(html, /Credit applied · payment due/);
});
test('receipts on zero-priced source bookings require original-price review before reuse', async (t) => {
  const { pg, service } = await setup(t);
  await pg.exec(
    "UPDATE appointments SET total_price=0 WHERE id=202; INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,202,0,'ZAR',NOW())",
  );
  const receipt = (
    await pg.query(
      "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,created_at) VALUES(100,'payment',500,'2026-09-15T08:00Z') RETURNING id",
    )
  ).rows[0];
  assert.equal(
    (await service.get({ adminId: 2, appointmentId: 201 })).priorPayments.candidates.length,
    0,
  );
  await assert.rejects(service.recordPrior(priorInput({ sourceEntryId: receipt.id })), {
    code: 'PRIOR_PAYMENT_SOURCE_PRICE_REVIEW',
  });
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM booking_prior_payment_entries')).rows[0].n,
    0,
  );
});
test('cent-sized prior receipt allocations settle exactly without floating-point overpayment', async (t) => {
  const { pg, service } = await setup(t);
  await pg.exec(
    "UPDATE appointments SET total_price=0.10 WHERE id=201; UPDATE appointments SET total_price=0.20 WHERE id=202; INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,202,0.20,'ZAR',NOW())",
  );
  const receipt = (
    await pg.query(
      "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,created_at) VALUES(100,'payment',0.30,'2026-09-15T08:00Z') RETURNING id",
    )
  ).rows[0];
  const result = await service.recordPrior(
    priorInput({ amount: '0.10', sourceEntryId: receipt.id }),
  );
  assert.equal(result.payment.outstanding, '0.00');
  assert.equal(result.payment.state, 'paid');
  assert.equal((await service.get({ adminId: 2, appointmentId: 202 })).payment.netPaid, '0.20');
  assert.equal(paymentState({ amountDue: '0.30', paid: '0.20', priorPaid: '0.10' }).state, 'paid');
});
test('previously paid retains R500 treatment value, settles booking without a receipt, and retries exactly', async (t) => {
  const { pg, db, service } = await setup(t),
    input = priorInput();
  await pg.query(
    "INSERT INTO payment_requests(payment_account_id,state,amount) VALUES(NULL,'pending',500)",
  );
  const result = await service.recordPrior(input);
  assert.equal(result.status, 'applied');
  assert.equal(result.payment.amountDue, '500.00');
  assert.equal(result.payment.priorPaid, '500.00');
  assert.equal(result.payment.previouslyPaid, '500.00');
  assert.equal(result.payment.netPaid, '0.00');
  assert.equal(result.payment.receivedToday, '0.00');
  assert.equal(result.payment.outstanding, '0.00');
  assert.equal(
    (await db.query(RECEIPTS_SQL, ['2026-10-01', '2026-11-01', '2026-09-01', '2026-10-01'])).rows
      .length,
    0,
  );
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  assert.equal(model.authority.canRecordPrior, true);
  assert.equal(model.priorPayments.entries.length, 1);
  assert.equal(
    (await pg.query('SELECT total_price FROM appointments WHERE id=201')).rows[0].total_price,
    '500.00',
  );
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    0,
  );
  assert.equal((await service.recordPrior(input)).status, 'idempotent_replay');
  await assert.rejects(service.recordPrior({ ...input, amount: '400' }), {
    code: 'PRIOR_PAYMENT_RETRY_MISMATCH',
  });
  const account = (
    await db.query('SELECT * FROM booking_payment_accounts WHERE appointment_id=201')
  ).rows[0];
  assert.equal(await remainingTreatmentCents(db, account), 0);
  const balances = (await db.query(BALANCES_SQL, ['2026-10-01', '2026-11-01'])).rows;
  assert.equal(balances.find((row) => Number(row.appointment_id) === 201).prior_paid, '500.00');
  assert.equal(
    paymentState({ amountDue: '500', paid: '0', refunded: '0', priorPaid: '500' }).outstanding,
    '0.00',
  );
  await assert.rejects(pg.query('UPDATE booking_prior_payment_entries SET amount=1'), /immutable/);
});
test('partial prior payment, full audited reversal and subsequent payment preserve cash refund boundaries', async (t) => {
  const { pg, service } = await setup(t),
    applied = await service.recordPrior(priorInput({ amount: '200' }));
  assert.equal(applied.payment.outstanding, '300.00');
  const reverse = {
    adminId: 1,
    appointmentId: 201,
    entryId: applied.entry.id,
    reason: 'Evidence belongs to a different visit',
    reviewed: true,
    operationId: require('node:crypto').randomUUID(),
  };
  assert.equal((await service.reversePrior(reverse)).payment.outstanding, '500.00');
  assert.equal((await service.reversePrior(reverse)).status, 'idempotent_replay');
  await assert.rejects(
    service.reversePrior({ ...reverse, operationId: require('node:crypto').randomUUID() }),
    { code: 'PRIOR_PAYMENT_ALREADY_REVERSED' },
  );
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM booking_prior_payment_entries')).rows[0].n,
    2,
  );
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    0,
  );
  const again = await service.recordPrior(priorInput());
  assert.equal(again.payment.outstanding, '0.00');
  await assert.rejects(
    service.recordRefund({
      adminId: 1,
      appointmentId: 201,
      amount: '1',
      method: 'cash',
      reference: 'test',
      operationId: 'refund_test_key',
    }),
    { code: 'PAYMENT_REFUND_EXCEEDS_NET_PAID' },
  );
});
test('review, prior date, exact amounts, access, duplicates, cancellation and price changes fail closed', async (t) => {
  const { pg, service } = await setup(t);
  for (const override of [
    { reviewed: false },
    { paymentDate: '2026-10-12' },
    { paymentDate: '2026-02-30' },
    { reference: '' },
    { reason: '' },
    { amount: '1.001' },
  ])
    await assert.rejects(service.recordPrior(priorInput(override)), { httpStatus: 400 });
  await assert.rejects(service.recordPrior(priorInput({ adminId: 3 })), {
    code: 'PRIOR_PAYMENT_FORBIDDEN',
  });
  await assert.rejects(service.recordPrior(priorInput({ amount: '501' })), {
    code: 'PRIOR_PAYMENT_EXCEEDS_BALANCE',
  });
  await pg.query(
    "INSERT INTO client_package_entitlements(id,crm_v2_client_id,payment_reference) VALUES(1,101,'PACKAGE-REF')",
  );
  await assert.rejects(service.recordPrior(priorInput({ reference: ' package-ref ' })), {
    code: 'PRIOR_PAYMENT_DUPLICATE',
  });
  await service.recordPrior(priorInput({ amount: '200' }));
  await assert.rejects(service.recordPrior(priorInput({ appointmentId: 202, amount: '200' })), {
    code: 'PRIOR_PAYMENT_DUPLICATE',
  });
  await pg.query(
    "UPDATE staff_admin_accounts SET permissions=permissions-'payment:collect' WHERE id=2",
  );
  await assert.rejects(service.recordPrior(priorInput()), { code: 'PAYMENT_FORBIDDEN' });
  await pg.exec(
    "UPDATE staff_admin_accounts SET permissions=permissions||'{\"payment:collect\":true}'::jsonb WHERE id=2; UPDATE appointments SET status='cancelled' WHERE id=202",
  );
  await assert.rejects(service.recordPrior(priorInput({ appointmentId: 202 })), {
    code: 'PRIOR_PAYMENT_BOOKING_FINAL',
  });
  await pg.query('UPDATE appointments SET total_price=0 WHERE id=201');
  await assert.rejects(service.get({ adminId: 1, appointmentId: 201 }), {
    code: 'PAYMENT_PRICE_CHANGED_AFTER_SETTLEMENT',
  });
});
test('existing prior receipt counts automatically and only unused same-client cash can link to another booking', async (t) => {
  const { pg, service } = await setup(t);
  await pg.query(
    "INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,202,500,'ZAR',NOW())",
  );
  const receipt = (
    await pg.query(
      "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,external_reference,created_at) VALUES(100,'payment',800,'EXISTING-REF','2026-09-15T08:00Z') RETURNING id",
    )
  ).rows[0];
  const existing = await service.get({ adminId: 2, appointmentId: 202 });
  assert.equal(existing.payment.previouslyPaid, '800.00');
  assert.equal(existing.payment.receivedToday, '0.00');
  await assert.rejects(service.recordPrior(priorInput({ reference: 'existing-ref' })), {
    code: 'PRIOR_PAYMENT_DUPLICATE',
  });
  await assert.rejects(
    service.recordPrior(priorInput({ sourceEntryId: receipt.id, amount: '301' })),
    { code: 'PRIOR_PAYMENT_SOURCE_ALLOCATED' },
  );
  const linked = await service.recordPrior(
    priorInput({ sourceEntryId: receipt.id, amount: '300' }),
  );
  assert.equal(linked.payment.outstanding, '200.00');
  const source = await service.get({ adminId: 2, appointmentId: 202 });
  assert.equal(source.payment.netPaid, '500.00');
  assert.equal(source.payment.outstanding, '0.00');
  await assert.rejects(
    service.recordPrior(priorInput({ sourceEntryId: receipt.id, amount: '1' })),
    { code: 'PRIOR_PAYMENT_SOURCE_ALLOCATED' },
  );
  await service.reversePrior({
    adminId: 2,
    appointmentId: 201,
    entryId: linked.entry.id,
    reviewed: true,
    reason: 'Undo reviewed link',
    operationId: require('node:crypto').randomUUID(),
  });
  assert.equal((await service.get({ adminId: 2, appointmentId: 202 })).payment.netPaid, '800.00');
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    1,
  );
});
test('active links close with evidence and linked mixed-client bookings cannot be marked previously paid', async (t) => {
  const { pg, service } = await setup(t);
  await pg.exec(
    "INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,500,'ZAR',NOW()); INSERT INTO payment_requests(payment_account_id,state,amount) VALUES(100,'pending',250)",
  );
  const applied = await service.recordPrior(priorInput());
  const request = (await pg.query('SELECT * FROM payment_requests')).rows[0];
  assert.equal(request.state, 'cancelled');
  assert.equal(Number(request.prior_payment_closed_by_entry_id), Number(applied.entry.id));
  await pg.exec(
    "INSERT INTO appointment_groups VALUES(55,'completed',1150,1150,NOW()); INSERT INTO appointment_group_members VALUES(55,202),(55,204)",
  );
  await assert.rejects(service.recordPrior(priorInput({ appointmentId: 202 })), {
    code: 'PRIOR_PAYMENT_GROUP_REVIEW',
  });
});
test('verified money arriving on a link closed for prior settlement is recorded once and flagged for review', async (t) => {
  const { pg, service } = await setup(t);
  await pg.exec(
    "INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,500,'ZAR',NOW()); INSERT INTO payment_requests(payment_account_id,state,amount,request_key) VALUES(100,'pending',250,'closed_prior_request')",
  );
  await service.recordPrior(priorInput());
  const notification = {
    TransactionId: 'synthetic_prior_late',
    TransactionReference: 'closed_prior_request',
    Status: 'Complete',
    Amount: '250.00',
    CurrencyCode: 'ZAR',
  };
  assert.equal((await service.handleOzowNotification(notification)).status, 'paid_review_required');
  assert.equal((await service.handleOzowNotification(notification)).status, 'duplicate');
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  assert.equal(model.paymentReview.kind, 'prior_settlement_payment_received');
  assert.match(renderCalendarPaymentPage({ model }), /Payment review needed/);
  assert.doesNotMatch(renderCalendarPaymentPage({ model }), /Cancelled booking · payment review/);
  assert.equal(model.payment.state, 'overpaid');
  assert.equal(model.payment.netPaid, '250.00');
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    1,
  );
  assert.equal(
    (await pg.query('SELECT status FROM appointments WHERE id=201')).rows[0].status,
    'completed',
  );
});
test('prior-payment routes require session, same origin and CSRF and use the server actor and booking', async (t) => {
  const express = require('express'),
    { once } = require('node:events');
  const { createCalendarPaymentsRouter } = require('../src/routes/calendarPayments');
  const received = [],
    app = express();
  app.use(express.json());
  app.use(
    '/calendar/payments',
    createCalendarPaymentsRouter({
      env: { NODE_ENV: 'test' },
      rewardsService: {
        applyStaffCredit: async (input) => {
          received.push(input);
          return { status: 'applied' };
        },
      },
      sessionService: {
        validateSessionToken: async (token) =>
          token === 'signed-in' ? { ok: true, adminId: 2 } : { ok: false },
        validateCsrfToken: (_session, token) => token === 'csrf',
      },
      service: {
        recordPrior: async (input) => {
          received.push(input);
          return { status: 'applied' };
        },
        recordNoCharge: async (input) => {
          received.push(input);
          return { status: 'no_charge_recorded' };
        },
        reversePrior: async (input) => {
          received.push(input);
          return { status: 'reversed' };
        },
        recordManual: async (input) => {
          received.push(input);
          return { status: 'recorded' };
        },
        recordRefund: async (input) => {
          received.push(input);
          return { status: 'refunded' };
        },
        createOzowRequest: async (input) => {
          received.push(input);
          return { status: 'link_issued' };
        },
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`,
    headers = {
      cookie: 'shiloh_staff_session=signed-in',
      origin,
      'content-type': 'application/json',
      'x-shiloh-csrf-token': 'csrf',
    };
  const post = (action, extra = {}) =>
    fetch(`${origin}/calendar/payments/appointments/201/${action}`, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify({ adminId: 999, appointmentId: 999 }),
    });
  for (const action of [
    'no-charge',
    'prior-payment',
    'prior-payment-reverse',
    'manual',
    'refund',
    'ozow',
    'rewards',
  ]) {
    assert.equal((await post(action, { cookie: '' })).status, 401);
    assert.equal((await post(action, { origin: 'https://other.test' })).status, 403);
    assert.equal((await post(action, { 'x-shiloh-csrf-token': '' })).status, 403);
    const count = received.length;
    assert.equal((await post(action)).status, action === 'rewards' ? 200 : 201);
    assert.equal(received.length, count + 1);
    assert.equal(received.at(-1).adminId, 2);
    assert.equal(received.at(-1).appointmentId, '201');
  }
});

test('business admin can record, retry and reverse prior payment with their own audited identity', async (t) => {
  const { pg, service } = await setup(t);
  await pg.exec(
    "UPDATE staff_admin_accounts SET business_role='business_admin',display_name='Synthetic Business Admin' WHERE id=2",
  );
  const input = priorInput();
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  assert.equal(model.authority.canRecordPrior, true);
  assert.match(
    renderCalendarPaymentPage({ model }),
    /<option value="prior-payment">Paid previously<\/option>/,
  );
  const saved = await service.recordPrior(input);
  assert.equal(saved.payment.amountDue, '500.00');
  assert.equal(saved.payment.previouslyPaid, '500.00');
  assert.equal(saved.payment.outstanding, '0.00');
  assert.equal(saved.payment.receivedToday, '0.00');
  assert.equal((await service.recordPrior(input)).status, 'idempotent_replay');
  const reversed = await service.reversePrior({
    adminId: 2,
    appointmentId: 201,
    entryId: saved.entry.id,
    reason: 'Synthetic evidence correction',
    reviewed: true,
    operationId: require('node:crypto').randomUUID(),
  });
  assert.equal(reversed.payment.outstanding, '500.00');
  const entries = (
    await pg.query(
      'SELECT actor_admin_id, entry_type FROM booking_prior_payment_entries ORDER BY id',
    )
  ).rows;
  assert.deepEqual(
    entries.map((e) => Number(e.actor_admin_id)),
    [2, 2],
  );
  assert.deepEqual(
    entries.map((e) => e.entry_type),
    ['apply', 'undo'],
  );
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    0,
  );
});
for (const [label, change] of [
  ['missing collection permission', "permissions=permissions-'payment:collect'"],
  ['missing view permission', "permissions=permissions-'payment:view'"],
  ['inactive account', 'active=FALSE'],
  ['own service scope', "service_scope='own_services'"],
  ['own calendar scope', "calendar_scope='own_appointments',service_scope='own_services'"],
  ['practitioner role', "business_role='employee_practitioner'"],
])
  test(`business-admin prior-payment access fails closed for ${label}`, async (t) => {
    const { pg, service } = await setup(t);
    await pg.exec("UPDATE staff_admin_accounts SET business_role='business_admin' WHERE id=2");
    const input = priorInput({ amount: '100' });
    const saved = await service.recordPrior(input);
    await pg.exec(`UPDATE staff_admin_accounts SET ${change} WHERE id=2`);
    await assert.rejects(service.recordPrior(input), { httpStatus: 403 });
    await assert.rejects(
      service.reversePrior({
        adminId: 2,
        appointmentId: 201,
        entryId: saved.entry.id,
        reason: 'Synthetic correction',
        reviewed: true,
        operationId: require('node:crypto').randomUUID(),
      }),
      { httpStatus: 403 },
    );
    assert.equal(
      (await pg.query('SELECT COUNT(*)::int AS n FROM booking_prior_payment_entries')).rows[0].n,
      1,
    );
  });

async function noChargeInput(service, overrides = {}) {
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  return {
    adminId: 2,
    appointmentId: 201,
    expectedRevision: model.subject.pricingRevision,
    reason: 'Owner approved complimentary visit',
    reviewed: true,
    operationId: require('node:crypto').randomUUID(),
    ...overrides,
  };
}
test('no charge preserves original price and attendance, records actor/reason, creates no payment and retries exactly', async (t) => {
  const { pg, service } = await setup(t);
  const input = await noChargeInput(service);
  await pg.exec(
    "INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,500,'ZAR',NOW()); INSERT INTO payment_requests(payment_account_id,state,amount,request_key) VALUES(100,'pending',250,'no_charge_request')",
  );
  const result = await service.recordNoCharge(input);
  assert.equal(result.status, 'no_charge_recorded');
  assert.equal(result.payment.amountDue, '0.00');
  assert.equal(result.payment.outstanding, '0.00');
  assert.equal(result.payment.previouslyPaid, '0.00');
  assert.equal(result.payment.receivedToday, '0.00');
  assert.deepEqual(
    (
      await pg.query(
        'SELECT status,financial_classification,total_price,pre_adjustment_total_price FROM appointments WHERE id=201',
      )
    ).rows[0],
    {
      status: 'completed',
      financial_classification: 'no_charge',
      total_price: '0.00',
      pre_adjustment_total_price: '500.00',
    },
  );
  assert.equal((await pg.query('SELECT state FROM payment_requests')).rows[0].state, 'cancelled');
  assert.equal((await service.recordNoCharge(input)).status, 'idempotent_replay');
  await assert.rejects(service.recordNoCharge({ ...input, reason: 'Different reason' }), {
    code: 'NO_CHARGE_RETRY_MISMATCH',
  });
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  assert.equal(model.noChargeEvidence.actor_name, 'Synthetic Reception');
  assert.equal(model.noChargeEvidence.metadata.reason, input.reason);
  assert.match(renderCalendarPaymentPage({ model }), /Original treatment price/);
  assert.match(renderCalendarPaymentPage({ model }), /class="state">No charge/);
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
    0,
  );
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS n FROM booking_prior_payment_entries')).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pg.query(
        "SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.no_charge_recorded'",
      )
    ).rows[0].n,
    1,
  );
});
for (const role of ['owner', 'business_admin', 'booking_operator'])
  test(`no charge uses the existing ${role} payment and appointment authority`, async (t) => {
    const { pg, service } = await setup(t);
    await pg.exec(`UPDATE staff_admin_accounts SET business_role='${role}' WHERE id=2`);
    const input = await noChargeInput(service);
    assert.equal(
      (await service.get({ adminId: 2, appointmentId: 201 })).authority.canRecordNoCharge,
      true,
    );
    assert.equal((await service.recordNoCharge(input)).status, 'no_charge_recorded');
    await pg.exec(
      "UPDATE staff_admin_accounts SET permissions=permissions-'calendar:booking:cancel' WHERE id=2",
    );
    await assert.rejects(service.recordNoCharge(input), { httpStatus: 403 });
  });
for (const [label, sql] of [
  [
    'cash receipts',
    "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(100,'payment',100)",
  ],
  [
    'prior payment',
    "INSERT INTO booking_prior_payment_entries(booking_payment_account_id,appointment_id,crm_v2_client_id,entry_type,amount,payment_date,reference,reason,actor_admin_id,operation_id,request_fingerprint) VALUES(100,201,101,'apply',100,'2026-09-15','SYNTHETIC','Existing payment',2,'existingoperation','fingerprint')",
  ],
  ['rewards', "INSERT INTO booking_loyalty_allocations VALUES(100,'applied',100)"],
  ['welcome credit', "INSERT INTO booking_welcome_voucher_allocations VALUES(100,'applied',100)"],
  ['package visit', "INSERT INTO package_session_redemptions VALUES(201,'redeemed')"],
  ['uncompleted visit', "UPDATE appointments SET status='confirmed' WHERE id=201"],
  [
    'linked visit',
    "INSERT INTO appointment_groups VALUES(51,'completed',500,500,NOW()); INSERT INTO appointment_group_members VALUES(51,201,1)",
  ],
])
  test(`no charge refuses ${label} without changing price or evidence`, async (t) => {
    const { pg, service } = await setup(t);
    const input = await noChargeInput(service);
    await pg.exec(
      "INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,500,'ZAR',NOW())",
    );
    await pg.exec(sql);
    await assert.rejects(service.recordNoCharge(input), { httpStatus: 409 });
    assert.equal(
      (await pg.query('SELECT total_price FROM appointments WHERE id=201')).rows[0].total_price,
      '500.00',
    );
    assert.equal(
      (
        await pg.query(
          "SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.no_charge_recorded'",
        )
      ).rows[0].n,
      0,
    );
  });
test('no charge rejects missing review, blank reason and stale booking revision', async (t) => {
  const { pg, service } = await setup(t);
  const input = await noChargeInput(service);
  for (const changes of [{ reviewed: false }, { reason: ' ' }, { expectedRevision: 'invalid' }])
    await assert.rejects(service.recordNoCharge({ ...input, ...changes }), { httpStatus: 400 });
  await pg.exec("UPDATE appointments SET updated_at='2026-10-13T09:00Z' WHERE id=201");
  await assert.rejects(service.recordNoCharge(input), { code: 'NO_CHARGE_STALE' });
});
test('verified payment on a link closed for no charge remains cash evidence for review, not a cancelled booking', async (t) => {
  const { pg, service } = await setup(t);
  const input = await noChargeInput(service);
  await pg.exec(
    "INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,500,'ZAR',NOW());INSERT INTO payment_requests(payment_account_id,state,amount,request_key) VALUES(100,'pending',250,'no_charge_late_request')",
  );
  await service.recordNoCharge(input);
  const notification = {
    TransactionId: 'synthetic_no_charge_late',
    TransactionReference: 'no_charge_late_request',
    Status: 'Complete',
    Amount: '250.00',
    CurrencyCode: 'ZAR',
  };
  assert.equal((await service.handleOzowNotification(notification)).status, 'paid_review_required');
  assert.equal((await service.handleOzowNotification(notification)).status, 'duplicate');
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  assert.equal(model.paymentReview.kind, 'no_charge_payment_received');
  assert.equal(model.payment.netPaid, '250.00');
  assert.equal(model.payment.amountDue, '0.00');
  assert.match(renderCalendarPaymentPage({ model }), /Payment received after no charge/);
  assert.doesNotMatch(renderCalendarPaymentPage({ model }), /booking was cancelled/);
  assert.equal(
    (await pg.query('SELECT status FROM appointments WHERE id=201')).rows[0].status,
    'completed',
  );
});

test('no charge retains an earlier original price as well as the latest charged price', async (t) => {
  const { pg, service } = await setup(t);
  await pg.exec(
    "UPDATE appointments SET pre_adjustment_total_price=650,financial_classification='price_adjusted' WHERE id=201",
  );
  await service.recordNoCharge(await noChargeInput(service));
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  assert.equal(model.subject.originalPrice, '650.00');
  assert.equal(model.noChargeEvidence.metadata.originalPrice, '650.00');
  assert.equal(model.noChargeEvidence.metadata.previousChargedPrice, '500.00');
});

for (const [label, change] of [
  ['collection revoked', "permissions=permissions-'payment:collect'"],
  ['view revoked', "permissions=permissions-'payment:view'"],
  ['inactive account', 'active=FALSE'],
  ['limited service scope', "service_scope='own_services'"],
  ['limited calendar scope', "calendar_scope='own_appointments',service_scope='own_services'"],
])
  test(`no charge remains forbidden with ${label}`, async (t) => {
    const { pg, service } = await setup(t);
    const input = await noChargeInput(service);
    await pg.exec(`UPDATE staff_admin_accounts SET ${change} WHERE id=2`);
    await assert.rejects(service.recordNoCharge(input), { httpStatus: 403 });
    assert.equal(
      (await pg.query('SELECT total_price FROM appointments WHERE id=201')).rows[0].total_price,
      '500.00',
    );
  });
for (const kind of ['treatment credit', 'gift voucher'])
  test(`no charge cannot overwrite applied ${kind}`, async (t) => {
    const { pg, db, service } = await setup(t);
    const input = await noChargeInput(service);
    const { randomUUID } = require('node:crypto');
    if (kind === 'treatment credit') {
      const credit =
        require('../src/services/clientTreatmentCredit').createClientTreatmentCreditService({ db });
      await credit.issue({
        adminId: 1,
        clientId: 101,
        amount: '100',
        creditType: 'goodwill',
        reason: 'Synthetic goodwill',
        operationId: randomUUID(),
      });
      await credit.apply({
        adminId: 2,
        clientId: 101,
        appointmentId: 201,
        amount: '100',
        operationId: randomUUID(),
      });
    } else
      await require('../src/services/bookingNoncashSettlement')
        .createBookingNoncashSettlementService({ db })
        .applyGift({
          adminId: 2,
          clientId: 101,
          appointmentId: 201,
          voucherCode: 'SV-AAAAAAAAAAAA',
          amount: '100',
          operationId: randomUUID(),
        });
    await assert.rejects(service.recordNoCharge(input), { code: 'NO_CHARGE_PAYMENT_REVIEW' });
    assert.equal(
      (await pg.query('SELECT total_price FROM appointments WHERE id=201')).rows[0].total_price,
      '500.00',
    );
  });

test('explicitly reviewed no charge classifies an already-zero free visit without inventing its original price', async (t) => {
  const { pg, service } = await setup(t);
  await pg.exec('UPDATE appointments SET total_price=0 WHERE id=201');
  const input = await noChargeInput(service);
  await service.recordNoCharge(input);
  const model = await service.get({ adminId: 2, appointmentId: 201 });
  assert.equal(model.subject.financialClassification, 'no_charge');
  assert.equal(model.subject.originalPrice, '0.00');
  assert.equal(model.noChargeEvidence.metadata.originalPrice, '0.00');
  assert.equal(model.payment.previouslyPaid, '0.00');
});
