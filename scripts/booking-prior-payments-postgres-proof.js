'use strict';
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { install, serviceFor, priorInput } = require('../tests/helpers/priorPaymentFixture');
async function run() {
  const url = new URL(process.env.TEST_PRIOR_PAYMENT_DATABASE_URL || '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Prior payment proof requires dedicated local synthetic PostgreSQL.');
  const pool = new Pool({ connectionString: url.toString(), max: 8 });
  const schema = 'prior_payment_' + randomUUID().replaceAll('-', '');
  const admin = await pool.connect();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await install(admin);
    const db = {
      async connect() {
        const client = await pool.connect();
        await client.query(`SET search_path TO ${schema}`);
        return client;
      },
      async query(sql, params) {
        const client = await this.connect();
        try {
          return await client.query(sql, params);
        } finally {
          client.release();
        }
      },
    };
    const service = serviceFor(db),
      repeat = priorInput({ amount: '100' });
    const repeated = await Promise.all([service.recordPrior(repeat), service.recordPrior(repeat)]);
    assert.deepEqual(repeated.map((r) => r.status).sort(), ['applied', 'idempotent_replay']);
    const duplicate = await Promise.allSettled([
      service.recordPrior(
        priorInput({ amount: '100', reference: 'CONCURRENT-EVIDENCE', appointmentId: 201 }),
      ),
      service.recordPrior(
        priorInput({ amount: '100', reference: 'CONCURRENT-EVIDENCE', appointmentId: 203 }),
      ),
    ]);
    assert.equal(duplicate.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      duplicate.find((r) => r.status === 'rejected').reason.code,
      'PRIOR_PAYMENT_DUPLICATE',
    );
    const cap = await Promise.allSettled([
      service.recordPrior(priorInput({ amount: '300', reference: 'CAP-ONE', appointmentId: 201 })),
      service.recordPrior(priorInput({ amount: '300', reference: 'CAP-TWO', appointmentId: 201 })),
    ]);
    assert.equal(cap.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      cap.find((r) => r.status === 'rejected').reason.code,
      'PRIOR_PAYMENT_EXCEEDS_BALANCE',
    );
    await admin.query(`INSERT INTO appointments(id,crm_v2_client_id,status,total_price,currency,updated_at,starts_at,title) VALUES
      (205,101,'completed',500,'ZAR',NOW(),'2026-10-08','Synthetic link target A'),(206,101,'completed',500,'ZAR',NOW(),'2026-10-08','Synthetic link target B');
      INSERT INTO appointment_staff VALUES(205,11,1),(206,11,1);INSERT INTO appointment_services VALUES(205,21,'Synthetic A',1),(206,21,'Synthetic B',1);
      INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,202,500,'ZAR',NOW());`);
    const receipt = (
      await admin.query(
        "INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,external_reference,created_at) VALUES(100,'payment',1000,'SOURCE-RECEIPT','2026-09-15T08:00Z') RETURNING id",
      )
    ).rows[0];
    const links = await Promise.allSettled([
      service.recordPrior(
        priorInput({ sourceEntryId: receipt.id, amount: '400', appointmentId: 205 }),
      ),
      service.recordPrior(
        priorInput({ sourceEntryId: receipt.id, amount: '400', appointmentId: 206 }),
      ),
    ]);
    assert.equal(links.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      links.find((r) => r.status === 'rejected').reason.code,
      'PRIOR_PAYMENT_SOURCE_ALLOCATED',
    );
    assert.equal((await service.get({ adminId: 2, appointmentId: 202 })).payment.netPaid, '600.00');
    const applied = links.find((r) => r.status === 'fulfilled').value.entry;
    const correction = {
      adminId: 2,
      appointmentId: Number(applied.appointment_id),
      entryId: applied.id,
      reason: 'Synthetic concurrent correction',
      reviewed: true,
    };
    const reversals = await Promise.allSettled([
      service.reversePrior({ ...correction, operationId: randomUUID() }),
      service.reversePrior({ ...correction, operationId: randomUUID() }),
    ]);
    assert.equal(reversals.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      reversals.find((r) => r.status === 'rejected').reason.code,
      'PRIOR_PAYMENT_ALREADY_REVERSED',
    );
    assert.equal(
      (await service.get({ adminId: 2, appointmentId: 202 })).payment.netPaid,
      '1000.00',
    );
    assert.equal(
      (await admin.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,
      1,
    );
    assert.equal(
      (await admin.query('SELECT SUM(amount) AS amount FROM payment_ledger_entries')).rows[0]
        .amount,
      '1000.00',
    );
    console.log(
      'Prior-payment PostgreSQL proof passed: exact concurrent replay, duplicate-evidence protection, booking caps, receipt-use caps, single reversal and unchanged original receipts.',
    );
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    admin.release();
    await pool.end();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
