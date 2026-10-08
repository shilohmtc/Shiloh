'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { createClientTreatmentCreditService, normalized, TreatmentCreditError } = require('../src/services/clientTreatmentCredit');
const { createWorkspaceTreatmentCreditRouter } = require('../src/routes/workspaceTreatmentCredit');
const { renderTreatmentCreditPage, treatmentCreditClientScript } = require('../src/presentation/clientTreatmentCreditUx');
const { CREDITS_SQL } = require('../src/services/workspaceFinancialReports');
const { financialCsv } = require('../src/presentation/workspaceFinancialReportsUx');
const { summarizeFinancials } = require('../src/domain/workspaceFinancialReports');
const { resolvePeriod } = require('../src/services/workspaceReports');
const fixture = fs.readFileSync('tests/fixtures/treatment-credit-schema.sql', 'utf8');
const migration = fs.readFileSync('migrations/188_client_treatment_credit.sql', 'utf8');
async function setup(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(fixture); await pg.exec(migration);
  const db = { query: (...args) => pg.query(...args), connect: async () => ({ query: (...args) => pg.query(...args), release() {} }) };
  return { pg, service: createClientTreatmentCreditService({ db }) };
}
const issuance = overrides => ({ adminId: 1, clientId: 101, amount: '500', creditType: 'service_exchange', reason: 'Synthetic supplier work', reference: 'SYNTHETIC-INVOICE-101', operationId: randomUUID(), ...overrides });
const usage = overrides => ({ adminId: 2, clientId: 101, appointmentId: 201, amount: '150', operationId: randomUUID(), ...overrides });
test('credit input requires exact money, type, reason and exchange evidence', () => {
  for (const amount of ['0','-1','1.001','1e2','99999999999','NaN']) assert.throws(() => normalized(issuance({ amount }), 'issue'), { httpStatus: 400 });
  for (const overrides of [{ creditType: 'gift' }, { reason: '' }, { reference: '' }, { operationId: 'repeat' }]) assert.throws(() => normalized(issuance(overrides), 'issue'), { httpStatus: 400 });
  assert.equal(normalized(issuance({ amount: '0.10' }), 'issue').amount, '0.10');
});
test('partial use retains source invoice and actor evidence; retries are exact and immutable', async t => {
  const { pg, service } = await setup(t), issue = issuance(), apply = usage();
  await service.issue(issue); assert.equal((await service.issue(issue)).status, 'idempotent_replay');
  assert.equal((await service.apply(apply)).balance, 350);
  assert.equal((await service.apply(apply)).status, 'idempotent_replay');
  await assert.rejects(service.issue({ ...issue, amount: '501' }), { code: 'CREDIT_RETRY_MISMATCH' });
  await assert.rejects(service.apply({ ...apply, appointmentId: 202 }), { code: 'CREDIT_RETRY_MISMATCH' });
  await assert.rejects(service.apply({ ...apply, adminId: 1 }), { code: 'CREDIT_RETRY_MISMATCH' });
  const model = await service.getClientModel({ adminId: 1, clientId: 101 });
  assert.equal(model.balance, 350); assert.equal(model.entries.length, 2); assert.equal(model.entries[1].reference, 'SYNTHETIC-INVOICE-101');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM crm_audit_events')).rows[0].n, 2);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n, 0);
  await assert.rejects(pg.query("UPDATE treatment_credit_entries SET reason='changed'"), /immutable/);
  await assert.rejects(pg.query('DELETE FROM treatment_credit_allocations'), /immutable/);
  await pg.query("UPDATE appointments SET status='cancelled' WHERE id=201");
  assert.equal((await service.apply(apply)).status, 'idempotent_replay');
  assert.equal((await service.getClientModel({ adminId: 1, clientId: 101 })).balance, 350);
});
test('dedicated current permissions required for every write and replay, with rollback', async t => {
  const { pg, service } = await setup(t), input = issuance();
  await assert.rejects(service.issue({ ...input, adminId: 3 }), { code: 'CREDIT_FORBIDDEN' });
  await service.issue(input);
  await pg.query("UPDATE staff_admin_accounts SET permissions=permissions-'treatment_credit:issue' WHERE id=1");
  await assert.rejects(service.issue(input), { code: 'CREDIT_FORBIDDEN' });
  await assert.rejects(service.apply(usage({ adminId: 3 })), { code: 'CREDIT_FORBIDDEN' });
  await assert.rejects(service.issue(issuance({ adminId: 2, clientId: 103 })), { code: 'CREDIT_CLIENT_UNAVAILABLE' });
  const archived = await service.getClientModel({ adminId: 2, clientId: 103 });
  assert.equal(archived.authority.canIssue, false); assert.equal(archived.authority.canApply, false);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM treatment_credit_entries')).rows[0].n, 1);
});
test('deposits, future/cancelled/missing-price/changed-price and linked mixed-client visits fail closed', async t => {
  const { pg, service } = await setup(t); await service.issue(issuance());
  await assert.rejects(service.apply(usage({ appointmentId: 203 })), { code: 'CREDIT_TREATMENT_INCOMPLETE' });
  await assert.rejects(service.apply(usage({ appointmentId: 204 })), { code: 'CREDIT_BOOKING_FORBIDDEN' });
  await pg.exec("INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,650,'ZAR',NOW()); INSERT INTO booking_deposit_requirements(payment_account_id,state) VALUES(100,'awaiting')");
  await assert.rejects(service.apply(usage()), { code: 'CREDIT_DEPOSIT_REQUIRED' });
  await pg.exec("UPDATE booking_deposit_requirements SET state='satisfied'; INSERT INTO payment_requests(payment_account_id,state) VALUES(100,'pending')");
  await assert.rejects(service.apply(usage()), { code: 'CREDIT_OPEN_PAYMENT' });
  await pg.exec("UPDATE payment_requests SET state='cancelled'; UPDATE appointments SET total_price=600 WHERE id=201");
  await assert.rejects(service.apply(usage()), { code: 'CREDIT_PRICE_CHANGED' });
  await pg.exec("UPDATE appointments SET total_price=NULL WHERE id=201");
  await assert.rejects(service.apply(usage()), { code: 'CREDIT_PRICE_UNAVAILABLE' });
  await pg.exec("UPDATE appointments SET status='cancelled',total_price=650 WHERE id=201");
  await assert.rejects(service.apply(usage()), { code: 'CREDIT_TREATMENT_INCOMPLETE' });
  await pg.exec("UPDATE appointments SET status='completed' WHERE id=201; INSERT INTO appointment_groups VALUES(50,'completed',1300,1300,NOW()); INSERT INTO appointment_group_members VALUES(50,201),(50,204)");
  await assert.rejects(service.apply(usage()), { code: 'CREDIT_GROUP_REVIEW' });
  assert.equal((await service.getClientModel({ adminId: 1, clientId: 101 })).balance, 500);
});
test('partial use cannot exceed wallet or canonical balance after cash, refunds and other credits', async t => {
  const { pg, service } = await setup(t); await service.issue(issuance());
  await service.apply(usage());
  await assert.rejects(service.apply(usage({ amount: '351' })), { code: 'CREDIT_EXCEEDS_BALANCE' });
  const account = (await pg.query('SELECT id FROM booking_payment_accounts WHERE appointment_id=201')).rows[0].id;
  await pg.query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES($1,'payment',300),($1,'refund',50)", [account]);
  await pg.query("INSERT INTO booking_loyalty_allocations VALUES($1,'applied',100)", [account]);
  await pg.query("INSERT INTO booking_welcome_voucher_allocations VALUES($1,'applied',100)", [account]);
  await assert.rejects(service.apply(usage({ amount: '51' })), { code: 'CREDIT_EXCEEDS_TREATMENT' });
  assert.equal((await service.apply(usage({ amount: '50' }))).outstanding, 0);
});
test('FIFO use preserves goodwill and exchange evidence separately in noncash reports and CSV', async t => {
  const { pg, service } = await setup(t);
  await service.issue(issuance({ creditType: 'goodwill', reference: '', amount: '100' }));
  await service.issue(issuance({ reference: '=SYNTHETIC-INVOICE-101', amount: '400' }));
  await service.apply(usage());
  const credits = (await pg.query(CREDITS_SQL, ['2000-01-01', '2100-01-01'])).rows;
  assert.equal(credits.length, 4);
  assert.equal(Number(credits.find(r => r.entry_type === 'apply' && r.credit_type === 'goodwill').amount), -100);
  assert.equal(Number(credits.find(r => r.entry_type === 'apply' && r.credit_type === 'service_exchange').amount), -50);
  const period = resolvePeriod({ preset: 'today', now: new Date('2026-10-08T12:00Z') });
  const finance = { ...summarizeFinancials({ period, treatments: [{ id: 201, starts_at: '2026-10-08T08:00Z', value: '650' }], balances: [{ appointment_id: 201, amount_due: '650', net_paid: '0', credits: '150', starts_at: '2026-10-08T08:00Z' }] }), period, treatmentCredits: credits };
  assert.equal(finance.current.treatmentValue, 650); assert.equal(finance.current.received, 0); assert.equal(finance.outstanding, 500);
  assert.match(financialCsv(finance), /"'=SYNTHETIC-INVOICE-101"/);
  assert.match(financialCsv(finance), /excluded from cash receipts/);
});
test('route guards reject unauthenticated/cross-origin/CSRF requests and ignore forged actor', async t => {
  let writes = 0;
  const app = express(); app.use(express.json());
  app.use('/calendar/treatment-credit', createWorkspaceTreatmentCreditRouter({ env: {}, sessionService: {
    async validateSessionToken(token) { return token === 'test' ? { ok: true, adminId: 2 } : { ok: false }; },
    validateCsrfToken: (_session, token) => token === 'valid',
  }, service: { async issue(input) { assert.equal(input.adminId, 2); writes++; return { status: 'issued' }; }, async reduce(input) { assert.equal(input.adminId, 2); writes++; return { status: 'reduced' }; }, async undo(input) { assert.equal(input.adminId, 2); writes++; return { status: 'returned' }; }, async apply() { throw new TreatmentCreditError('CREDIT_FORBIDDEN', 'Denied', 403); } } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, headers = { Cookie: 'shiloh_staff_session=test', Origin: origin, 'Content-Type': 'application/json', 'X-Shiloh-CSRF-Token': 'valid' };
  const post = (custom, action = 'issue') => fetch(`${origin}/calendar/treatment-credit/${action}`, { method: 'POST', headers: custom, body: JSON.stringify({ adminId: 1 }) });
  assert.equal((await post({ ...headers, Cookie: '' })).status, 401);
  assert.equal((await post({ ...headers, Origin: 'https://other.test' })).status, 403);
  assert.equal((await post({ ...headers, 'X-Shiloh-CSRF-Token': 'wrong' })).status, 403);
  assert.equal(writes, 0);
  const response = await post(headers); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await post(headers, 'apply')).status, 403); assert.equal(writes, 1);
  for (const action of ['reduce','undo']) {
    assert.equal((await post({ ...headers, Cookie: '' }, action)).status, 401);
    assert.equal((await post({ ...headers, Origin: 'https://other.test' }, action)).status, 403);
    assert.equal((await post({ ...headers, 'X-Shiloh-CSRF-Token': 'wrong' }, action)).status, 403);
    assert.equal((await post(headers, action)).status, 200);
  }
  assert.equal(writes, 3);
});
test('credit surface escapes private evidence and renders read-only authority without actions', () => {
  const html = renderTreatmentCreditPage({ model: { client: { id: 101, name: '<script>bad</script>' }, balance: 1, entries: [], appointments: [], authority: {} } });
  assert.doesNotMatch(html, /<script>bad/); assert.doesNotMatch(html, /data-credit-form/); assert.match(html, /Remaining treatment credit/);
  new (require('node:vm').Script)(treatmentCreditClientScript());
});
const correction = overrides => ({ adminId: 2, clientId: 101, sourceEntryId: 1, amount: '10', reason: 'Synthetic reviewed correction', reviewed: true, operationId: randomUUID(), ...overrides });
test('manual correction requires an exact amount, original target, reason and explicit review', () => {
  for (const overrides of [{ amount: '0' }, { amount: '1.001' }, { sourceEntryId: 0 }, { reason: '' }, { reviewed: false }]) assert.throws(() => normalized(correction(overrides), 'undo'), { httpStatus: 400 });
  assert.equal(normalized(correction(), 'reduce').reviewed, true);
});
test('unused reduction and partial return preserve original source allocations and reopen only noncash balance', async t => {
  const { pg, service } = await setup(t);
  const goodwill = (await service.issue(issuance({ amount: '100', creditType: 'goodwill', reference: '' }))).entry;
  const exchange = (await service.issue(issuance({ amount: '400' }))).entry;
  const applied = (await service.apply(usage())).entry;
  await assert.rejects(service.reduce(correction({ sourceEntryId: goodwill.id, amount: '1' })), { code: 'CREDIT_CORRECTION_CAP' });
  await assert.rejects(service.reduce(correction({ sourceEntryId: exchange.id, amount: '351' })), { code: 'CREDIT_CORRECTION_CAP' });
  const reduce = correction({ sourceEntryId: exchange.id, amount: '300' });
  await service.reduce(reduce); assert.equal((await service.reduce(reduce)).status, 'idempotent_replay');
  await assert.rejects(service.reduce({ ...reduce, amount: '299' }), { code: 'CREDIT_RETRY_MISMATCH' });
  assert.equal((await service.getClientModel({ adminId: 1, clientId: 101 })).balance, 50);
  const undo = correction({ sourceEntryId: applied.id, amount: '120' });
  await service.undo(undo); assert.equal((await service.undo(undo)).status, 'idempotent_replay');
  await assert.rejects(service.undo({ ...undo, adminId: 1 }), { code: 'CREDIT_RETRY_MISMATCH' });
  let model = await service.getClientModel({ adminId: 1, clientId: 101 });
  assert.equal(model.balance, 170); assert.equal(Number(model.entries.find(e => e.id === applied.id).correctable_amount), 30);
  await assert.rejects(service.undo(correction({ sourceEntryId: applied.id, amount: '31' })), { code: 'CREDIT_CORRECTION_CAP' });
  await service.undo(correction({ adminId: 1, sourceEntryId: applied.id, amount: '30' }));
  const remaining = await service.apply(usage({ amount: '200' })); assert.equal(remaining.outstanding, 450); assert.equal(remaining.balance, 0);
  const original = (await pg.query('SELECT * FROM treatment_credit_entries WHERE id=$1', [exchange.id])).rows[0];
  assert.equal(original.signed_amount, '400.00'); assert.equal(original.reason, 'Synthetic supplier work'); assert.equal(original.reference, 'SYNTHETIC-INVOICE-101');
  const credits = (await pg.query(CREDITS_SQL, ['2000-01-01', '2100-01-01'])).rows;
  const returned = credits.filter(e => e.entry_type === 'undo');
  assert.equal(returned.reduce((sum, e) => sum + Number(e.amount), 0), 150);
  assert.equal(Number(credits.find(e => e.entry_type === 'reduce').amount), -300);
  assert.equal(credits.find(e => e.entry_type === 'reduce').source_reason, 'Synthetic supplier work');
  assert.equal(credits.filter(e => e.entry_type === 'apply').reduce((sum, e) => sum + Number(e.amount), 0), -350);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM crm_audit_events')).rows[0].n, 7);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n, 0);
  const finance = { ...summarizeFinancials({ period: resolvePeriod({ preset: 'today', now: new Date('2026-10-08T12:00Z') }), treatments: [{ id: 201, starts_at: '2026-10-08T08:00Z', value: '650' }], balances: [{ appointment_id: 201, amount_due: '650', net_paid: '0', credits: '200', starts_at: '2026-10-08T08:00Z' }] }), treatmentCredits: credits, period: resolvePeriod({ preset: 'today', now: new Date('2026-10-08T12:00Z') }) };
  assert.equal(finance.current.received, 0); assert.equal(finance.current.treatmentValue, 650); assert.equal(finance.outstanding, 450);
  assert.match(financialCsv(finance), /Correction target entry/); assert.match(financialCsv(finance), /Synthetic reviewed correction/);
});
test('both approved staff authorities need explicit correction permission, including retries and archived clients', async t => {
  const { pg, service } = await setup(t);
  const source = (await service.issue(issuance())).entry;
  const input = correction({ sourceEntryId: source.id });
  await assert.rejects(service.reduce({ ...input, adminId: 3 }), { code: 'CREDIT_FORBIDDEN' });
  await service.reduce(input);
  await pg.query("UPDATE staff_admin_accounts SET permissions=permissions-'treatment_credit:correct' WHERE id=2");
  await assert.rejects(service.reduce(input), { code: 'CREDIT_FORBIDDEN' });
  assert.equal((await service.getClientModel({ adminId: 2, clientId: 101 })).authority.canCorrect, false);
  await assert.rejects(service.reduce(correction({ clientId: 102, sourceEntryId: source.id, adminId: 1 })), { code: 'CREDIT_CORRECTION_TARGET' });
  await assert.rejects(service.undo(correction({ sourceEntryId: source.id, adminId: 1 })), { code: 'CREDIT_CORRECTION_TARGET' });
  await pg.query("UPDATE crm_v2_clients SET status='archived' WHERE id=101");
  const archived = await service.getClientModel({ adminId: 1, clientId: 101 }); assert.equal(archived.authority.canCorrect, true); assert.equal(archived.authority.canIssue, false);
  await service.reduce(correction({ sourceEntryId: source.id, adminId: 1 }));
});
test('cancellation and refunds do not restore credit; explicit reviewed return preserves money and rejects active links', async t => {
  const { pg, service } = await setup(t); await service.issue(issuance());
  const applied = (await service.apply(usage())).entry;
  await pg.query("UPDATE appointments SET status='cancelled' WHERE id=201");
  await pg.query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES($1,'payment',200),($1,'refund',200)", [applied.booking_payment_account_id]);
  assert.equal((await service.getClientModel({ adminId: 2, clientId: 101 })).balance, 350);
  await pg.query("INSERT INTO payment_requests(payment_account_id,state) VALUES($1,'pending')", [applied.booking_payment_account_id]);
  await assert.rejects(service.undo(correction({ sourceEntryId: applied.id, amount: '100' })), { code: 'CREDIT_OPEN_PAYMENT' });
  await pg.query("UPDATE payment_requests SET state='cancelled'");
  await service.undo(correction({ sourceEntryId: applied.id, amount: '100' }));
  assert.equal((await service.getClientModel({ adminId: 2, clientId: 101 })).balance, 450);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n, 2);
  assert.equal(Number((await pg.query("SELECT COALESCE(-SUM(signed_amount),0) AS amount FROM treatment_credit_entries WHERE booking_payment_account_id=$1 AND entry_type IN ('apply','undo')", [applied.booking_payment_account_id])).rows[0].amount), 50);
  await assert.rejects(service.apply(usage({ amount: '50' })), { code: 'CREDIT_TREATMENT_INCOMPLETE' });
});
test('linked completed treatment return reopens its original group account and keeps deposit state', async t => {
  const { pg, service } = await setup(t);
  await pg.exec("INSERT INTO appointment_groups VALUES(50,'completed',1300,1300,NOW()); INSERT INTO appointment_group_members VALUES(50,201),(50,202)");
  await service.issue(issuance()); const applied = (await service.apply(usage())).entry;
  const account = (await pg.query('SELECT * FROM booking_payment_accounts WHERE id=$1', [applied.booking_payment_account_id])).rows[0]; assert.equal(account.appointment_group_id, 50);
  await pg.query("INSERT INTO booking_deposit_requirements(payment_account_id,state) VALUES($1,'satisfied')", [account.id]);
  await service.undo(correction({ sourceEntryId: applied.id, amount: '50' }));
  const used = await service.apply(usage({ appointmentId: 202, amount: '100' })); assert.equal(used.outstanding, 1100);
  assert.equal((await pg.query('SELECT state FROM booking_deposit_requirements')).rows[0].state, 'satisfied');
});
test('deferred SQL constraints reject source reduction beyond unused and fabricated/oversized return allocations', async t => {
  const { pg, service } = await setup(t);
  const first = (await service.issue(issuance({ amount: '100' }))).entry;
  const second = (await service.issue(issuance({ amount: '500' }))).entry;
  const applied = (await service.apply(usage({ amount: '80' }))).entry;
  async function rawCorrection(kind, source, amount, allocationSource) {
    await pg.query('BEGIN');
    try {
      const entry = (await pg.query(`INSERT INTO treatment_credit_entries(wallet_id,entry_type,signed_amount,reason,operation_id,request_fingerprint,actor_admin_id,source_entry_id,booking_payment_account_id,appointment_id)
        VALUES($1,$2,$3,'Synthetic invalid constraint proof',$4,$5,1,$6,$7,$8) RETURNING id`,
      [first.wallet_id,kind,kind === 'undo' ? amount : `-${amount}`,randomUUID(),'a'.repeat(64),source,kind === 'undo' ? applied.booking_payment_account_id : null,kind === 'undo' ? 201 : null])).rows[0];
      await pg.query('INSERT INTO treatment_credit_allocations VALUES($1,$2,$3)', [entry.id,allocationSource,amount]);
      await pg.query('COMMIT');
    } catch (error) { await pg.query('ROLLBACK'); throw error; }
  }
  await assert.rejects(rawCorrection('reduce', first.id, '30', first.id), /Invalid treatment credit/);
  await assert.rejects(rawCorrection('undo', applied.id, '81', first.id), /Invalid treatment credit/);
  await assert.rejects(rawCorrection('undo', applied.id, '1', second.id), /Invalid treatment credit/);
  assert.equal((await service.getClientModel({ adminId: 1, clientId: 101 })).balance, 520);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM treatment_credit_entries')).rows[0].n, 3);
});
