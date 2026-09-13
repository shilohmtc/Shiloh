const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  renderStaffCalendarAccessPage,
  staffCalendarAccessClientScript,
} = require('../src/presentation/staffCalendarAccessUx');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('Workspace browser entry keeps TOTP and one-tap guidance but retires WhatsApp OTP UI', () => {
  const html = renderStaffCalendarAccessPage({ providerIndependentAuthEnabled: true });
  assert.match(html, /Shiloh Workspace/);
  assert.match(html, /Sign in with authenticator/);
  assert.match(html, /Use a recovery code/);
  assert.match(html, /Open from Shiloh WhatsApp/);
  assert.match(html, /send <code>calendar<\/code>/);
  assert.doesNotMatch(html, /Send sign-in code/);
  assert.doesNotMatch(html, /Enter the code from WhatsApp/);
  assert.doesNotMatch(html, /data-shiloh-challenge-form/);
  assert.doesNotMatch(html, /data-shiloh-verify-form/);
});

test('browser client has no challenge or WhatsApp-code verification calls', () => {
  const client = staffCalendarAccessClientScript();
  assert.match(client, /\/totp\/verify/);
  assert.match(client, /\/totp\/recovery\/verify/);
  assert.doesNotMatch(client, /AUTH_BASE\+'\/challenge'/);
  assert.doesNotMatch(client, /AUTH_BASE\+'\/verify'/);
  assert.doesNotMatch(client, /requestChallenge/);
  assert.doesNotMatch(client, /verifyChallenge/);
});

test('staff auth router removes every ordinary browser fallback endpoint but preserves secure one-tap exchange', () => {
  const route = source('src/routes/staffBrowserSession.js');
  assert.doesNotMatch(route, /router\.post\('\/challenge'/);
  assert.doesNotMatch(route, /router\.post\('\/verify'/);
  assert.doesNotMatch(route, /router\.post\('\/totp\/verify'/);
  assert.doesNotMatch(route, /router\.post\('\/totp\/recovery\/verify'/);
  assert.match(route, /router\.post\('\/calendar-handoff\/exchange'/);
});

test('Calendar no longer wires Meta-dependent challenge delivery into browser sessions', () => {
  const calendar = source('src/routes/calendar.js');
  assert.doesNotMatch(calendar, /staffBrowserChallengeDelivery/);
  assert.doesNotMatch(calendar, /challengeDispatcher/);
  assert.match(calendar, /createStaffBrowserSessionRouter/);
  assert.match(calendar, /router\.use\('\/staff-auth'/);
});
