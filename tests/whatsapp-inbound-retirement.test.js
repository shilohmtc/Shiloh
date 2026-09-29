const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const webhook = require('../src/routes/webhook');

test('retired Meta verification is absent while historical status receipts and ordinary messages are acknowledged', async () => {
  const originalToken = process.env.VERIFY_TOKEN;
  const originalCutover = process.env.SHILOH_META_SIGNIN_ONLY_ENABLED;
  process.env.VERIFY_TOKEN = 'webhook-test-token';
  // The ordinary inbound path must stay retired even if the outbound flag changes.
  process.env.SHILOH_META_SIGNIN_ONLY_ENABLED = 'false';
  const app = express();
  app.use(express.json());
  app.use(webhook);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/webhook`;
    const verified = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=webhook-test-token&hub.challenge=challenge-123`);
    assert.equal(verified.status, 404);
    const rejected = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123`);
    assert.equal(rejected.status, 404);
    delete process.env.VERIFY_TOKEN;
    const missingCredential = await fetch(`${base}?hub.mode=subscribe&hub.challenge=challenge-123`);
    assert.equal(missingCredential.status, 404);
    const status = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: [{ changes: [{ value: {
        statuses: [{ id: 'wamid.historical', status: 'delivered', timestamp: '1787600000' }],
      } }] }] }),
    });
    assert.equal(status.status, 200);
    const inbound = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: [{ changes: [{ value: {
        messages: [{ from: '27820000000', type: 'text', text: { body: 'Do you have appointments?' } }],
      } }] }] }),
    });
    assert.equal(inbound.status, 200);
  } finally {
    server.close();
    if (originalToken === undefined) delete process.env.VERIFY_TOKEN;
    else process.env.VERIFY_TOKEN = originalToken;
    if (originalCutover === undefined) delete process.env.SHILOH_META_SIGNIN_ONLY_ENABLED;
    else process.env.SHILOH_META_SIGNIN_ONLY_ENABLED = originalCutover;
  }
});
