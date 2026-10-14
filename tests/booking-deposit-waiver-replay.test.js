'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createBookingDepositWaiverActions } = require('../src/services/bookingDepositWaiver');
const { CALENDAR_CAPABILITIES } = require('../src/services/calendarAuthorization');

function fixture({ accountId = 80, groupId = 70, memberIds = [10, 11], requirementId = 90, state = 'waived', revision = '2026-10-15T08:00:00.000Z', requiredAmount = '250.00' } = {}) {
  const input = { adminId: 2, appointmentId: 10, requirementId: 90, operationId: 'synthetic-waiver-retry', expectedRevision: '2026-10-15T08:00:00.000Z', reason: 'Agreed deposit exception', confirmed: true };
  const fingerprint = createHash('sha256').update(JSON.stringify({ adminId: input.adminId, appointmentId: input.appointmentId, requirementId: input.requirementId, operationId: input.operationId, expectedRevision: input.expectedRevision, reason: input.reason })).digest('hex');
  const originalTime = '2026-10-14T10:00:00.000Z';
  const calls = [];
  const client = { release() {}, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('SELECT id,source FROM appointment_groups')) return { rows: [{ id: groupId, source: 'workspace' }] };
    if (sql.includes('SELECT clock_timestamp()')) return {rows:[{now:'2026-10-14T10:00Z'}]};
    if (sql.includes('depositWaiver:members')) return { rows: memberIds.map(id => ({ id, status:'confirmed',starts_at:'2099-10-15T08:00Z',source:'workspace',approval:'approved',staff_ids: [5], service_ids: [6] })) };
    if (sql.includes('SELECT * FROM booking_payment_accounts')) return { rows: [{ id: accountId }] };
    if (sql.includes('SELECT id,created_at,metadata FROM crm_audit_events')) return { rows: [{ id: 100, created_at: originalTime, metadata: { fingerprint, result: { paymentAccountId: 80, groupId: 70, appointmentIds: [10, 11], requirementId: 90, state: 'waived', originalRequiredAmount: '250.00', reason: input.reason, actorAdminId: 2 } } }] };
    if (sql.includes('SELECT * FROM booking_deposit_requirements')) return { rows: [{ id: requirementId, state, required_amount: requiredAmount }] };
    return { rows: [], rowCount: 0 };
  } };
  class Failure extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  const actions = createBookingDepositWaiverActions({
    db: { connect: async () => client }, ErrorType: Failure, positiveId: Number, requestKey: String,
    resolveOperator: async () => ({ id: 2, role: 'owner', business_role: 'owner', staff_id: null, calendarAuthority: { calendarScope: 'all_business', serviceScope: 'all_services', capabilities: [...Object.values(CALENDAR_CAPABILITIES), 'payment:view', 'payment:collect'] } }),
    loadSubject: async () => ({ appointmentId: 10, groupId, pricingRevision: revision }),
  });
  return { actions, input, calls, originalTime };
}

test('unchanged shared-deposit retry returns the original audit and time without any financial or audit writes', async () => {
  const f = fixture({ memberIds: [11, 10] });
  const result = await f.actions.record(f.input);
  assert.equal(result.status, 'idempotent_replay');
  assert.equal(result.auditId, 100);
  assert.equal(result.waivedAt, f.originalTime);
  assert.deepEqual(result.appointmentIds, [10, 11]);
  assert.equal(f.calls.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)), false);
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
});

for (const [name, change] of [
  ['payment account replaced', { accountId: 81 }],
  ['shared group replaced', { groupId: 71 }],
  ['authorized member added', { memberIds: [10, 11, 12] }],
  ['authorized member removed', { memberIds: [10] }],
  ['authorized member replaced', { memberIds: [10, 12] }],
  ['requirement replaced', { requirementId: 91 }],
  ['requirement no longer waived', { state: 'awaiting' }],
  ['appointment pricing revision changed', { revision: '2026-10-16T08:00:00.000Z' }],
  ['original requirement amount changed', { requiredAmount: '300.00' }],
]) test(`exact retry rejects changed current scope: ${name}`, async () => {
  const f = fixture(change);
  await assert.rejects(f.actions.record(f.input), { code: 'DEPOSIT_WAIVER_REPLAY_SCOPE_CHANGED' });
  assert.equal(f.calls.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)), false);
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
});
