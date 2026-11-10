'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clientHarness } = require('./helpers/clientCodeHarness');
const { CLIENT_DAILY_BUDGET_MINOR, validClientBudget, clientBudgetBuckets } = require('../src/services/clientCodeReleasePolicy');
const { parseClientManifest } = require('../src/services/clientCodeRelease');
const reviewedManifest = require('../src/config/clientWhatsAppManifest.json');
const budget = { currency: 'ZAR', dailyMinor: 1000, whatsappCostMinor: 100 };
const input = (h, i) => ({ ...h.context, purpose: 'continue', mobile: '2782' + String(i).padStart(7, '0'), browserToken: String(i).padEnd(43, 'x'), network: '198.51.100.' + i });
function setDay(h) { h.advance(Date.parse('2099-11-10T10:00:00Z') - h.now().getTime()); }

test('client ceiling accepts explicit R10 and R5, fails closed above R10, and preserves the reviewed unit estimate and SMS contract', () => {
  assert.equal(CLIENT_DAILY_BUDGET_MINOR, 1000);
  for (const dailyMinor of [500, 600, 1000]) {
    const value = { ...budget, dailyMinor };
    assert.equal(validClientBudget(value), true);
    assert.deepEqual(parseClientManifest(JSON.stringify({ reviewedForClients: true, budget: value, smsFallbackEnabled: false })).budget, value);
    assert.equal(parseClientManifest(JSON.stringify({ reviewedForClients: true, budget: value, smsFallbackEnabled: true })), null);
  }
  for (const value of [undefined, {}, { ...budget, dailyMinor: 1001 }, { ...budget, dailyMinor: 1000.1 }, { ...budget, dailyMinor: 0 }, { ...budget, whatsappCostMinor: 0 }, { ...budget, currency: 'USD' }]) {
    assert.equal(validClientBudget(value), false);
    assert.equal(parseClientManifest(JSON.stringify({ reviewedForClients: true, budget: value, smsFallbackEnabled: false })), null);
  }
  assert.equal(reviewedManifest.budget.dailyMinor, 500, 'This code change must not raise a configured default');
  assert.equal(reviewedManifest.budget.whatsappCostMinor, 100);
  const current = new Date('2099-11-10T21:59:59.999Z'), digest = (...parts) => parts.join(':');
  const old = clientBudgetBuckets({ budget: { ...budget, dailyMinor: 500 }, channel: 'whatsapp', digest, current })[0];
  const raised = clientBudgetBuckets({ budget, channel: 'whatsapp', digest, current })[0];
  assert.equal(raised.key, old.key);
  assert.equal(raised.amount, 100);
  assert.equal(raised.windowMs, 1);
  assert.equal(raised.limit, 1000);
  assert.notEqual(clientBudgetBuckets({ budget, channel: 'whatsapp', digest, current: new Date(+current + 1) })[0].key, raised.key);
  assert.throws(() => clientBudgetBuckets({ budget, channel: 'sms', digest, current }), /allowance unavailable/);
});

test('raising R5 to R10 preserves prior reservations across concurrent dispatch and restart, then resets only at South African midnight', async (t) => {
  const h = await clientHarness(t); setDay(h);
  const original = h.make({ budget: { ...budget, dailyMinor: 500 } });
  for (let i = 1; i <= 7; i++) await original.begin(input(h, i));
  await Promise.all(Array.from({ length: 7 }, () => original.dispatchOne()));
  assert.equal(h.sent.length, 5);
  const before = (await h.db.query('SELECT bucket_key,attempts,expires_at FROM client_code_rates WHERE attempts=500')).rows;
  assert.equal(before.length, 1);
  const raised = h.make({ budget });
  for (let i = 8; i <= 14; i++) await raised.begin(input(h, i));
  await Promise.all(Array.from({ length: 7 }, () => raised.dispatchOne()));
  assert.equal(h.sent.length, 10);
  const after = (await h.db.query('SELECT attempts,expires_at FROM client_code_rates WHERE bucket_key=$1', [before[0].bucket_key])).rows[0];
  assert.equal(after.attempts, 1000);
  assert.equal(new Date(after.expires_at).getTime(), new Date(before[0].expires_at).getTime());
  const restarted = h.make({ budget });
  h.advance(Date.parse('2099-11-10T21:59:59.999Z') - h.now().getTime());
  await restarted.begin(input(h, 15)); await restarted.dispatchOne();
  assert.equal(h.sent.length, 10);
  h.advance(1);
  await h.make({ budget }).begin(input(h, 16)); await h.make({ budget }).dispatchOne();
  assert.equal(h.sent.length, 11);
  assert.equal(h.sms.length, 0);
});

test('R10 does not relax the shared three-per-client limit across purposes and service restarts', async (t) => {
  const h = await clientHarness(t); setDay(h);
  for (let i = 0; i < 4; i++) {
    const service = h.make({ budget });
    await service.begin({ ...input(h, 1), purpose: i % 2 ? 'register' : 'continue' });
    await service.dispatchOne(); h.advance(60000);
  }
  assert.equal(h.sent.length, 3);
  assert.equal(h.sms.length, 0);
});

test('the separate fifty-code limit still binds when a synthetic estimate leaves room within R10', async (t) => {
  const h = await clientHarness(t); setDay(h);
  // Fictional one-cent estimate isolates the count ceiling; the reviewed real estimate stays R1 above.
  for (let i = 1; i <= 51; i++) {
    const service = h.make({ budget: { ...budget, whatsappCostMinor: 1 } });
    await service.begin(input(h, i)); await service.dispatchOne();
  }
  assert.equal(h.sent.length, 50);
  assert.equal(h.sms.length, 0);
});
