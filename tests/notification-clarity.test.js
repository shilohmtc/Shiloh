'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectChangeDelivery } = require('../src/services/workspaceChangeDeliveryAttention');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');
const { renderClientDetailPage } = require('../src/presentation/workspaceClientsUx');
const { messagesFixture, profileFixture } = require('../stories/fixtures/notificationClarity');

test('pending change and cancellation copy preserves genuine failed, uncertain and successful states', () => {
  for (const [status, kind, label] of [
    ['pending', 'time', 'Booking change not confirmed'], ['pending', 'cancellation', 'Cancellation not confirmed'],
    ['sending', 'time', 'Send status uncertain'], ['failed', 'cancellation', 'Send attempt failed'],
    ['sent', 'time', 'Sent'], ['confirmed', 'time', 'Confirmed'], ['delivered', 'time', 'Delivered'],
  ]) {
    const projected = projectChangeDelivery({ status, change_kind: kind });
    assert.equal(projected.statusLabel, label);
    assert.equal(projected.label, kind === 'cancellation' ? 'Cancellation update' : 'Appointment update');
  }
});
test('attention actions preserve appointment context and do not invent retries or provider receipt', () => {
  const model = messagesFixture();
  const html = renderMessagesPage(model);
  assert.match(html, /Booking confirmation not confirmed/);
  assert.match(html, /The booking remains available in Bookings/);
  assert.match(html, /Appointment: /);
  assert.match(html, /Update: /);
  assert.match(html, /date=2026-10-20&amp;appointment=701/);
  assert.match(html, /returnTo=%2Fcalendar%2Fmessages%3Fview%3Dattention/);
  assert.match(html, /href="tel:\+27820000001">Call/);
  assert.doesNotMatch(html, /<strong>Delivery|<strong>Recovery|data-booking-confirmation-recover|Waiting for channel|App update unavailable/);
  model.attention[0].client.normalizedMobile = 'javascript:alert(1)';
  model.changeAttention = [];
  assert.doesNotMatch(renderMessagesPage(model), /href="tel:/);
});
test('missing profile evidence never implies installation, alert setup, or reading', () => {
  const model = profileFixture();
  delete model.appStatus;
  const html = renderClientDetailPage(model).replace(/<[^>]*>/g, '');
  assert.match(html, /My Shiloh: Not yet confirmed/);
  assert.match(html, /Phone alerts: Unknown/);
  assert.doesNotMatch(html, /last used|App installed|Never used/i);
});

test('used profiles omit unknown guidance and failure fixtures match the canonical short reason', () => {
  const html = renderClientDetailPage(profileFixture('Used before', 'Enabled'));
  assert.doesNotMatch(html, /Not yet confirmed means/);
  assert.match(html, /does not confirm a message was received or read/);
  for (const item of messagesFixture().changeAttention.filter(item => ['failed', 'uncertain'].includes(item.status))) {
    assert.equal(item.nextAction, projectChangeDelivery({ status: item.status === 'uncertain' ? 'sending' : 'failed' }).nextAction);
  }
});
