const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { install } = require('./helpers/priorPaymentFixture');
const { createCompletedVisitRewards } = require('../src/services/completedVisitRewards');
async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  const calls = [];
  let auditFailure = false;
  const query = async (sql, args) => {
    calls.push(sql);
    if (auditFailure && sql.includes("VALUES($1,'loyalty.completed_visit_applied'"))
      throw Error('Synthetic audit failure');
    const raw = args ? await pg.query(sql, args) : await pg.exec(sql);
    const r = Array.isArray(raw) ? raw.at(-1) : raw;
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  const db = { query, connect: async () => ({ query, release() {} }) };
  await install(db);
  await query(
    "DROP TABLE booking_loyalty_allocations; CREATE TABLE client_browser_sessions(id bigint PRIMARY KEY); CREATE TABLE crm_v2_client_relationships(client_id bigint,relationship_type text,owner_staff_id bigint); INSERT INTO crm_v2_client_relationships VALUES(101,'clinic',NULL),(102,'clinic',NULL); CREATE TABLE service_visibility_policies(service_id bigint,visibility_scope text,owner_staff_id bigint);",
  );
  await query(
    fs
      .readFileSync('migrations/140_shiloh_rewards_wallet.sql', 'utf8')
      .split('ALTER TABLE payment_requests')[0],
  );
  await query(
    'UPDATE staff_admin_accounts SET permissions=permissions || \'{"loyalty:view":true,"loyalty:redeem":true,"appointment:view":true}\'::jsonb WHERE id IN(1,2); INSERT INTO loyalty_wallets(crm_v2_client_id) VALUES(101); INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key) VALUES(1,\'adjustment\',300,\'synthetic_seed\');',
  );
  return {
    query,
    calls,
    service: createCompletedVisitRewards({ db }),
    setAuditFailure: (v) => {
      auditFailure = v;
    },
  };
}
const input = { adminId: 1, crmV2ClientId: 101, appointmentId: 201, amount: '100.00' };
test('completed reward preview is read-only and application reduces balance without recording cash or creating refunds', async (t) => {
  const f = await fixture(t),
    mark = f.calls.length,
    review = await f.service.preview(input);
  assert.equal(review.amount, '100.00');
  assert.equal(Number(review.outstanding) - Number(review.remaining), 100);
  assert.ok(f.calls.slice(mark).every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
  assert.ok(f.calls.slice(mark).includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  const receiptBefore = await f.query('SELECT COUNT(*) AS count FROM payment_ledger_entries');
  const operation = {
    ...input,
    reviewToken: review.reviewToken,
    clientConfirmed: true,
    operationId: 'synthetic_completed_reward_1',
  };
  const result = await f.service.apply(operation);
  assert.equal(result.outstanding, review.remaining);
  assert.equal(result.rewardsRemaining, '200.00');
  const repeat = await f.service.apply(operation);
  assert.equal(repeat.status, 'idempotent_replay');
  assert.equal(repeat.allocationId, result.allocationId);
  assert.equal(
    (await f.query('SELECT COUNT(*) AS count FROM booking_loyalty_allocations')).rows[0].count,
    1,
  );
  assert.deepEqual(
    (await f.query('SELECT COUNT(*) AS count FROM payment_ledger_entries')).rows,
    receiptBefore.rows,
  );
  await assert.rejects(
    f.service.apply({ ...operation, amount: '90.00' }),
    (e) => e.code === 'REWARDS_RETRY_MISMATCH',
  );
  assert.equal(
    (
      await f.query(
        "SELECT COUNT(*) AS count FROM crm_audit_events WHERE action='loyalty.completed_visit_applied'",
      )
    ).rows[0].count,
    1,
  );
});
test('partial receipts and applied vouchers count; paid visits cannot turn rewards into a refund or credit', async (t) => {
  const f = await fixture(t);
  await f.query(
    'INSERT INTO booking_payment_accounts(appointment_id,canonical_amount_due,currency,pricing_revision) SELECT id,total_price,currency,updated_at FROM appointments WHERE id=201 ON CONFLICT(appointment_id) DO NOTHING',
  );
  const account = (await f.query('SELECT * FROM booking_payment_accounts WHERE appointment_id=201'))
    .rows[0];
  await f.query(
    "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES($1,'payment',100)",
    [account.id],
  );
  await f.query(
    "INSERT INTO booking_welcome_voucher_allocations(booking_payment_account_id,state,amount) VALUES($1,'applied',50)",
    [account.id],
  );
  let preview = await f.service.preview(input);
  assert.equal(Number(preview.outstanding), Number(account.canonical_amount_due) - 150);
  await f.query(
    "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES($1,'payment',$2)",
    [account.id, preview.outstanding],
  );
  await assert.rejects(f.service.preview(input), (e) => e.code === 'REWARDS_ALREADY_SETTLED');
  await assert.rejects(
    f.service.apply({
      ...input,
      reviewToken: preview.reviewToken,
      clientConfirmed: true,
      operationId: 'synthetic_paid_visit',
    }),
    (e) => e.code === 'REWARDS_ALREADY_SETTLED',
  );
  assert.equal(
    (await f.query('SELECT COUNT(*) AS count FROM booking_loyalty_allocations')).rows[0].count,
    0,
  );
});
test('changed balances, revisions, consent, deposits, payment links and permissions block a stale reward decision', async (t) => {
  const f = await fixture(t);
  let preview = await f.service.preview(input);
  const apply = () =>
    f.service.apply({
      ...input,
      reviewToken: preview.reviewToken,
      clientConfirmed: true,
      operationId: 'synthetic_changed_visit',
    });
  await assert.rejects(
    f.service.apply({
      ...input,
      reviewToken: preview.reviewToken,
      operationId: 'synthetic_no_consent',
    }),
    (e) => e.code === 'REWARDS_CONFIRMATION_REQUIRED',
  );
  await f.query("UPDATE appointments SET updated_at=updated_at+interval '1 second' WHERE id=201");
  await assert.rejects(apply(), (e) => e.code === 'REWARDS_REVIEW_CHANGED');
  preview = await f.service.preview(input);
  await f.query(
    "INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key) VALUES(1,'adjustment',20,'synthetic_wallet_changed')",
  );
  await assert.rejects(apply(), (e) => e.code === 'REWARDS_REVIEW_CHANGED');
  await f.query(
    'UPDATE staff_admin_accounts SET permissions=permissions || \'{"loyalty:redeem":false}\'::jsonb WHERE id=1',
  );
  await assert.rejects(apply(), (e) => e.code === 'REWARDS_FORBIDDEN');
  await f.query(
    'UPDATE staff_admin_accounts SET permissions=permissions || \'{"loyalty:redeem":true}\'::jsonb WHERE id=1',
  );
  await f.query(
    'INSERT INTO booking_payment_accounts(appointment_id,canonical_amount_due,currency,pricing_revision) SELECT id,total_price,currency,updated_at FROM appointments WHERE id=201 ON CONFLICT(appointment_id) DO NOTHING',
  );
  const a = (await f.query('SELECT id FROM booking_payment_accounts WHERE appointment_id=201'))
    .rows[0].id;
  preview = await f.service.preview(input);
  await f.query(
    "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES($1,'payment',25)",
    [a],
  );
  await assert.rejects(apply(), (e) => e.code === 'REWARDS_REVIEW_CHANGED');
  await f.query(
    "INSERT INTO booking_deposit_requirements(payment_account_id,state) VALUES($1,'awaiting')",
    [a],
  );
  await assert.rejects(f.service.preview(input), (e) => e.code === 'REWARDS_COLLECTION_REVIEW');
  await f.query("UPDATE booking_deposit_requirements SET state='waived'");
  await f.query("INSERT INTO payment_requests(payment_account_id,state) VALUES($1,'pending')", [a]);
  await assert.rejects(f.service.preview(input), (e) => e.code === 'REWARDS_COLLECTION_REVIEW');
  assert.equal(
    (await f.query('SELECT COUNT(*) AS count FROM booking_loyalty_allocations')).rows[0].count,
    0,
  );
});
test('same-client completed groups are one balance; other clients, unfinished members and private services fail closed', async (t) => {
  const f = await fixture(t);
  await f.query(
    "INSERT INTO appointment_groups(id,status,total_price,updated_at) VALUES(71,'completed',1000,NOW()); INSERT INTO appointment_group_members(group_id,appointment_id) VALUES(71,201),(71,202);",
  );
  const review = await f.service.preview(input);
  assert.equal(review.outstanding, '1000.00');
  await f.query("UPDATE appointments SET status='scheduled' WHERE id=202");
  await assert.rejects(f.service.preview(input), (e) => e.code === 'REWARDS_GROUP_REVIEW');
  await f.query("UPDATE appointments SET status='completed',crm_v2_client_id=102 WHERE id=202");
  await assert.rejects(f.service.preview(input), (e) => e.code === 'REWARDS_GROUP_REVIEW');
  await f.query(
    "UPDATE appointments SET crm_v2_client_id=101 WHERE id=202; INSERT INTO service_visibility_policies VALUES(21,'tenant_private',NULL)",
  );
  await assert.rejects(f.service.preview(input), (e) => e.code === 'REWARDS_BOOKING_FORBIDDEN');
  await f.query('DELETE FROM service_visibility_policies');
  const current = await f.service.preview(input);
  const result = await f.service.apply({
    ...input,
    reviewToken: current.reviewToken,
    clientConfirmed: true,
    operationId: 'synthetic_shared_reward',
  });
  assert.equal(result.outstanding, '900.00');
  assert.equal(
    (
      await f.query(
        'SELECT COUNT(*) AS count FROM booking_payment_accounts WHERE appointment_group_id=71',
      )
    ).rows[0].count,
    1,
  );
});
test('audit failure rolls back wallet debit, allocation and newly created payment account', async (t) => {
  const f = await fixture(t),
    review = await f.service.preview(input);
  const before = (await f.query('SELECT COUNT(*) AS count FROM booking_payment_accounts')).rows;
  f.setAuditFailure(true);
  await assert.rejects(
    f.service.apply({
      ...input,
      reviewToken: review.reviewToken,
      clientConfirmed: true,
      operationId: 'synthetic_audit_failure',
    }),
    /Synthetic audit/,
  );
  assert.deepEqual(
    (await f.query('SELECT COUNT(*) AS count FROM booking_payment_accounts')).rows,
    before,
  );
  assert.equal(
    (await f.query('SELECT COUNT(*) AS count FROM booking_loyalty_allocations')).rows[0].count,
    0,
  );
  assert.equal(
    Number(
      (await f.query('SELECT SUM(signed_amount) AS balance FROM loyalty_wallet_entries')).rows[0]
        .balance,
    ),
    300,
  );
});
test('unrecorded provider receipts and recorded payment exceptions block both preview and stale reviewed apply', async (t) => {
  const f = await fixture(t);
  await f.query('INSERT INTO booking_payment_accounts(appointment_id,canonical_amount_due,currency,pricing_revision) SELECT id,total_price,currency,updated_at FROM appointments WHERE id=201');
  const account = (await f.query('SELECT id FROM booking_payment_accounts WHERE appointment_id=201')).rows[0].id;
  const before = await f.service.preview(input);
  const request = (await f.query("INSERT INTO payment_requests(payment_account_id,state,amount) VALUES($1,'paid',25) RETURNING id", [account])).rows[0].id;
  for (const state of ['paid', 'refunded', 'partially_refunded']) {
    await f.query('UPDATE payment_requests SET state=$1 WHERE id=$2', [state, request]);
    await assert.rejects(f.service.preview(input), { code: 'REWARDS_PAYMENT_REVIEW' });
    await assert.rejects(f.service.apply({ ...input, reviewToken: before.reviewToken, clientConfirmed: true, operationId: 'synthetic_unverified_receipt' }), { code: 'REWARDS_PAYMENT_REVIEW' });
  }
  await f.query("INSERT INTO payment_ledger_entries(payment_account_id,payment_request_id,entry_type,amount) VALUES($1,$2,'payment',25)", [account, request]);
  const verified = await f.service.preview(input);
  assert.equal(Number(verified.outstanding), Number(before.outstanding) - 25);
  await f.query("INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata) VALUES('payment.received_after_collection_changed','booking_payment_account',$1,'{}')", [account]);
  await assert.rejects(f.service.preview(input), { code: 'REWARDS_PAYMENT_REVIEW' });
  await assert.rejects(f.service.apply({ ...input, reviewToken: verified.reviewToken, clientConfirmed: true, operationId: 'synthetic_payment_exception' }), { code: 'REWARDS_PAYMENT_REVIEW' });
  assert.equal(Number((await f.query('SELECT COUNT(*) AS n FROM booking_loyalty_allocations')).rows[0].n), 0);
  assert.equal(Number((await f.query("SELECT COUNT(*) AS n FROM loyalty_wallet_entries WHERE entry_type='redeem'")).rows[0].n), 0);
});
