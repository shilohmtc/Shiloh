'use strict';
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { once } = require('node:events');
const { createGiftVoucherService } = require('../../src/services/giftVouchers');
const { createMyShilohRouter } = require('../../src/routes/myShiloh');
const { createClientCodeRouter } = require('../../src/routes/clientCodeAuth');

async function voucherRecoveryFixture() {
  const sql = new PGlite();
  await sql.exec(`
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,name text,normalized_mobile text,status text,mobile_verified_at timestamptz);
    CREATE TABLE gift_voucher_settings(singleton boolean,validity_mode text,validity_months integer);
    CREATE TABLE gift_voucher_orders(id bigint PRIMARY KEY,purchaser_crm_v2_client_id bigint,recipient_mobile text,recipient_name text,from_name text,personal_message text,language text,delivery_recipient text,amount numeric,state text,created_at timestamptz DEFAULT NOW());
    CREATE TABLE gift_vouchers(id bigint PRIMARY KEY,order_id bigint,voucher_code text,original_value numeric,balance numeric,state text,issued_at timestamptz DEFAULT NOW(),valid_until date,access_key text,recipient_crm_v2_client_id bigint,recipient_linked_at timestamptz,updated_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_requests(gift_voucher_order_id bigint,request_key text,provider_payment_url text,state text);
    INSERT INTO crm_v2_clients VALUES(101,'Synthetic Client Alpha','27820000001','active',NULL),(102,'Synthetic Client Beta','27820000002','active',NOW());
    INSERT INTO gift_voucher_settings VALUES(TRUE,'no_expiry',NULL);
    INSERT INTO gift_voucher_orders(id,purchaser_crm_v2_client_id,recipient_mobile,recipient_name,from_name,language,delivery_recipient,amount,state)
      VALUES(1,102,'0820000001','Synthetic Client Alpha','Synthetic Sender','en','recipient',500,'paid'),
            (2,102,'0820000001','Synthetic Client Beta','Synthetic Other Sender','en','recipient',900,'paid');
    INSERT INTO gift_vouchers(id,order_id,voucher_code,original_value,balance,state,access_key,recipient_crm_v2_client_id)
      VALUES(1,1,'SV-SYNTHETIC-ALPHA',500,500,'active','synthetic-alpha-access',NULL),
            (2,2,'SV-SYNTHETIC-BETA',900,900,'active','synthetic-beta-access',102);
  `);
  const state = { clientId: 101, codeEnabled: true, beginCalls: 0, voucherCalls: 0, csrfRotations: 0, errors: [], forceError: null };
  const db = { query: async (text, values = []) => {
    const result = await sql.query(text, values);
    return { ...result, rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length };
  } };
  const sessions = {
    validateSessionToken: async token => token === 'S'.repeat(43)
      ? { ok: true, sessionId: 1001, crmV2ClientId: state.clientId, authMethod: 'passkey' } : { ok: false },
    rotateCsrfToken: async () => { state.csrfRotations++; return { ok: true, csrfToken: 'synthetic-csrf' }; },
    validateCsrfToken: () => true,
  };
  const vouchers = createGiftVoucherService({ db, ozow: { configured: () => false } });
  const app = express();
  // A harmless return target prevents this isolated fixture from invoking the
  // unrelated application services. It is not a production My Shiloh proof.
  app.get('/my-shiloh/', (_req, res) => res.type('html').send('<h1>Synthetic My Shiloh</h1>'));
  app.use(createMyShilohRouter({ env: { NODE_ENV: 'test' }, sessionService: sessions,
    voucherService: { getClientModel: input => {
      state.voucherCalls++;
      if (state.forceError) throw state.forceError;
      return vouchers.getClientModel(input);
    } },
    clientCodeAvailable: () => { if (state.codeEnabled === 'throw') throw Error('Synthetic readiness failure'); return state.codeEnabled; },
  }));
  app.use('/my-shiloh/code-auth', createClientCodeRouter({ enabled: true, sessions,
    service: { enabled: () => state.codeEnabled === true, smsEnabled: () => false,
      codePolicy: () => ({ whatsappCodeTtlSeconds: 900 }),
      admitRequest: async () => true,
      begin: async () => { state.beginCalls++; throw Error('No code may be sent by this fixture'); },
    }, env: { NODE_ENV: 'test' },
  }));
  app.use((error, _req, res, _next) => { state.errors.push(error); res.status(500).json({ error: 'Synthetic genuine-error boundary' }); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { db, state, origin: `http://127.0.0.1:${server.address().port}`,
    headers: { cookie: `shiloh_client_session=${'S'.repeat(43)}` },
    async close() { await new Promise(resolve => server.close(resolve)); await sql.close(); },
  };
}
module.exports = { voucherRecoveryFixture };
