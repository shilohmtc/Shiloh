'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGiftVoucherService, GiftVoucherError } = require('../src/services/giftVouchers');
const { renderWorkspaceVoucherPage } = require('../src/presentation/giftVoucherUx');

function principal({ manage = true } = {}) {
  return {
    id:14,
    staff_id:null,
    display_name:'Christel',
    role:'manager',
    business_role:'owner',
    calendar_scope:'all_business',
    service_scope:'all_services',
    permissions:{ 'voucher:view':true, 'voucher:issue':true, 'voucher:redeem':true, 'voucher:manage':manage },
    admin_active:true,
    staff_status:null,
  };
}

function relinkDatabase({ verifiedTarget = true, manage = true, voucherState = 'active' } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows:[] };
      if (sql.includes('calendarAuthorization:principal')) return { rows:[principal({manage})] };
      if (sql.includes('FROM gift_vouchers v') && sql.includes('FOR UPDATE OF v,o')) {
        return { rows:[{
          id:601,
          voucher_code:'SV-ABCDEF123456',
          balance:'400.00',
          state:voucherState,
          valid_until:'2027-11-22',
          recipient_crm_v2_client_id:811,
          order_id:501,
          recipient_name:'Old Recipient',
          recipient_mobile:'0821111111',
        }] };
      }
      if (sql.includes('FROM crm_v2_clients') && sql.includes('normalized_mobile=$1')) {
        return { rows:verifiedTarget ? [{ id:912, name:'New Recipient' }] : [] };
      }
      if (sql.includes('UPDATE gift_voucher_orders')) return { rows:[], rowCount:1 };
      if (sql.includes('UPDATE gift_vouchers')) return { rows:[], rowCount:1 };
      if (sql.includes('INSERT INTO crm_audit_events')) return { rows:[], rowCount:1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { calls.push({ sql:'RELEASE', params:[] }); },
  };
  return { calls, db:{ async connect(){return client;}, async query(sql,params){return client.query(sql,params);} } };
}

test('managed voucher recipient change preserves voucher value and ledger while linking verified target', async () => {
  const fake = relinkDatabase();
  const service = createGiftVoucherService({ db:fake.db });
  const result = await service.changeRecipient({
    adminId:14,
    voucherCode:'sv-abcdef123456',
    recipientName:'New Recipient',
    recipientMobile:'+27 82 222 2222',
    confirmed:true,
  });
  assert.equal(result.status, 'recipient_changed');
  assert.equal(result.linkStatus, 'linked');
  assert.equal(result.recipientMobile, '0822222222');
  const orderUpdate = fake.calls.find(call => call.sql.includes('UPDATE gift_voucher_orders'));
  assert.deepEqual(orderUpdate.params, [501, 'New Recipient', '0822222222']);
  const voucherUpdate = fake.calls.find(call => call.sql.includes('UPDATE gift_vouchers'));
  assert.deepEqual(voucherUpdate.params, [601, 912]);
  assert.equal(fake.calls.some(call => /gift_voucher_ledger_entries/.test(call.sql)), false);
  assert.equal(fake.calls.some(call => /delivery_mobile/.test(call.sql) && /UPDATE/.test(call.sql)), false);
  const audit = fake.calls.find(call => call.sql.includes('gift_voucher.recipient_changed'));
  assert.ok(audit);
  const metadata = JSON.parse(audit.params[2]);
  assert.equal(metadata.fromRecipientName, 'Old Recipient');
  assert.equal(metadata.toRecipientName, 'New Recipient');
  assert.equal(metadata.fromMobileLast4, '1111');
  assert.equal(metadata.toMobileLast4, '2222');
  assert.equal(metadata.fromCrmV2ClientId, 811);
  assert.equal(metadata.toCrmV2ClientId, 912);
});

test('recipient change can wait for future verified My Shiloh identity', async () => {
  const fake = relinkDatabase({ verifiedTarget:false });
  const service = createGiftVoucherService({ db:fake.db });
  const result = await service.changeRecipient({
    adminId:14,
    voucherCode:'SV-ABCDEF123456',
    recipientName:'Future Recipient',
    recipientMobile:'083 333 3333',
    confirmed:true,
  });
  assert.equal(result.linkStatus, 'waiting');
  const voucherUpdate = fake.calls.find(call => call.sql.includes('UPDATE gift_vouchers'));
  assert.deepEqual(voucherUpdate.params, [601, null]);
});

test('recipient change requires manage authority and explicit confirmation', async () => {
  const noConfirm = createGiftVoucherService({ db:relinkDatabase().db });
  await assert.rejects(
    noConfirm.changeRecipient({ adminId:14, voucherCode:'SV-ABCDEF123456', recipientName:'New Recipient', recipientMobile:'0822222222' }),
    error => error instanceof GiftVoucherError && error.code === 'VOUCHER_RECIPIENT_CONFIRMATION_REQUIRED',
  );

  const denied = createGiftVoucherService({ db:relinkDatabase({manage:false}).db });
  await assert.rejects(
    denied.changeRecipient({ adminId:14, voucherCode:'SV-ABCDEF123456', recipientName:'New Recipient', recipientMobile:'0822222222', confirmed:true }),
    error => error instanceof GiftVoucherError && error.httpStatus === 403,
  );
});

test('recipient change refuses redeemed vouchers', async () => {
  const fake = relinkDatabase({ voucherState:'redeemed' });
  const service = createGiftVoucherService({ db:fake.db });
  await assert.rejects(
    service.changeRecipient({ adminId:14, voucherCode:'SV-ABCDEF123456', recipientName:'New Recipient', recipientMobile:'0822222222', confirmed:true }),
    error => error instanceof GiftVoucherError && error.code === 'VOUCHER_NOT_ACTIVE',
  );
  assert.equal(fake.calls.some(call => call.sql.includes('UPDATE gift_voucher_orders')), false);
});

test('Workspace recipient recovery is capability-gated and keeps value history unchanged', () => {
  const model = {
    policy:{configured:true,mode:'fixed_months',months:2},
    authority:{canIssue:true,canRedeem:true,canManage:true},
    vouchers:[{voucher_code:'SV-ABCDEF123456',recipient_name:'Old Recipient',recipient_mobile:'0821111111',recipient_crm_v2_client_id:811,original_value:'500.00',balance:'400.00',valid_until:'2027-11-22',state:'active'}],
    recipientChanges:[{voucher_code:'SV-ABCDEF123456',actor_name:'Christel',created_at:'2026-09-22T18:50:00.000Z',metadata:{fromRecipientName:'First Recipient',toRecipientName:'Old Recipient',fromMobileLast4:'0000',toMobileLast4:'1111',linkStatus:'linked'}}],
  };
  const html = renderWorkspaceVoucherPage({ model, csrfToken:'csrf', displayName:'Christel' });
  assert.match(html, /Change recipient/);
  assert.match(html, /I confirm that I want to change who this voucher is linked to/);
  assert.match(html, /voucher code, balance and redemption history stay the same/i);
  assert.match(html, /Recent recipient changes/);
  assert.match(html, /First Recipient/);
  assert.match(html, /••••1111/);

  const denied = renderWorkspaceVoucherPage({ model:{...model,authority:{canIssue:true,canRedeem:true,canManage:false}},csrfToken:'csrf' });
  assert.doesNotMatch(denied, /Change voucher recipient/);
  assert.doesNotMatch(denied, /Recent recipient changes/);
});

test('Workspace route and browser client preserve session, same-origin, CSRF and explicit confirmation guards', () => {
  const root = path.join(__dirname, '..');
  const route = fs.readFileSync(path.join(root,'src','routes','workspaceGiftVouchers.js'),'utf8');
  const script = fs.readFileSync(path.join(root,'public','workspace','gift-vouchers.js'),'utf8');
  assert.match(route, /router\.post\('\/recipient',sameOrigin,requireSession,requireCsrf/);
  assert.match(script, /\/calendar\/vouchers\/recipient/);
  assert.match(script, /confirmed:data\.confirmed === 'true'/);
  assert.match(script, /data-recipient-change/);
});
