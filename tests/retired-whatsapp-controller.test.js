const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { pool } = require('../src/db/pool');
const webhook = require('../src/routes/webhook');
const { createWhatsAppStatusWebhookController } = require('../src/controllers/whatsappStatusWebhookController');

test('removed bot entry and isolated helpers cannot be loaded', () => {
  for (const file of [
    '../src/controllers/webhookController',
    '../src/presentation/whatsappChoicePresentation',
    '../src/services/clientRescheduleApprovalTemplateProvisioning',
  ]) assert.throws(() => require.resolve(file), { code: 'MODULE_NOT_FOUND' }, file);
});

test('mounted webhook acknowledges client, staff and stale interactive requests without database actions', async (t) => {
  const originalQuery = pool.query;
  let databaseCalls = 0;
  pool.query = async () => { databaseCalls += 1; throw new Error('Inbound bot actions are retired'); };
  t.after(() => { pool.query = originalQuery; });
  const app = express();
  app.use(express.json());
  app.use(webhook);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/webhook`;
  for (const message of [
    { type: 'text', text: { body: 'Book a massage tomorrow' } },
    { type: 'text', text: { body: 'Admin' } },
    { type: 'text', text: { body: 'workspace' } },
    { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'booking_approval_approve_123' } } },
    { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'client_book_now' } } },
  ]) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '27820000001', ...message }] } }] }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK');
  }
  assert.equal(databaseCalls, 0);
});

test('historical status handling persists delivery evidence while mixed inbound messages only continue to acknowledgement', async () => {
  const persisted = [];
  const controller = createWhatsAppStatusWebhookController({ async persistStatuses(records) {
    persisted.push(...records);
    return records.map(() => ({ matched: 1 }));
  } });
  for (const mixed of [false, true]) {
    let continued = 0;
    let status;
    const value = { statuses: [{ id: 'wamid.synthetic-retired-delivery', status: 'delivered', timestamp: '1791913200' }] };
    if (mixed) value.messages = [{ from: '27820000001', text: { body: 'Hello' } }];
    await controller({ body: { entry: [{ changes: [{ value }] }] }, log: { info() {}, warn() {} } },
      { statusCode: 200, sendStatus(code) { status = code; } }, () => { continued += 1; });
    assert.equal(continued, mixed ? 1 : 0);
    assert.equal(status, mixed ? undefined : 200);
  }
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].providerStatus, 'delivered');
});
