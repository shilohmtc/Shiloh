const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '061_massage_packages.sql'), 'utf8');
const packages = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientDiscoveryPackages.js'), 'utf8');
const webhook = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'webhookController.js'), 'utf8');

test('Sports Massage monthly package has the approved commercial contract', () => {
  assert.match(migration, /'sports-massage-monthly'[\s\S]*'Sports Massage — Monthly Package'/);
  assert.match(migration, /1400[\s\S]*4[\s\S]*30[\s\S]*24/);
  assert.match(migration, /'Sports Massage — Package Session', 50/);
  assert.match(migration, /Paid in advance\. Valid for 30 days from activation/);
});

test('package session is prepaid and entitlement-gated at the database write boundary', () => {
  assert.match(migration, /PACKAGE_ENTITLEMENT_REQUIRED/);
  assert.match(migration, /PACKAGE_CREDITS_EXHAUSTED/);
  assert.match(migration, /NEW\.price_snapshot := 0/);
  assert.match(migration, /SET total_price = 0/);
  assert.match(migration, /status IN \('reserved','redeemed'\)/);
  assert.match(migration, /v_starts_at < e\.expires_at/);
});

test('cancelled and no-show package appointments release a reserved credit without inventing forfeiture', () => {
  assert.match(migration, /ELSIF NEW\.status IN \('cancelled','no_show'\)/);
  assert.match(migration, /SET status = 'released'/);
  assert.match(migration, /NEW\.status = 'completed'[\s\S]*SET status = 'redeemed'/);
});

test('client discovery exposes Massage Packages while hiding package-only session services', () => {
  assert.match(packages, /id: 'client_massage_packages'/);
  assert.match(packages, /Prepaid packages & package sessions/);
  assert.match(packages, /packageSessionServiceIds/);
  assert.match(packages, /filter\(\(row\) => \{[\s\S]*client_service_/);
  assert.match(packages, /not booked as an individual treatment/);
});

test('package holders can book only after an active paid unexpired entitlement is resolved', () => {
  assert.match(packages, /e\.status='active' AND e\.payment_status='paid'/);
  assert.match(packages, /NOW\(\)>=e\.starts_at AND NOW\(\)<e\.expires_at/);
  assert.match(packages, /sessions_remaining < 1/);
  assert.match(packages, /Book \$\{pkg\.session_service_name\}/);
});

test('business admins record paid entitlements whose validity starts at the first treatment', () => {
  assert.match(packages, /\['owner','business_admin'\]\.includes\(admin\.business_role\)/);
  assert.match(packages, /package\.entitlement_activated/);
  assert.match(packages, /NULL,NULL,\$5,'active',\$6/);
  assert.match(packages, /Validity begins with the first treatment/);
  assert.match(packages, /already has an active Sports Massage package/);
});

test('WhatsApp uses the package-aware discovery router', () => {
  assert.match(webhook, /require\("\.\.\/services\/clientDiscoveryPackages"\)/);
  assert.doesNotMatch(webhook, /const \{ processClientDiscoveryMessage \} = require\("\.\.\/services\/clientDiscoveryMenu"\)/);
});
