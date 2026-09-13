const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderStaffCalendarAccessPage,
} = require('../src/presentation/staffCalendarAccessUx');
const {
  retireBrowserWhatsAppGuidance,
} = require('../src/routes/staffCalendarAccessUx');
const {
  renderStaffCalendarHandoffPage,
  staffCalendarHandoffClientScript,
} = require('../src/presentation/staffCalendarHandoffUx');

function decoratedAccessPage(reason = null) {
  const base = renderStaffCalendarAccessPage({
    reason,
  });
  return retireBrowserWhatsAppGuidance(base);
}

test('direct Workspace sign-in retires legacy WhatsApp and recovery fallback panels', () => {
  const page = decoratedAccessPage();

  assert.doesNotMatch(page, /Direct browser sign-in|Use your authenticator|Use a recovery code|Recovery administration|Open recovery enrollment tools/);

  assert.doesNotMatch(page, /Easiest access/i);
  assert.doesNotMatch(page, /Open from Shiloh WhatsApp/i);
  assert.doesNotMatch(page, /data-shiloh-whatsapp-handoff-guidance/);
  assert.doesNotMatch(page, /send <code>calendar<\/code>/i);
  assert.doesNotMatch(page, /Authenticator and recovery credentials stay outside WhatsApp/i);
  assert.doesNotMatch(page, /open Workspace from your existing Shiloh WhatsApp conversation/i);
  assert.doesNotMatch(page, /Need to enroll an authenticator\?/);

  assert.match(page, /data-shiloh-status data-state="ready"><\/div>/);
  assert.match(page, /\[data-shiloh-status\]:empty\{display:none\}/);
});

test('stale-session landing no longer renders a persistent red warning below direct sign-in', () => {
  const page = decoratedAccessPage('session');

  assert.doesNotMatch(page, /Your staff session is missing, expired, or revoked/);
  assert.match(page, /data-shiloh-status data-state="session-ended"><\/div>/);
  assert.match(page, /\[data-shiloh-status\]:empty\{display:none\}/);
});

test('actual WhatsApp one-time Workspace handoff remains a separate unchanged surface', () => {
  const handoffPage = renderStaffCalendarHandoffPage();
  const handoffClient = staffCalendarHandoffClientScript();

  assert.match(handoffPage, /Shiloh Workspace/);
  assert.match(handoffClient, /calendar-handoff\/exchange/);
  assert.match(handoffClient, /Open Workspace/);
  assert.match(handoffClient, /window\.location\.replace/);
});
