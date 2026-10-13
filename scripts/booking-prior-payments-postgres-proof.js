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
    // A waiver must serialize against both manual receipts and provider callbacks.
    await admin.query(`INSERT INTO appointments(id,crm_v2_client_id,status,total_price,currency,updated_at,starts_at,title) VALUES
      (207,101,'completed',500,'ZAR',NOW(),'2026-10-08','Synthetic waiver retry'),
      (208,101,'completed',500,'ZAR',NOW(),'2026-10-08','Synthetic waiver versus manual'),
      (209,101,'completed',500,'ZAR',NOW(),'2026-10-08','Synthetic waiver versus provider');
      INSERT INTO appointment_staff VALUES(207,11,1),(208,11,1),(209,11,1);
      INSERT INTO appointment_services VALUES(207,21,'Synthetic treatment',1),(208,21,'Synthetic treatment',1),(209,21,'Synthetic treatment',1);
      UPDATE staff_admin_accounts SET business_role='business_admin' WHERE id=2;`);
    const noChargeInput=async appointmentId=>({adminId:2,appointmentId,expectedRevision:(await service.get({adminId:2,appointmentId})).subject.pricingRevision,reason:'Synthetic complimentary visit',reviewed:true,operationId:randomUUID()});
    const sameWaiver=await noChargeInput(207);
    const repeatedWaiver=await Promise.all([service.recordNoCharge(sameWaiver),service.recordNoCharge(sameWaiver)]);
    assert.deepEqual(repeatedWaiver.map(r=>r.status).sort(),['idempotent_replay','no_charge_recorded']);
    const manualRace=await Promise.allSettled([
      service.recordNoCharge(await noChargeInput(208)),
      service.recordManual({adminId:2,appointmentId:208,amount:'100',method:'cash',reference:'SYNTHETIC-MANUAL',receivedOutsideOzowConfirmed:true,operationId:randomUUID()}),
    ]);
    assert.equal(manualRace.filter(r=>r.status==='fulfilled').length,1);
    const manualModel=await service.get({adminId:2,appointmentId:208});
    if(manualModel.payment.amountDue==='0.00') assert.equal(manualModel.payment.netPaid,'0.00');
    else {assert.equal(manualModel.payment.amountDue,'500.00');assert.equal(manualModel.payment.netPaid,'100.00');}
    const providerWaiver=await noChargeInput(209);
    await admin.query(`INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(109,209,500,'ZAR',NOW());
      INSERT INTO payment_requests(payment_account_id,state,amount,request_key) VALUES(109,'pending',100,'SYNTHETIC-WAIVER-PROVIDER')`);
    const providerRace=await Promise.allSettled([
      service.recordNoCharge(providerWaiver),
      service.handleOzowNotification({TransactionId:'SYNTHETIC-WAIVER-EVENT',TransactionReference:'SYNTHETIC-WAIVER-PROVIDER',Status:'Complete',Amount:'100.00',CurrencyCode:'ZAR'}),
    ]);
    assert.equal(providerRace[1].status,'fulfilled');
    const providerModel=await service.get({adminId:2,appointmentId:209});
    assert.equal(providerModel.payment.netPaid,'100.00');
    if(providerRace[0].status==='fulfilled') {assert.equal(providerModel.payment.amountDue,'0.00');assert.equal(providerModel.paymentReview.kind,'no_charge_payment_received');}
    else {assert.equal(providerRace[0].reason.code,'NO_CHARGE_PAYMENT_REVIEW');assert.equal(providerModel.payment.amountDue,'500.00');}
    console.log('No-charge PostgreSQL proof passed: exact concurrent retry and serialization against manual money and verified provider callbacks.');
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
