'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const {
  createWhatsAppBookingPilotAdmission,
} = require('../src/services/whatsAppBookingPilotAdmission');

test('the separate staff test slot preserves the original allowance and cannot duplicate a recipient', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const migrate = (file) =>
    db.exec(readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
  await migrate('203_whatsapp_booking_deliveries.sql');
  const now = Date.UTC(2030, 0, 2);
  const key = Buffer.alloc(32, 7);
  const original = '27820000001';
  const tester = '27820000002';
  const originalHash = createHmac('sha256', key)
    .update('booking-pilot:' + original)
    .digest('hex');
  await db.query('INSERT INTO whatsapp_booking_pilot_admission VALUES (1,$1,$2,7)', [
    originalHash,
    new Date(now + 3600000),
  ]);
  const rows = async () =>
    (
      await db.query(
        'SELECT slot, recipient_hash, window_ends_at, reserved_attempts FROM whatsapp_booking_pilot_admission ORDER BY slot',
      )
    ).rows;
  const old = (await rows())[0];
  await migrate('205_whatsapp_booking_staff_test_slot.sql');
  assert.deepEqual(await rows(), [old]);

  const options = { db, key, maximumAttempts: 2, clock: () => now };
  const active = createWhatsAppBookingPilotAdmission({ ...options, recipient: tester, slot: 2 });
  const duplicate = createWhatsAppBookingPilotAdmission({
    ...options,
    recipient: original,
    slot: 2,
  });
  const config = { phoneNumberId: '123', providerSecret: 'synthetic' };
  const inbound = (recipient) => {
    const raw = Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '123' },
                  messages: [{ from: recipient, timestamp: String(now / 1000) }],
                },
              },
            ],
          },
        ],
      }),
    );
    const signature =
      'sha256=' + createHmac('sha256', config.providerSecret).update(raw).digest('hex');
    return [raw, signature, config];
  };
  assert.equal(await duplicate.recordInbound(...inbound(original)), false);
  assert.equal(await active.recordInbound(...inbound(original)), false);
  assert.equal((await active.authorizeDelivery({ recipient: tester })).allowed, false);
  assert.equal(await active.recordInbound(...inbound(tester)), true);
  assert.equal(await active.recordInbound(...inbound(tester)), true);
  assert.equal((await active.authorizeDelivery({ recipient: original })).allowed, false);
  assert.equal((await active.authorizeDelivery({ recipient: tester })).allowed, true);
  assert.equal((await active.authorizeDelivery({ recipient: tester })).allowed, true);
  assert.equal((await active.authorizeDelivery({ recipient: tester })).allowed, false);
  assert.equal(await active.recordInbound(...inbound(tester)), true);
  assert.equal((await active.authorizeDelivery({ recipient: tester })).allowed, false);
  const current = await rows();
  assert.deepEqual(current[0], old);
  assert.equal(current[1].reserved_attempts, 2);
});
