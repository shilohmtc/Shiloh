const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../src/db/pool');
const { processClientDiscoveryMessage } = require('../src/services/clientDiscoveryMenu');

async function withStubbedQuery(stub, fn) {
  const original = pool.query;
  pool.query = stub;
  try {
    return await fn();
  } finally {
    pool.query = original;
  }
}

test('List treatments routes to authoritative client-bookable categories instead of booking free text', async () => {
  const rows = [{ id: 1, name: 'Massage', display_order: 1, service_count: 4 }];
  const result = await withStubbedQuery(async () => ({ rows }), () => processClientDiscoveryMessage('27820000000', 'List treatments'));

  assert.equal(result.handled, true);
  assert.equal(result.interactive.type, 'list');
  assert.match(result.interactive.body, /Browse Shiloh services/);
  assert.equal(result.interactive.rows[0].id, 'client_category_1');
});

test('List your staff routes to authoritative client-bookable practitioner discovery', async () => {
  const rows = [
    { id: 10, display_name: 'Christel' },
    { id: 11, display_name: 'Abigail' },
  ];
  const result = await withStubbedQuery(async () => ({ rows }), () => processClientDiscoveryMessage('27820000000', 'List your staff'));

  assert.equal(result.handled, true);
  assert.equal(result.interactive.type, 'list');
  assert.match(result.interactive.body, /Our practitioners/);
  assert.deepEqual(result.interactive.rows.slice(0, 2).map((row) => row.title), [
    'Christel · Massage',
    'Abigail · Massage',
  ]);
  assert.equal(result.interactive.rows.at(-1).id, 'client_book_now');
});
