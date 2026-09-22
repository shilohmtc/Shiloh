'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGiftVoucherService, GiftVoucherError } = require('../src/services/giftVouchers');

function recipientDatabase({ verified = true } = {}) {
  const calls = [];
  let linkedClientId = null;
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM crm_v2_clients') && sql.includes('mobile_verified_at')) {
        return { rows: [{
          id: 912,
          name: 'Evelyn Example',
          normalized_mobile: '27821234567',
          mobile_verified_at: verified ? '2026-09-22T18:00:00.000Z' : null,
        }] };
      }
      if (sql.includes('UPDATE gift_vouchers v') && sql.includes('recipient_crm_v2_client_id IS NULL')) {
        assert.deepEqual(params, [912, '0821234567']);
        linkedClientId = 912;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM gift_voucher_settings')) {
        return { rows: [{ validity_mode:'fixed_months', validity_months:2 }] };
      }
      if (sql.includes('WHERE o.purchaser_crm_v2_client_id=$1')) {
        return { rows: [] };
      }
      if (sql.includes('WHERE v.recipient_crm_v2_client_id=$1')) {
        return { rows: linkedClientId === 912 ? [{
          id: 601,
          voucher_code:'SV-ABCDEF123456',
          original_value:'900.00',
          balance:'900.00',
          voucher_state:'active',
          issued_at:'2026-09-22T18:00:00.000Z',
          valid_until:'2026-11-22',
          access_key:'recipient-access-key-123456789012',
          recipient_name:'Evelyn Example',
          from_name:'Tinkie',
          personal_message:'Enjoy',
          language:'en',
        }] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { db, calls, linkedClientId: () => linkedClientId };
}

test('verified My Shiloh identity claims matching unlinked recipient vouchers by mobile', async () => {
  const fake = recipientDatabase();
  const service = createGiftVoucherService({
    db: fake.db,
    ozow: { configured: () => true },
  });
  const model = await service.getClientModel({ crmV2ClientId: 912 });
  assert.equal(fake.linkedClientId(), 912);
  assert.equal(model.receivedVouchers.length, 1);
  assert.equal(model.receivedVouchers[0].voucher_code, 'SV-ABCDEF123456');
  assert.match(model.receivedVouchers[0].voucherPath, /^\/gift-vouchers\//);
  const link = fake.calls.find((call) => call.sql.includes('UPDATE gift_vouchers v'));
  assert.match(link.sql, /v\.recipient_crm_v2_client_id IS NULL/);
  assert.match(link.sql, /o\.recipient_mobile=\$2/);
  assert.match(link.sql, /o\.state='paid'/);
});

test('unverified client profile cannot claim a recipient voucher', async () => {
  const fake = recipientDatabase({ verified:false });
  const service = createGiftVoucherService({
    db: fake.db,
    ozow: { configured: () => true },
  });
  await assert.rejects(
    service.getClientModel({ crmV2ClientId: 912 }),
    (error) => error instanceof GiftVoucherError && /Verify your WhatsApp number/.test(error.message),
  );
  assert.equal(fake.linkedClientId(), null);
  assert.equal(fake.calls.some((call) => call.sql.includes('UPDATE gift_vouchers v')), false);
});

test('recipient linking never uses names as identity and never steals an existing link', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'giftVouchers.js'), 'utf8');
  assert.match(source, /o\.recipient_mobile=\$2/);
  assert.match(source, /v\.recipient_crm_v2_client_id IS NULL/);
  assert.doesNotMatch(source, /recipient_name\s*=\s*\$2/);
});


test('online voucher keeps recipient identity separate when the purchaser receives the secure link', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id,name,normalized_mobile FROM crm_v2_clients')) {
        return { rows:[{ id:44, name:'Tinkie Buyer', normalized_mobile:'27831234567' }] };
      }
      if (sql.includes('FROM gift_voucher_settings')) {
        return { rows:[{ validity_mode:'fixed_months', validity_months:2 }] };
      }
      if (sql.includes('INSERT INTO gift_voucher_orders')) return { rows:[{ id:501 }] };
      if (sql.includes('INSERT INTO payment_requests')) {
        return { rows:[{ id:701, request_key:'request-key', payer_name:'Tinkie Buyer', payer_mobile:'27831234567' }] };
      }
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release() {},
  };
  const db = {
    async connect() { return client; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE payment_requests')) {
        return { rows:[{ id:701, request_key:'request-key', payer_name:'Tinkie Buyer', payer_mobile:'27831234567', provider_payment_url:'https://pay.example' }] };
      }
      if (sql.includes('UPDATE gift_voucher_orders SET state=')) return { rows:[] };
      throw new Error(`Unexpected db query: ${sql}`);
    },
  };
  const service = createGiftVoucherService({
    db,
    ozow:{
      configured:() => true,
      async createPaymentLink() { return { providerRequestId:'provider-1', paymentUrl:'https://pay.example' }; },
    },
  });
  const result = await service.createOrder({
    crmV2ClientId:44,
    recipientName:'Evelyn Example',
    recipientMobile:'+27 82 123 4567',
    fromName:'Tinkie',
    language:'en',
    deliveryRecipient:'purchaser',
    amount:'900',
  });
  assert.equal(result.status, 'awaiting_payment');
  const insert = calls.find((call) => call.sql.includes('INSERT INTO gift_voucher_orders'));
  assert.ok(insert);
  assert.match(insert.sql, /recipient_mobile/);
  assert.equal(insert.params[3], '0821234567');
  assert.equal(insert.params[8], '0831234567');
});
