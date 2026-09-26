const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/db/pool');
const reschedules = require('../src/services/clientRescheduleApproval');
const fs = require('node:fs');
const path = require('node:path');

test('cutover preserves the owner of existing requests and routes only new requests to Reception', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/160_reschedule_reception_decision.sql'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../src/services/clientRescheduleApproval.js'), 'utf8');
  const create = source.match(/async function createPendingRescheduleRequest[\s\S]*?async function loadRequestContext/)[0];
  assert.match(migration, /DEFAULT 'practitioner'/);
  assert.match(migration, /decision_owner IN \('practitioner','reception'\)/);
  assert.match(source, /'pending','reception'/);
  assert.doesNotMatch(create, /sendApprovalRequest|sendWhatsAppTemplate/);
  assert.match(source, /context\.decision_owner !== 'practitioner'/);
});

test('a Reception decision cannot consume an in-flight practitioner-owned request', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM appointment_reschedule_requests request')) {
        return { rows: [{ id: 44, decision_owner: 'practitioner', request_status: 'pending' }] };
      }
      return { rows: [] };
    },
    release() {},
  });
  try {
    const result = await reschedules.decideReceptionReschedule({
      admin: { id: 100 }, requestId: 44, decision: 'approve',
      authorize: () => { throw new Error('Authorization must not run for legacy requests'); },
    });
    assert.equal(result.status, 'forbidden');
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(queries.some(sql => /UPDATE appointments|UPDATE appointment_reschedule_requests/.test(sql)), false);
  } finally {
    pool.connect = originalConnect;
  }
});

test('a Reception-owned decision rolls back if current Reception scope rejects it', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM appointment_reschedule_requests request')) {
        return { rows: [{ id: 45, decision_owner: 'reception', request_status: 'pending' }] };
      }
      return { rows: [] };
    },
    release() {},
  });
  try {
    await assert.rejects(reschedules.decideReceptionReschedule({
      admin: { id: 100 }, requestId: 45, decision: 'approve',
      authorize: () => { throw new Error('Current team scope denies this request'); },
    }), /Current team scope denies/);
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(queries.some(sql => /UPDATE appointments|UPDATE appointment_reschedule_requests/.test(sql)), false);
  } finally {
    pool.connect = originalConnect;
  }
});
