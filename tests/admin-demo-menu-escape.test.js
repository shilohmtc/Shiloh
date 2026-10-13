const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const escapePath = path.join(__dirname,'..','src','services','adminDemoMenuEscape.js');

const escapeSource = fs.readFileSync(escapePath,'utf8');

const { isAdminMenuEscape } = require(escapePath);

test('Menu, Admin Menu and Home are hard admin escape commands',()=>{
  assert.equal(isAdminMenuEscape('Menu'),true);
  assert.equal(isAdminMenuEscape('admin menu'),true);
  assert.equal(isAdminMenuEscape('HOME'),true);
  assert.equal(isAdminMenuEscape('pelvic treatment'),false);
});

test('unfinished demo escape cannot delete a created appointment',()=>{
  assert.match(escapeSource,/if \(session\.demo_appointment_id\)/);
  assert.doesNotMatch(escapeSource,/DELETE FROM appointments/);
  assert.match(escapeSource,/NOT EXISTS \(SELECT 1 FROM appointments WHERE client_id=\$1\)/);
});

test('unfinished demo escape clears only temporary demo state and audits abandonment',()=>{
  assert.match(escapeSource,/DELETE FROM booking_intents WHERE phone=\$1/);
  assert.match(escapeSource,/DELETE FROM client_onboarding_sessions WHERE phone=\$1/);
  assert.match(escapeSource,/DELETE FROM booking_policy_acceptances WHERE phone=\$1/);
  assert.match(escapeSource,/DELETE FROM admin_client_demo_sessions WHERE admin_id=\$1/);
  assert.match(escapeSource,/admin\.client_demo_abandoned_to_menu/);
});
