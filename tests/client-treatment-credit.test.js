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
  }, service: { async issue(input) { assert.equal(input.adminId, 2); writes++; return { status: 'issued' }; }, async apply() { throw new TreatmentCreditError('CREDIT_FORBIDDEN', 'Denied', 403); } } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, headers = { Cookie: 'shiloh_staff_session=test', Origin: origin, 'Content-Type': 'application/json', 'X-Shiloh-CSRF-Token': 'valid' };
  const post = (custom, action = 'issue') => fetch(`${origin}/calendar/treatment-credit/${action}`, { method: 'POST', headers: custom, body: JSON.stringify({ adminId: 1 }) });
  assert.equal((await post({ ...headers, Cookie: '' })).status, 401);
  assert.equal((await post({ ...headers, Origin: 'https://other.test' })).status, 403);
  assert.equal((await post({ ...headers, 'X-Shiloh-CSRF-Token': 'wrong' })).status, 403);
  assert.equal(writes, 0);
  const response = await post(headers); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await post(headers, 'apply')).status, 403); assert.equal(writes, 1);
});
test('credit surface escapes private evidence and renders read-only authority without actions', () => {
  const html = renderTreatmentCreditPage({ model: { client: { id: 101, name: '<script>bad</script>' }, balance: 1, entries: [], appointments: [], authority: {} } });
  assert.doesNotMatch(html, /<script>bad/); assert.doesNotMatch(html, /data-credit-form/); assert.match(html, /Remaining treatment credit/);
  new (require('node:vm').Script)(treatmentCreditClientScript());
});
