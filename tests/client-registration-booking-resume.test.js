const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhook = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'webhookController.js'), 'utf8');
const { processBookingMessage } = require('../src/services/bookingIntent');
const { decorateClientBookingResult } = require('../src/services/clientBookingInteractive');
const { pool } = require('../src/db/pool');

async function withStubbedQuery(stub, fn) {
  const original = pool.query;
  pool.query = stub;
  try { return await fn(); } finally { pool.query = original; }
}

test('registration completion resumes a bare booking intent instead of treating appointment as a service', () => {
  assert.match(webhook, /processBookingMessage\(from,"booking"\)/);
  assert.doesNotMatch(webhook, /processBookingMessage\(from,"I want to book an appointment"\)/);
});

test('bare booking start produces the available-family service list with no invalid appointment service', async () => {
  let intent = null;
  const result = await withStubbedQuery(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('CREATE TABLE IF NOT EXISTS booking_intents') || text.includes('ALTER TABLE booking_intents')) return { rows: [], rowCount: 0 };
    if (text.includes('SELECT phone, service_text') && text.includes('FROM booking_intents WHERE phone = $1')) return { rows: intent ? [intent] : [], rowCount: intent ? 1 : 0 };
    if (text.includes('INSERT INTO booking_intents')) {
      intent = { phone: params[0], service_text: params[1], preferred_date: params[2], preferred_time: params[3], therapist_text: params[4], service_verified: params[5], status: params[6] };
      return { rows: [intent], rowCount: 1 };
    }
    throw new Error(`Unexpected query in regression: ${text}`);
  }, () => processBookingMessage('27820000000', 'booking'));

  const decorated = decorateClientBookingResult(result);
  assert.equal(decorated.handled, true);
  assert.equal(decorated.intent.service_text, null);
  assert.equal(decorated.interactive.type, 'list');
  assert.match(decorated.interactive.body, /What would you like to book/i);
  assert.deepEqual(decorated.interactive.rows.map((row) => row.id), [
    'client_family_massage',
    'client_family_lymphatic',
    'client_family_pedicure',
  ]);
  assert.deepEqual(decorated.interactive.rows.map((row) => row.title), [
    'Massage Treatments',
    'Lymphatic Drainage',
    'Elim MediHeel Pedicures',
  ]);
});
