'use strict';
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createClientTreatmentCreditService } = require('../src/services/clientTreatmentCredit');
async function run() {
  const url = new URL(process.env.CREDIT_PROOF_DATABASE_URL || '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/shiloh_credit_test') throw new Error('Credit proof requires the dedicated local synthetic shiloh_credit_test database.');
  const pool = new Pool({ connectionString: url.toString(), max: 6 });
  const schema = `credit_${randomUUID().replaceAll('-', '')}`;
  const admin = await pool.connect();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query(fs.readFileSync('tests/fixtures/treatment-credit-schema.sql', 'utf8'));
    await admin.query(fs.readFileSync('migrations/188_client_treatment_credit.sql', 'utf8'));
    const db = {
      async connect() { const client = await pool.connect(); await client.query(`SET search_path TO ${schema}`); return client; },
      async query(sql, values) { const client = await this.connect(); try { return await client.query(sql, values); } finally { client.release(); } },
    };
    const service = createClientTreatmentCreditService({ db });
    const issue = overrides => ({ adminId: 1, clientId: 101, creditType: 'goodwill', amount: '100', reason: 'Synthetic concurrency proof', reference: '', operationId: randomUUID(), ...overrides });
    const apply = overrides => ({ adminId: 2, clientId: 101, appointmentId: 201, amount: '80', operationId: randomUUID(), ...overrides });
    const initial = issue();
    const repeatedIssues = await Promise.all([service.issue(initial), service.issue(initial)]);
    assert.deepEqual(repeatedIssues.map(r => r.status).sort(), ['idempotent_replay', 'issued']);
    const uses = await Promise.allSettled([service.apply(apply()), service.apply(apply({ appointmentId: 202 }))]);
    assert.equal(uses.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(uses.find(r => r.status === 'rejected').reason.code, 'CREDIT_EXCEEDS_BALANCE');
    assert.equal((await service.getClientModel({ adminId: 1, clientId: 101 })).balance, 20);
    const repeat = apply({ amount: '10' });
    const repeatedUse = await Promise.all([service.apply(repeat), service.apply(repeat)]);
    assert.deepEqual(repeatedUse.map(r => r.status).sort(), ['applied', 'idempotent_replay']);
    await service.issue(issue({ amount: '1000' }));
    await admin.query("INSERT INTO appointments VALUES(205,NULL,101,'completed',100,'ZAR',NOW(),'2026-10-08T10:00Z','Synthetic contention treatment')");
    const bookingUses = await Promise.allSettled([service.apply(apply({ amount: '80', appointmentId: 205 })), service.apply(apply({ amount: '80', appointmentId: 205 }))]);
    assert.equal(bookingUses.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(bookingUses.find(r => r.status === 'rejected').reason.code, 'CREDIT_EXCEEDS_TREATMENT');
    const audit = (await admin.query('SELECT COUNT(*)::int AS n FROM crm_audit_events')).rows[0].n;
    assert.equal(audit, 5);
    assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n, 0);
    console.log('PostgreSQL concurrent proof passed: duplicate issuance/use, wallet contention across treatments, account contention, five atomic audits, zero cash entries.');
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    admin.release(); await pool.end();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
