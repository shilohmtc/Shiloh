const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const booking = fs.readFileSync(path.join(ROOT, 'src/services/customerBookingConfirmation.js'), 'utf8');
const lifecycle = fs.readFileSync(path.join(ROOT, 'src/services/appointmentLifecycle.js'), 'utf8');
const changes = fs.readFileSync(path.join(ROOT, 'src/services/customerChangeNotification.js'), 'utf8');
const independence = require('../src/services/sh05ChannelIndependence');

test('SH-05 creates bounded appointment notification payloads inside My Shiloh', () => {
  const payload = independence.appointmentDetails({
    appointmentId: 759,
    crmV2ClientId: 912,
    changeKind: 'confirmation',
    startsAt: '2026-09-25T08:00:00.000Z',
    endsAt: '2026-09-25T09:00:00.000Z',
  });
  assert.equal(payload.crmV2ClientId, 912);
  assert.equal(payload.eventKey, 'appointment-confirmation:759:2026-09-25T08:00:00.000Z');
  assert.equal(payload.category, 'appointment');
  assert.equal(payload.targetPath, '/my-shiloh/#bookings');
  assert.match(payload.body, /Shiloh appointment is/);
});

test('SH-05 preserves the booking mutation when My Shiloh is unavailable', async () => {
  const result = await independence.queueIndependentMyShilohNotification({ appointmentId: 759, crmV2ClientId: null });
  assert.equal(result.queued, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'crm_v2_client_unavailable');
});

test('booking confirmations queue My Shiloh before the WhatsApp provider is called', () => {
  const queue = booking.indexOf('queueBookingConfirmationMyShilohNotification({');
  const provider = booking.indexOf('sendTemplate(phone,template');
  const fallback = booking.indexOf('sendMessage(phone,lines.join');
  assert.ok(queue > 0);
  assert.ok(provider > queue);
  assert.ok(fallback > queue);
});

test('appointment reminders queue My Shiloh before WhatsApp and isolate either channel failure', () => {
  const reminder = lifecycle.indexOf('async function deliverClaimedReminder');
  const notify = lifecycle.indexOf('await notifyClient({', reminder);
  const send = lifecycle.indexOf('return send(', reminder);
  assert.ok(notify > reminder);
  assert.ok(send > notify);
  assert.match(lifecycle.slice(notify, send), /try/);
  assert.match(lifecycle.slice(notify, send), /catch/);
});

test('booking changes queue My Shiloh before WhatsApp delivery', () => {
  const change = changes.indexOf('queueBookingChangeMyShilohNotification({');
  const provider = changes.indexOf('sendWhatsAppTemplate(', change);
  assert.ok(change > 0);
  assert.ok(provider > change);
});
