const test = require('node:test');
const assert = require('node:assert/strict');
const { createShilohRewardsService } = require('../src/services/shilohRewards');
const { createGiftVoucherService } = require('../src/services/giftVouchers');
const { createWorkspaceClientsService } = require('../src/services/workspaceClients');

const principal = { id: 7, admin_active: true, calendar_scope: 'all_business', service_scope: 'all_services', permissions: { 'client:lookup': true, 'loyalty:view': true, 'voucher:view': true } };
function database(read, actor = principal) {
  return { calls: [], async query(sql, args) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|BEGIN)\b/i);
    this.calls.push({ sql, args });
    if (sql.includes(':principal')) return { rows: [actor] };
    return { rows: read(sql, args) };
  } };
}

test('profile rewards reads recorded wallet totals without creating or synchronising records', async () => {
  const db = database((sql, args) => {
    if (sql.includes('FROM loyalty_wallets')) { assert.deepEqual(args, [912]); return [{ id: 31 }]; }
    if (sql.includes('FROM loyalty_program_settings')) return [{ earn_basis_points: 500, unlock_threshold: '100' }];
    assert.deepEqual(args, [31]);
    return sql.includes('SUM(') ? [{ balance: '120', credited: '140', used: '20' }] : [{ entry_type: 'earn', signed_amount: '140' }];
  });
  const model = await createShilohRewardsService({ db }).getWorkspaceClientModel({ adminId: 7, clientId: 912 });
  assert.equal(model.wallet.balance, 120);
  assert.equal(model.wallet.unlocked, true);
  assert.equal(model.entries.length, 1);
});

test('profile voucher lookup uses exact recorded purchaser and recipient identities, without phone matching or bearer keys', async () => {
  const db = database((sql, args) => {
    assert.deepEqual(args, [912]);
    assert.match(sql, /WHERE v.recipient_crm_v2_client_id=\$1 OR o.purchaser_crm_v2_client_id=\$1/);
    assert.doesNotMatch(sql, /mobile|access_key|recipient_name/);
    return [{ id: 1, recipient_crm_v2_client_id: 912, purchaser_crm_v2_client_id: 800, valid_until: '2000-01-01' },
      { id: 2, recipient_crm_v2_client_id: null, purchaser_crm_v2_client_id: 912 },
      { id: 3, recipient_crm_v2_client_id: 912, purchaser_crm_v2_client_id: 912 }];
  });
  const model = await createGiftVoucherService({ db }).getWorkspaceClientModel({ adminId: 7, clientId: 912 });
  assert.deepEqual(model.received.map(row => row.id), [1, 3]);
  assert.equal(model.received[0].expired, true);
  assert.equal(model.received[1].expired, false);
  assert.deepEqual(model.purchased.map(row => row.id), [2, 3]);
});

for (const create of [createGiftVoucherService, createShilohRewardsService]) {
  test(`${create.name} denies financial reads without the existing view capability`, async () => {
    const db = database(() => { throw new Error('Unauthorized financial query'); }, { ...principal, permissions: { 'client:lookup': true } });
    await assert.rejects(create({ db }).getWorkspaceClientModel({ adminId: 7, clientId: 912 }), { httpStatus: 403 });
    assert.equal(db.calls.length, 1);
  });
}

test('client relationship is checked before any financial reads; tenant profiles do not reveal clinic ledgers', async () => {
  let financialReads = 0;
  const reader = { getWorkspaceClientModel: async () => { financialReads++; return {}; } };
  const client = { id: 912, status: 'active' };
  const db = database(sql => sql.includes(':revision') ? [client] : [], { ...principal, business_role: 'tenant_practitioner', staff_id: 5, staff_status: 'active' });
  const readService = { getClient: async () => null, getClientAppointments: async () => [] };
  const service = createWorkspaceClientsService({ db, readService, rewardsService: reader, voucherService: reader,
    communicationService: { listForClient: async () => [] }, policyAcceptanceService: { listClientAcceptanceHistory: async () => [], readinessForAppointments: async () => new Map() }, submissionService: { listClientHistory: async () => ({ items: [] }) } });
  await assert.rejects(service.getClientDetail({ adminId: 7, clientId: 912 }), { httpStatus: 404 });
  readService.getClient = async () => client;
  const model = await service.getClientDetail({ adminId: 7, clientId: 912 });
  assert.equal(financialReads, 0);
  assert.equal(model.rewards.restricted, true);
  assert.equal(model.vouchers.restricted, true);
});
