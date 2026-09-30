const test = require('node:test');
const assert = require('node:assert/strict');
const { clinicDate, hasEarningsAccess, summarize, selectRule, createWorkspaceStaffEarningsService } = require('../src/services/workspaceStaffEarnings');
const { renderReportsPage, staffEarningsSection } = require('../src/presentation/workspaceReportsUx');

const owner = { active: true, business_role: 'owner', display_name: 'Christel', staff_name: 'Christel', staff_status: 'active', calendar_scope: 'all_business', staff_id: 2, permissions: { 'appointment:view': true, 'staff_earnings:manage': true } };
const rules = [
  { staff_id: 11, service_id: null, effective_from: '1970-01-01', rate_percent: 20 },
  { staff_id: 11, service_id: 22, effective_from: '2026-10-01', rate_percent: 30 },
];
const visit = (id, overrides = {}) => ({ id, staff_id: 11, starts_at: '2026-10-05T08:00:00Z', total_price: '590.00', staff_count: 1, service_ids: [22], service_names: ['Massage'], ...overrides });

test('earnings require explicit capability and active business-wide authority, not a person name', () => {
  assert.equal(hasEarningsAccess([owner]), true);
  assert.equal(hasEarningsAccess([{ ...owner, business_role: 'business_admin', display_name: 'JP', staff_id: null, staff_status: null }]), true);
  for (const row of [{ ...owner, active: false }, { ...owner, business_role: 'booking_operator' }, { ...owner, calendar_scope: 'own_appointments' }, { ...owner, staff_status: 'inactive' }, { ...owner, permissions: { 'appointment:view': true } }]) assert.equal(hasEarningsAccess([row]), false);
  assert.equal(hasEarningsAccess([owner, owner]), false);
});

test('dated service rate takes priority and shared or unpriced appointments require review', () => {
  assert.equal(selectRule(rules, visit(1, { starts_at: '2026-09-30T08:00:00Z' })).rate_percent, 20);
  const rows = summarize([{ id: 11, display_name: 'Abigail' }], [
    visit(1), visit(2, { staff_count: 2 }), visit(3, { total_price: null }),
    visit(4, { service_ids: [55], total_price: '450.00' }),
  ], rules);
  assert.equal(rows[0].completedValue, 1040);
  assert.equal(rows[0].commission, 267);
  assert.equal(rows[0].reviewCount, 2);
  assert.equal(rows[0].appointments[1].commission, null);
  assert.equal(rows[0].appointments[2].commission, null);
});

test('a missing commission rule keeps priced solo treatment value visible without inventing commission', () => {
  const rows = summarize([{ id: 11, display_name: 'Therapist' }], [
    visit(1), visit(2, { staff_count: 2 }), visit(3, { total_price: null }),
  ], []);
  assert.equal(rows[0].completedValue, 590);
  assert.equal(rows[0].completedCount, 1);
  assert.equal(rows[0].commission, 0);
  assert.equal(rows[0].reviewCount, 3);
  assert.equal(rows[0].appointments[0].commission, null);
  assert.equal(rows[0].appointments[0].reason, 'Commission rule missing — review');
});

test('a completed treatment keeps an inactive practitioner in its historical report period', async () => {
  const period = { from: '2026-09-23T22:00:00Z', to: '2026-09-30T22:00:00Z' };
  const seen = [];
  const service = createWorkspaceStaffEarningsService({ db: { async query(sql, params) {
    seen.push({ sql, params });
    if (sql.includes('StaffEarnings:owner')) return { rows: [owner] };
    if (sql.includes('StaffEarnings:staff')) return { rows: [{ id: 11, display_name: 'Marietjie', status: 'inactive' }] };
    if (sql.includes('StaffEarnings:visits')) return { rows: [visit(1)] };
    return { rows: [] };
  } } });
  const result = await service.build({ adminId: 1, period, selectedStaffId: 11 });
  assert.equal(result.staff[0].completedValue, 590);
  assert.equal(result.staff[0].reviewCount, 1);
  assert.equal(result.staff[0].canAddRule, false);
  const html = staffEarningsSection({ ...result, earliestNewRuleDate: '2026-10-01' }, period);
  assert.match(html, /Marietjie/);
  assert.doesNotMatch(html, /<option value="11">Marietjie<\/option>/);
  const staffQuery = seen.find(entry => entry.sql.includes('StaffEarnings:staff'));
  assert.match(staffQuery.sql, /status='active' OR EXISTS/);
  assert.match(staffQuery.sql, /a\.status='completed'/);
  assert.deepEqual(staffQuery.params, [period.from, period.to]);
});

test('rule creation is capability gated, future dated and audited in one statement', async () => {
  const seen = [];
  const db = { async query(sql, params) {
    seen.push({ sql, params });
    if (sql.includes('StaffEarnings:owner')) return { rows: [owner] };
    if (sql.includes('StaffEarnings:add_rule')) return { rows: [{ id: 7 }] };
    throw new Error('Unexpected query');
  } };
  const service = createWorkspaceStaffEarningsService({ db });
  await assert.rejects(service.addRule({ adminId: 1, staffId: 11, effectiveFrom: '2020-01-01', ratePercent: '50' }), { httpStatus: 400 });
  await assert.rejects(service.addRule({ adminId: 1, staffId: 11, effectiveFrom: clinicDate(new Date()), ratePercent: '50' }), { httpStatus: 400 });
  assert.equal(seen.length, 2);
  assert.ok(seen.every(entry => entry.sql.includes('StaffEarnings:owner')));
  await service.addRule({ adminId: 1, staffId: 11, serviceId: 22, effectiveFrom: '2099-01-01', ratePercent: '17.50' });
  assert.match(seen.at(-1).sql, /crm_audit_events/);
  assert.deepEqual(seen.at(-1).params, [1, 11, 22, '2099-01-01', 17.5]);
});

test('another staff account cannot query earnings or create a commission rule', async () => {
  const seen = [];
  const service = createWorkspaceStaffEarningsService({ db: { async query(sql) {
    seen.push(sql);
    return { rows: [{ ...owner, business_role: 'business_admin', permissions: { 'appointment:view': true } }] };
  } } });
  const period = { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };
  await assert.rejects(service.build({ adminId: 4, period }), { httpStatus: 403 });
  await assert.rejects(service.addRule({ adminId: 4, staffId: 11, effectiveFrom: '2099-01-01', ratePercent: '50' }), { httpStatus: 403 });
  assert.equal(seen.length, 2);
  assert.ok(seen.every(sql => sql.includes('StaffEarnings:owner')));
});

test('granted owner and business admin both create future commission rules with their own audit identity', async () => {
  for (const [adminId, principal] of [[2, owner], [4, { ...owner, business_role: 'business_admin', display_name: 'JP', staff_id: null, staff_status: null }]]) {
    const seen = [];
    const service = createWorkspaceStaffEarningsService({ db: { async query(sql, params) {
      seen.push({ sql, params });
      if (sql.includes('StaffEarnings:owner')) return { rows: [principal] };
      if (sql.includes('StaffEarnings:add_rule')) return { rows: [{ id: 7 }] };
      throw new Error('Unexpected query');
    } } });
    await service.addRule({ adminId, staffId: 11, effectiveFrom: '2099-01-01', ratePercent: '20' });
    assert.match(seen[0].sql, /LEFT JOIN staff/);
    assert.equal(seen.at(-1).params[0], adminId);
    assert.match(seen.at(-1).sql, /crm_audit_events/);
  }
});

test('earnings are absent from ordinary report markup', () => {
  const model = { authority: { displayName: 'Reception', reportScope: 'all_business' }, period: { preset: '7d', startKey: '2026-09-01', endInclusiveKey: '2026-09-07', dayCount: 7 }, appointments: {}, totals: {}, clients: {}, capacity: [], services: [], trend: {} };
  const html = renderReportsPage(model);
  assert.doesNotMatch(html, /data-staff-earnings|data-commission-form|commission\.js/);
  assert.doesNotMatch(staffEarningsSection({ staff: [], rules: [], services: [] }, model.period), /Christel only/);
});
