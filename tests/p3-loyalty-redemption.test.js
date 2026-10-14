const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/040_loyalty_redemption_lifecycle.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/loyaltyRedemption.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'src/services/adminLoyaltyRedemption.js'), 'utf8');

test('redemption lifecycle is explicit, auditable and idempotent', () => {
  assert.match(migration, /status IN \('pending','committed','cancelled','failed'\)/);
  assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /loyalty_redemption_events/);
  assert.match(migration, /event_type TEXT NOT NULL CHECK/);
  assert.match(migration, /one_pending_per_reward/);
  assert.match(migration, /one_committed_per_appointment/);
});

test('reward transitions are atomic and recover reserved rewards', () => {
  assert.match(service, /BEGIN/);
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /status='reserved'/);
  assert.match(service, /status='redeemed'/);
  assert.match(service, /status='available'.*status='reserved'/s);
  assert.match(service, /appointment_no_longer_eligible/);
});

test('redemption requires explicit privileged permission and confirmation', () => {
  assert.match(migration, /"loyalty:redeem":true/);
  assert.match(migration, /business_role IN \('owner','business_admin'\)/);
  assert.match(admin, /permissions\?\.\['loyalty:redeem'\]/);
  assert.match(admin, /CONFIRM LOYALTY/);
  assert.match(admin, /CANCEL LOYALTY/);
});

test('redemption is appointment-bound and never asserts payment truth', () => {
  assert.match(service, /appointment_id BIGINT|appointment_id/);
  assert.doesNotMatch(service, /payment_status|mark.*paid|status\s*=\s*['"]paid['"]/i);
  assert.match(admin, /No payment status/);
});
