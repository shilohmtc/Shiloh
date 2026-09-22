'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createGiftVoucherService,
  walkInPaymentMethod,
} = require('../src/services/giftVouchers');
const { renderWorkspaceVoucherPage } = require('../src/presentation/giftVoucherUx');

const root = path.join(__dirname, '..');

function principal() {
  return {
    id: 14,
    staff_id: null,
    display_name: 'Christel',
    role: 'manager',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'voucher:view': true, 'voucher:issue': true, 'voucher:redeem': true, 'voucher:manage': true },
    admin_active: true,
    staff_status: null,
  };
}

function walkInDatabase() {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('calendarAuthorization:principal')) return { rows: [principal()] };
      if (sql.includes('FROM gift_voucher_payment_entries payment')) return { rows: [] };
      if (sql.includes('FROM gift_voucher_settings')) return { rows: [{ validity_mode: 'fixed_months', validity_months: 2 }] };
      if (sql.includes('INSERT INTO gift_voucher_orders')) return { rows: [{ id: 501, recipient_name: params[1], delivery_mobile: params[6], amount: params[7] }] };
      if (sql.includes('INSERT INTO gift_vouchers')) return { rows: [{ id: 601, voucher_code: params[1], original_value: params[2], balance: params[2], state: 'active', valid_until: '2026-11-22', access_key: params[5] }] };
      if (sql.includes('INSERT INTO gift_voucher_payment_entries')) return { rows: [] };
      if (sql.includes('INSERT INTO gift_voucher_ledger_entries')) return { rows: [] };
      if (sql.includes('INSERT INTO crm_audit_events')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); },
  };
  return { calls, db: { async connect() { return client; }, async query(sql, params) { return client.query(sql, params); } } };
}

test('walk-in voucher migration extends the canonical ledger for preprinted stock', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '146_walk_in_preprinted_gift_vouchers.sql'), 'utf8');
  assert.match(sql, /order_source IN \('online','walk_in'\)/);
  assert.match(sql, /gift_voucher_payment_entries/);
  assert.match(sql, /authorized_manual/);
  assert.match(sql, /voucher:issue/);
  assert.match(sql, /stock_reference/);
  assert.match(sql, /access_key/);
  assert.doesNotMatch(sql, /UPDATE appointments|INSERT INTO appointments/);
});

test('voucher mobile migration converts historical delivery numbers to local 0-format only', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '147_gift_voucher_local_mobile_format.sql'), 'utf8');
  assert.match(sql, /delivery_mobile = '0' \|\| SUBSTRING\(delivery_mobile FROM 3\)/);
  assert.match(sql, /\^27\[678\]/);
  assert.match(sql, /canonical CRM\/WhatsApp identity remains authoritative/i);
  assert.doesNotMatch(sql, /UPDATE crm_v2_clients|UPDATE client_contacts/);
});

test('walk-in payment method is bounded to Shiloh in-person evidence types', () => {
  assert.equal(walkInPaymentMethod('cash'), 'cash');
  assert.equal(walkInPaymentMethod('card_machine'), 'card_machine');
  assert.equal(walkInPaymentMethod('manual_eft'), 'manual_eft');
  assert.throws(() => walkInPaymentMethod('ozow'), /Choose cash, card machine or EFT/);
});

test('walk-in voucher stores recipient mobile in local 0-format before later identity linking', async () => {
  const fake = walkInDatabase();
  const service = createGiftVoucherService({ db: fake.db, randomBytes: () => Buffer.alloc(24, 8) });
  await service.createWalkInVoucher({
    adminId: 14,
    purchaserName: 'Tinkie',
    recipientName: 'Evelyn',
    fromName: 'Tinkie',
    language: 'en',
    amount: '900',
    paymentMethod: 'cash',
    deliveryMobile: '+27 82 123 4567',
    paymentConfirmed: true,
    operationId: 'walkin-local-mobile-001',
  });
  const insert = fake.calls.find((call) => call.sql.includes('INSERT INTO gift_voucher_orders'));
  assert.ok(insert);
  assert.equal(insert.params[6], '0821234567');
});

test('authorised walk-in issuance writes payment, value and audit evidence atomically', async () => {
  const fake = walkInDatabase();
  const service = createGiftVoucherService({ db: fake.db, randomBytes: () => Buffer.alloc(24, 7) });
  const result = await service.createWalkInVoucher({
    adminId: 14,
    purchaserName: 'Tinkie',
    recipientName: 'Evelyn',
    fromName: 'Tinkie',
    personalMessage: 'With love',
    language: 'en',
    amount: '900',
    paymentMethod: 'card_machine',
    paymentReference: 'Yoco 1234',
    stockReference: 'BOOK-0042',
    deliveryMobile: '',
    paymentConfirmed: true,
    operationId: 'walkin-test-001',
  });

  assert.equal(result.status, 'issued');
  assert.match(result.voucher.voucher_code, /^SV-[A-F0-9]{12}$/);
  assert.match(result.voucherPath, /^\/gift-vouchers\/[A-Za-z0-9_-]{32}$/);
  const sql = fake.calls.map((call) => call.sql).join('\n');
  assert.match(sql, /INSERT INTO gift_voucher_orders/);
  assert.match(sql, /INSERT INTO gift_vouchers/);
  assert.match(sql, /INSERT INTO gift_voucher_payment_entries/);
  assert.match(sql, /INSERT INTO gift_voucher_ledger_entries/);
  assert.match(sql, /gift_voucher\.walk_in_issued/);
  assert.ok(fake.calls.find((call) => call.sql === 'COMMIT'));
  assert.equal(result.whatsappDelivery.reason, 'not_requested');
});

test('walk-in issuance refuses to create value without explicit payment confirmation', async () => {
  const fake = walkInDatabase();
  const service = createGiftVoucherService({ db: fake.db });
  await assert.rejects(
    service.createWalkInVoucher({ adminId: 14, purchaserName: 'Tinkie', recipientName: 'Evelyn', fromName: 'Tinkie', language: 'en', amount: '900', paymentMethod: 'cash', paymentConfirmed: false, operationId: 'walkin-test-002' }),
    /Confirm that the in-person payment was received/,
  );
  assert.equal(fake.calls.length, 0);
});

test('Workspace presents preprinted capture only to voucher issuers', () => {
  const model = {
    policy: { configured: true, mode: 'fixed_months', months: 2 },
    authority: { canIssue: true, canRedeem: true, canManage: true },
    vouchers: [{ voucher_code:'SV-ABCDEF123456', recipient_name:'Evelyn', original_value:'900.00', balance:'900.00', valid_until:'2026-11-22', state:'active', order_source:'walk_in', payment_method:'card_machine', stock_reference:'BOOK-0042' }],
  };
  const html = renderWorkspaceVoucherPage({ model, csrfToken: 'csrf', displayName: 'Christel' });
  assert.match(html, /Issue a walk-in voucher/);
  assert.match(html, /physical voucher is already printed/i);
  assert.match(html, /Preprinted stock reference/);
  assert.match(html, /received the full in-person payment/);
  assert.match(html, /Walk-in · Card · Stock BOOK-0042/);
  assert.match(html, /data-walk-in-result hidden/);

  const denied = renderWorkspaceVoucherPage({ model: { ...model, authority: { canIssue:false, canRedeem:true, canManage:false } }, csrfToken:'csrf' });
  assert.doesNotMatch(denied, /Issue a walk-in voucher/);
});

test('Workspace client posts the idempotent walk-in operation and preserves the issued code', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'workspace', 'gift-vouchers.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src', 'routes', 'workspaceGiftVouchers.js'), 'utf8');
  assert.match(script, /\/calendar\/vouchers\/walk-in/);
  assert.match(script, /paymentConfirmed:data\.paymentConfirmed === 'true'/);
  assert.match(script, /this\.dataset\.operationId \|\| crypto\.randomUUID\(\)/);
  assert.match(script, /this\.dataset\.operationId = operationId/);
  assert.match(script, /delete this\.dataset\.operationId/);
  assert.match(script, /data-issued-code/);
  assert.match(route, /router\.post\('\/walk-in',sameOrigin,requireSession,requireCsrf/);
});
