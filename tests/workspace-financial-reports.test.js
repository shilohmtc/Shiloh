const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { resolvePeriod } = require('../src/services/workspaceReports');
const { summarizeFinancials, createWorkspaceFinancialReportsService } = require('../src/services/workspaceFinancialReports');
const { financialOverview, financialContext, financialSections, financialCsv } = require('../src/presentation/workspaceFinancialReportsUx');
const { createWorkspaceReportsRouter } = require('../src/routes/workspaceReports');

const now = new Date('2026-10-05T16:00:00Z');
const period = resolvePeriod({ preset: 'week', now });
const treatment = (id, date, value) => ({ id, starts_at: date, value, treatment: 'Massage' });
const payment = (id, date, amount, overrides = {}) => ({ id, created_at: date, amount, entry_type: 'payment', method: 'cash', appointment_id: 1, ...overrides });
function example() {
  return { ...summarizeFinancials({ period,
    treatments: [treatment(1, '2026-10-05T10:00:00Z', '590'), treatment(2, '2026-10-05T12:00:00Z', null), treatment(3, '2026-09-28T10:00:00Z', '450')],
    receipts: [payment(1, '2026-10-05T08:00:00Z', '300'), payment(2, '2026-10-05T09:00:00Z', '25', { entry_type: 'refund' }), payment(3, '2026-09-28T08:00:00Z', '200')],
    balances: [{ appointment_id: 1, starts_at: '2026-10-05T10:00:00Z', amount_due: '590', net_paid: '275', credits: '100' }],
  }), period };
}

test('Today and calendar week/month use South African midnight and comparable elapsed periods', () => {
  const today = resolvePeriod({ now: new Date('2026-10-04T22:30:00Z') });
  assert.equal(today.startKey, '2026-10-05');
  assert.equal(today.from, '2026-10-04T22:00:00.000Z');
  assert.equal(today.dayCount, 1);
  assert.equal(period.startKey, '2026-10-05');
  assert.equal(period.previousStartKey, '2026-09-28');
  assert.equal(period.previousEndKey, '2026-09-29');
  const sunday = resolvePeriod({ preset: 'week', now: new Date('2026-10-11T10:00:00Z') });
  assert.equal(sunday.dayCount, 7);
  assert.equal(sunday.startKey, '2026-10-05');
  const march = resolvePeriod({ preset: 'month', now: new Date('2026-03-31T10:00:00Z') });
  assert.equal(march.previousStartKey, '2026-02-01');
  assert.equal(march.previousEndKey, '2026-03-01');
  assert.equal(resolvePeriod({ preset: 'month', now }).previousEndKey, '2026-09-06');
  assert.throws(() => resolvePeriod({ from: '2026-09-01', to: '2026-10-05', now }), { httpStatus: 400 });
});

test('treatment value, payments, refunds and credits stay separate, with missing prices explicit', () => {
  const model = example();
  assert.equal(model.current.treatmentValue, 590);
  assert.equal(model.current.received, 300);
  assert.equal(model.current.refunded, 25);
  assert.equal(model.current.netReceived, 275);
  assert.equal(model.current.unpricedCount, 1);
  assert.equal(model.outstanding, 215);
  assert.equal(model.comparison.delta, 140);
  assert.equal(model.comparison.incomplete, true);
  assert.equal(model.methods.find(row => row.key === 'cash').netReceived, 275);
  assert.equal(model.days[0].treatmentValue, 590);
});

test('receipt date includes future-booking deposits but never infers payment from a completed visit', () => {
  const report = summarizeFinancials({ period,
    treatments: [treatment(1, '2026-10-05T10:00:00Z', '590')],
    receipts: [payment(1, '2026-10-04T21:59:59Z', '100'), payment(2, period.from, '0.10', { appointment_id: 99 }), payment(3, period.to, '200')],
  });
  assert.equal(report.current.received, 0.1);
  assert.equal(report.receipts[0].appointmentId, 99);
  assert.equal(report.current.treatmentValue, 590);
  assert.equal(report.current.netReceived, 0.1);
  assert.equal(report.outstanding, 0);
  const refundOnly = summarizeFinancials({ period, receipts: [payment(1, period.from, '5', { entry_type: 'refund' })] });
  assert.equal(refundOnly.current.netReceived, -5);
  assert.equal(refundOnly.comparison.percent, null);
});

test('linked-booking balance counted once, refund increases debt, credits reduce it, unresolved prices excluded', () => {
  const report = summarizeFinancials({ period, balances: [
    { appointment_id: 1, group_id: 10, starts_at: period.from, amount_due: '1000', net_paid: '400', credits: '100', mixed_status: true },
    { appointment_id: 2, starts_at: period.from, amount_due: null, net_paid: '0', credits: '0' },
    { appointment_id: 3, starts_at: period.from, amount_due: '500', net_paid: '600', credits: '0' },
  ] });
  assert.equal(report.outstanding, 500);
  assert.equal(report.unpaid.length, 1);
  assert.equal(report.unpaid[0].mixedStatus, true);
  assert.equal(report.balanceReviewCount, 1);
});

test('both authorized principals get the same finance data; revoked or scoped access fails before financial reads', async () => {
  for (const adminId of [2, 4]) {
    const seen = [];
    const service = createWorkspaceFinancialReportsService({ db: { async query(sql, params) {
      seen.push({ sql, params });
      if (sql.includes('StaffEarnings:owner')) return { rows: [{ active: true, business_role: adminId === 2 ? 'owner' : 'business_admin', calendar_scope: 'all_business', permissions: { 'staff_earnings:manage': true, 'appointment:view': true } }] };
      if (sql.includes('FinancialReports:payment_access')) return { rows: [{ allowed: true }] };
      return { rows: [] };
    } } });
    const result = await service.build({ adminId, period, now });
    assert.equal(result.scope, 'all_business');
    assert.equal(seen.filter(row => /FinancialReports:(treatments|receipts|balances)/.test(row.sql)).length, 3);
    assert.equal(result.current.received, 0);
    assert.equal(seen[1].params[0], adminId);
    assert.match(seen[1].sql, /service_scope='all_services'/);
  }
  for (const denial of ['earnings', 'payments']) {
    const seen = [];
    const service = createWorkspaceFinancialReportsService({ db: { async query(sql) {
      seen.push(sql);
      return { rows: [{ allowed: false }] };
    } }, earningsService: { async requireOwner() {
      if (denial === 'earnings') throw Object.assign(new Error('Denied'), { httpStatus: 403 });
    } } });
    await assert.rejects(service.build({ adminId: 51, period, now }), { httpStatus: 403 });
    assert.ok(seen.every(sql => sql.includes('payment_access')));
  }
});

test('financial markup escapes source labels, links to existing payment authority, and exports safe CSV', () => {
  const finance = example();
  finance.treatments[0].treatment = '=HYPERLINK("bad")';
  finance.services[0].name = '<script>bad</script>';
  const overview = financialOverview({ financial: finance, period, staffEarnings: { staff: [{ commission: 118, reviewCount: 0 }] } });
  assert.match(financialContext(finance), /Expenses and saved cash-up closes are not recorded/);
  assert.match(financialContext(finance), /Payment of commission is not tracked/);
  assert.equal((overview.match(/class="financial-card jump-link"/g) || []).length, 3);
  assert.match(overview, /Refunds R25,00 · net R275,00/);
  assert.match(overview, /Missing amounts are excluded from totals/);
  assert.match(overview, /Whole clinic/);
  assert.doesNotMatch(overview, /Calculated commission|Saved cash-up days|Recorded expenses/);
  assert.match(financialSections(finance), /\/calendar\/payments\/appointments\/1/);
  assert.doesNotMatch(financialSections(finance), /<script>bad/);
  assert.match(financialCsv(finance), /"'=HYPERLINK/);
  assert.equal(financialOverview({}), '');
});

test('financial export requires a signed-in session and rechecks finance access with private headers', async () => {
  let allowed = true;
  const app = express();
  app.use('/calendar/reports', createWorkspaceReportsRouter({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' },
    sessionService: { async validateSessionToken(token) { return token === 'proof' ? { ok: true, adminId: 2 } : { ok: false }; } },
    service: {}, financialService: { async requireAccess() { if (!allowed) throw Object.assign(new Error('Denied'), { httpStatus: 403 }); }, async build() { return example(); } },
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/calendar/reports/financial.csv?from=2026-10-05&to=2026-10-05`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Cookie: 'shiloh_staff_session=proof' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.match(response.headers.get('content-disposition'), /shiloh-finances-2026-10-05-2026-10-05.csv/);
    assert.match(await response.text(), /Shiloh financial report/);
    allowed = false;
    assert.equal((await fetch(url, { headers: { Cookie: 'shiloh_staff_session=proof' } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
