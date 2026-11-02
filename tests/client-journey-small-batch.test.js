'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMyShilohRouter } = require('../src/routes/myShiloh');
const { previousTreatmentChoice } = require('../src/services/myShilohPreviousTreatment');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const visit = { found: true, complete: true, ambiguous: false, multiService: false, services: ['Canonical treatment'], startsAt: '2026-10-01T08:00:00Z' };
const catalogue = [{ id: 101, name: 'Current public treatment', canonicalName: 'Canonical treatment', price: 'R600' }];

test('previous treatment uses a unique current catalogue match without carrying historic price, time or practitioner', () => {
  const choice = previousTreatmentChoice(visit, catalogue);
  assert.equal(choice.available, true);
  assert.equal(choice.service, 'Current public treatment');
  assert.equal(choice.href, '/my-shiloh/book?service=101');
  assert.match(choice.message, /Nothing has been booked/);
  assert.equal(choice.price, undefined);
  assert.equal(choice.practitioner, undefined);
  for (const input of [{ found: false }, { ...visit, ambiguous: true }, { ...visit, complete: false }, { ...visit, multiService: true }]) {
    assert.equal(previousTreatmentChoice(input, catalogue).available, false);
  }
  for (const current of [null, [], [...catalogue, ...catalogue], [{ ...catalogue[0], id: '101&client=66' }]]) {
    assert.equal(previousTreatmentChoice(visit, current).available, false);
  }
});

test('previous treatment reads only the signed-in client and never accepts a caller-selected client or appointment', async t => {
  const calls = [];
  const app = express();
  app.use(createMyShilohRouter({ env: { NODE_ENV: 'test' },
    sessionService: { async validateSessionToken(token) { return token === 'client-a' ? { ok: true, crmV2ClientId: 55, sessionId: 8 } : token === 'client-b' ? { ok: true, crmV2ClientId: 66, sessionId: 9 } : { ok: false }; } },
    historyService: { async loadLastCompletedVisit(id) { calls.push(id); return id === 55 ? visit : { found: false }; } },
    catalogueProvider: async () => catalogue,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/my-shiloh/api/previous-treatment?crmV2ClientId=55&appointmentId=901`;
  const denied = await fetch(url);
  assert.equal(denied.status, 401);
  assert.deepEqual(calls, []);
  const a = await fetch(url, { headers: { cookie: 'shiloh_client_session=client-a' } });
  assert.match(a.headers.get('cache-control'), /private, no-store/);
  assert.equal((await a.json()).available, true);
  const b = await fetch(url, { headers: { cookie: 'shiloh_client_session=client-b' } });
  assert.equal((await b.json()).available, false);
  assert.deepEqual(calls, [55, 66]);
});

test('public handoff QR contains only the validated public link; previous treatment is signed-in presentation only', () => {
  const guest = renderMyShilohPage({ catalogue, selectedServiceId: '101&client=55' });
  assert.match(guest, /data-booking-phone-qr/);
  assert.doesNotMatch(guest, /data-previous-treatment>|client=55/);
  const signedIn = renderMyShilohPage({ client: { id: 55, firstName: 'Synthetic' }, catalogue, selectedServiceId: '101' });
  assert.match(signedIn, /data-previous-treatment>Book a previous treatment/);
  assert.match(signedIn, /data-clinic-directions="https:\/\/www.google.com\/maps\/dir\/\?api=1&amp;destination=37%20Jacobs%20Street/);
});
