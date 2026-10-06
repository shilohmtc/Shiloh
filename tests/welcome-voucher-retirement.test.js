'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMyShilohWelcomeVoucherService } = require('../src/services/myShilohWelcomeVoucher');
const { renderHome, renderContact } = require('../src/services/publicWebsite');
const { processClientDiscoveryMessage } = require('../src/services/clientDiscoveryMenu');
const { myShilohAwarenessReply } = require('../src/presentation/whatsappClientMenu');

const now = () => new Date('2026-10-06T10:00:00Z');
const authority = { id: 912, name: 'Test Client', date_of_birth: '1980-01-02', gender: 'female', mobile_verified_at: '2026-09-20', profile_status: 'registered', status: 'active' };
const issued = { id: 7, state: 'available', amount: '100.00', minimum_booking_value: '450.00', issued_at: '2026-09-20T10:00:00Z', expires_at: '2026-11-19T10:00:00Z', redeemed_at: null };

function readingDb(voucher, client = authority) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM crm_v2_clients')) return { rows: [client] };
      if (sql.includes('UPDATE my_shiloh_welcome_vouchers')) return { rows: [] };
      if (sql.includes('FROM my_shiloh_welcome_vouchers')) return { rows: voucher ? [voucher] : [] };
      if (sql.includes('FROM appointments')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

for (const profile of [authority, { ...authority, profile_status: 'minimal', date_of_birth: null }]) {
  test(`closed campaign never issues vouchers for ${profile.profile_status} profiles or repeated reads`, async () => {
    const db = readingDb(null, profile);
    const service = createMyShilohWelcomeVoucherService({ db, now });
    for (let attempt = 0; attempt < 3; attempt++) {
      await service.syncGrant({ crmV2ClientId: authority.id });
      const model = await service.getClientModel({ crmV2ClientId: authority.id });
      assert.equal(model.voucher, null);
      assert.deepEqual(model.eligibleBookings, []);
      assert.deepEqual(model.terms, []);
    }
    assert.ok(db.calls.every(sql => !/INSERT|DELETE|my_shiloh_welcome_voucher_settings/i.test(sql)));
  });
}

test('existing issued vouchers retain their value, original expiry and terms after retirement', async () => {
  const db = readingDb(issued);
  const model = await createMyShilohWelcomeVoucherService({ db, now }).getClientModel({ crmV2ClientId: authority.id });
  assert.equal(model.voucher.state, 'available');
  assert.equal(model.voucher.amount, 100);
  assert.equal(model.voucher.expiresAt, '2026-11-19T10:00:00.000Z');
  assert.ok(model.terms.some(term => /60 days/.test(term)));
  const mutation = db.calls.filter(sql => /UPDATE|INSERT|DELETE/i.test(sql));
  assert.equal(mutation.length, 1);
  assert.match(mutation[0], /state='expired'[\s\S]*expires_at<=\$2/);
});

function redemptionDb(voucher) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.includes('FROM client_browser_sessions')) return { rows: [{ id: 13 }] };
      if (sql.includes('WHERE operation_key=')) return { rows: [] };
      if (sql.includes('FROM crm_v2_clients')) return { rows: [authority] };
      if (sql.includes('SELECT * FROM my_shiloh_welcome_vouchers')) return { rows: voucher ? [voucher] : [] };
      if (sql.includes('FROM appointments a')) return { rows: [{ id: 31, crm_v2_client_id: authority.id, total_price: '700.00', status: 'confirmed', starts_at: '2026-10-07T10:00:00Z', welcome_voucher_practitioner_eligible: true }] };
      if (sql.includes('SELECT 1 FROM')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM booking_payment_accounts')) return { rows: [{ id: 41, canonical_amount_due: '700.00' }] };
      if (sql.includes('AS net_paid')) return { rows: [{ net_paid: '350.00', rewards: '0', welcome: '0' }] };
      if (/^(INSERT INTO booking_welcome_voucher_allocations|UPDATE my_shiloh_welcome_vouchers|INSERT INTO crm_audit_events)/.test(sql.trim())) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { released = true; },
  };
  return { calls, query: client.query, connect: async () => client, released: () => released };
}
const redemption = { crmV2ClientId: authority.id, sessionId: 13, appointmentId: 31, operationId: 'retired-offer-test' };

test('stale redemption requests do not grant a voucher or promise one after registration', async () => {
  const db = redemptionDb(null);
  await assert.rejects(createMyShilohWelcomeVoucherService({ db, now }).applyToBooking(redemption), error => {
    assert.equal(error.code, 'WELCOME_VOUCHER_CAMPAIGN_CLOSED');
    assert.match(error.message, /offer has ended/);
    assert.doesNotMatch(error.message, /unlock|registration/);
    return true;
  });
  assert.ok(db.calls.includes('ROLLBACK'));
  assert.ok(db.calls.every(sql => !/INSERT|UPDATE|DELETE/.test(sql.split('FOR UPDATE')[0])));
  assert.equal(db.released(), true);
});

test('an already-issued voucher can still be redeemed through the existing transaction', async () => {
  const db = redemptionDb(issued);
  const result = await createMyShilohWelcomeVoucherService({ db, now }).applyToBooking(redemption);
  assert.deepEqual(result, { status: 'applied', amount: 100, appointmentId: 31, outstanding: 250 });
  assert.ok(db.calls.some(sql => sql.includes('INSERT INTO booking_welcome_voucher_allocations')));
  assert.ok(db.calls.some(sql => sql.includes("SET state='redeemed'")));
  assert.ok(db.calls.includes('COMMIT'));
  assert.equal(db.released(), true);
});

test('public Home, Contact and onboarding contain no new-voucher promotion', () => {
  for (const html of [renderHome([]), renderContact()]) assert.doesNotMatch(html, /R100|welcome voucher|unlock/i);
  const source = fs.readFileSync(path.join(__dirname, '../src/services/clientIdentityOnboarding.js'), 'utf8');
  assert.doesNotMatch(source, /R100|welcome.voucher|ready to unlock/i);
});

test('new My Shiloh action is ordinary app guidance while old voucher buttons explain closure', async () => {
  for (const action of ['client_my_shiloh', 'open my shiloh', 'install my shiloh', 'my shiloh']) {
    assert.deepEqual(await processClientDiscoveryMessage('27820000000', action), { handled: true, reply: myShilohAwarenessReply() });
  }
  for (const action of ['client_welcome_voucher', 'get r100 voucher']) {
    const result = await processClientDiscoveryMessage('27820000000', action);
    assert.match(result.reply, /offer has ended/);
    assert.doesNotMatch(result.reply, /unlock|claim|get your R100/i);
  }
});
