'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { install, serviceFor } = require('./helpers/priorPaymentFixture');
const { finalizeAppointment } = require('../src/services/adminAppointmentFinalization');
const revision = '2020-01-01T00:00:00.000Z';
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  let failAudit = false;
  const query = async (sql, params) => {
    if (failAudit && sql.includes("'admin.appointment_finalized'")) throw new Error('Synthetic audit unavailable');
    const raw = params ? await pg.query(sql, params) : await pg.exec(sql);
    const r = Array.isArray(raw) ? raw.at(-1) : raw;
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  const db = { query, connect: async () => ({ query, release() {} }) };
  await install(db);
  await query(`ALTER TABLE appointments ADD COLUMN ends_at TIMESTAMPTZ, ADD COLUMN source_client_name TEXT;
    ALTER TABLE appointment_staff ADD COLUMN staff_name_snapshot TEXT;
    CREATE TABLE staff_services(staff_id BIGINT,service_id BIGINT);
    CREATE TABLE appointment_status_history(appointment_id BIGINT,from_status TEXT,to_status TEXT,changed_by TEXT,reason TEXT);
    CREATE TABLE appointment_lifecycle(appointment_id BIGINT,status TEXT,updated_at TIMESTAMPTZ);
    UPDATE appointments SET status='confirmed',starts_at='2020-01-02T10:00Z',ends_at='2020-01-02T11:00Z',updated_at='2020-01-01' WHERE id IN(201,202);`);
  const service = serviceFor(db);
  const admin = { id: 1, display_name: 'Synthetic Owner', business_role: 'owner', calendar_scope: 'all_business', permissions: { 'booking:update': true, 'appointment:view': true } };
  const finish = (paymentDecision, overrides = {}) => finalizeAppointment(admin, 201, 'completed', { workspace: true, allowBusinessBackup: true, windowStart: '2020-01-02', windowEnd: '2020-01-03', expectedRevision: revision, connectionPool: db, completionPaymentService: service, paymentDecision, ...overrides });
  const state = async () => ({ status: (await query('SELECT status FROM appointments WHERE id=201')).rows[0].status, receipts: Number((await query('SELECT COUNT(*) AS count FROM payment_ledger_entries')).rows[0].count) });
  const paid = { choice: 'paid', amount: '200.00', method: 'cash', confirmed: true, expectedRevision: revision, operationId: 'synthetic_completion_receipt' };
  return { query, service, finish, state, paid, failAudit() { failAudit = true; } };
}
test('missing financial decision cannot finish; outstanding is audited without a receipt', async t => {
  const f = await fixture(t);
  await assert.rejects(f.finish(null), { code: 'COMPLETION_PAYMENT_REQUIRED' });
  assert.deepEqual(await f.state(), { status: 'confirmed', receipts: 0 });
  assert.equal((await f.finish({ choice: 'outstanding' })).status, 'updated');
  assert.deepEqual(await f.state(), { status: 'completed', receipts: 0 });
  const audit = (await f.query("SELECT metadata FROM crm_audit_events WHERE action='admin.appointment_finalized'")).rows[0].metadata;
  assert.deepEqual(audit.paymentDecision, { choice: 'outstanding' });
});
test('paid completion records only new money after prior payments; lost acknowledgement cannot duplicate it', async t => {
  const f = await fixture(t);
  await f.service.recordManual({ adminId: 1, appointmentId: 201, amount: '100.00', method: 'cash', operationId: 'synthetic_previous_receipt', expectedRevision: revision });
  const result = await f.finish(f.paid);
  assert.equal(result.status, 'updated');
  assert.equal(Number(result.paymentOutcome.outstanding), 200);
  assert.deepEqual(await f.state(), { status: 'completed', receipts: 2 });
  assert.equal((await f.finish(f.paid)).status, 'stale_or_forbidden');
  assert.deepEqual(await f.state(), { status: 'completed', receipts: 2 });
});
test('failed finalization audit rolls back receipt and attendance together', async t => {
  const f = await fixture(t); f.failAudit();
  await assert.rejects(f.finish(f.paid), /Synthetic audit unavailable/);
  assert.deepEqual(await f.state(), { status: 'confirmed', receipts: 0 });
});
test('stale revision and missing collection permission cannot record money or finish', async t => {
  const f = await fixture(t);
  assert.equal((await f.finish(f.paid, { expectedRevision: '2019-01-01T00:00:00.000Z' })).status, 'stale_revision');
  await f.query("UPDATE staff_admin_accounts SET permissions=permissions - 'payment:collect' WHERE id=1");
  await assert.rejects(f.finish(f.paid));
  assert.deepEqual(await f.state(), { status: 'confirmed', receipts: 0 });
});
test('settled requires verified zero balance and creates no duplicate receipt', async t => {
  const f = await fixture(t);
  await assert.rejects(f.finish({ choice: 'settled' }), { code: 'COMPLETION_BALANCE_CHANGED' });
  assert.deepEqual(await f.state(), { status: 'confirmed', receipts: 0 });
  await f.service.recordManual({ adminId: 1, appointmentId: 201, amount: '500.00', method: 'cash', operationId: 'synthetic_full_receipt', expectedRevision: revision });
  assert.equal((await f.finish({ choice: 'settled' })).status, 'updated');
  assert.deepEqual(await f.state(), { status: 'completed', receipts: 1 });
});
test('group receipt requires payer review; outstanding completes only the chosen participant', async t => {
  const f = await fixture(t);
  await f.query("INSERT INTO appointment_groups(id,status,total_price,final_total,updated_at) VALUES(501,'confirmed',1000,1000,'2020-01-01'); INSERT INTO appointment_group_members(group_id,appointment_id) VALUES(501,201),(501,202)");
  await assert.rejects(f.finish(f.paid), { code: 'COMPLETION_GROUP_PAYMENT_REVIEW' });
  assert.deepEqual(await f.state(), { status: 'confirmed', receipts: 0 });
  assert.equal((await f.finish({ choice: 'outstanding' })).status, 'updated');
  assert.equal((await f.query('SELECT status FROM appointments WHERE id=202')).rows[0].status, 'confirmed');
  assert.equal((await f.state()).receipts, 0);
});
test('completion state is a read-only canonical balance and retains view authority', async t => {
  const f = await fixture(t);
  const first = await f.service.getCompletionState({ adminId: 1, appointmentId: 201 });
  assert.equal(first.payment.outstanding, '500.00');
  assert.equal(first.authority.canCollect, true);
  assert.equal(Number((await f.query('SELECT COUNT(*) AS count FROM booking_payment_accounts')).rows[0].count), 0);
  assert.deepEqual(await f.state(), { status: 'confirmed', receipts: 0 });
  await assert.rejects(f.service.getCompletionState({ adminId: 3, appointmentId: 201 }));
});
test('completion synchronizes only this visit rewards silently; ordinary rewards retain notifications', async t => {
  const f = await fixture(t);
  await f.query("UPDATE appointments SET status='completed',total_price=500 WHERE id IN(201,204)");
  for (const appointmentId of [201,204]) {
    const current = new Date((await f.query('SELECT updated_at FROM appointments WHERE id=$1',[appointmentId])).rows[0].updated_at).toISOString();
    await f.service.recordManual({adminId:1,appointmentId,amount:'500.00',method:'cash',operationId:'synthetic_reward_receipt_'+appointmentId,expectedRevision:current});
  }
  await f.query(`ALTER TABLE payment_requests ADD COLUMN payer_crm_v2_client_id BIGINT;
    CREATE TABLE loyalty_program_settings(singleton BOOLEAN,earn_basis_points INT,unlock_threshold NUMERIC,expiry_mode TEXT,activated_at TIMESTAMPTZ);
    INSERT INTO loyalty_program_settings VALUES(TRUE,500,100,'no_expiry','2000-01-01');
    CREATE TABLE loyalty_wallets(id BIGSERIAL PRIMARY KEY,crm_v2_client_id BIGINT UNIQUE,updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE loyalty_wallet_entries(id BIGSERIAL PRIMARY KEY,wallet_id BIGINT,entry_type TEXT,signed_amount NUMERIC,operation_key TEXT UNIQUE,source_payment_ledger_entry_id BIGINT UNIQUE,booking_payment_account_id BIGINT,appointment_id BIGINT,notes TEXT);
    INSERT INTO loyalty_wallets(crm_v2_client_id) VALUES(101),(102);
    INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key) VALUES(1,'adjustment',90,'synthetic_previous_reward_101'),(2,'adjustment',90,'synthetic_previous_reward_102');`);
  const pushes=[];
  const db={query:f.query,connect:async()=>({query:f.query,release(){}})};
  const rewards=require('../src/services/shilohRewards').createShilohRewardsService({db,notifyClient:async message=>pushes.push(message)});
  const payments=require('../src/services/bookingPayments').createBookingPaymentService({db,rewards});
  const balances=async()=> (await f.query('SELECT wallet_id,SUM(signed_amount)::numeric(12,2) AS balance FROM loyalty_wallet_entries GROUP BY wallet_id ORDER BY wallet_id')).rows.map(r=>Number(r.balance));
  await payments.syncCompletionRewards(201);
  assert.deepEqual(await balances(),[115,90],'only the completed visit is synchronized');
  assert.equal(pushes.length,0,'completion must not send even an indirect reward notification');
  await payments.syncCompletionRewards(201);
  assert.deepEqual(await balances(),[115,90],'retry does not duplicate rewards');
  await rewards.syncEligibleEarnings();
  assert.deepEqual(await balances(),[115,115]);
  assert.equal(pushes.length,1,'ordinary reward synchronization retains its existing notification');
  assert.equal(pushes[0].crmV2ClientId,102,'other clients are not silently swept by completion');
});
