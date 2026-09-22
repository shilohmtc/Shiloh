'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { voucherAmount, voucherCode } = require('../src/services/giftVouchers');
const { formatVoucherDate, voucherExpiryTimestamp } = require('../src/lib/voucherDate');
const { renderClientVoucherPage, renderPublicVoucherPage, renderWorkspaceVoucherPage } = require('../src/presentation/giftVoucherUx');

const root = path.join(__dirname, '..');

test('voucher schema keeps issuance and value evidence separate from booking payment truth', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations/139_gift_voucher_self_service.sql'), 'utf8');
  assert.match(sql, /payment_requests_one_subject/);
  assert.match(sql, /gift_voucher_ledger_entries/);
  assert.match(sql, /validity_mode IS NULL/);
  assert.match(sql, /voucher:redeem/);
  assert.doesNotMatch(sql, /UPDATE appointments|UPDATE appointment_groups/);
});

test('voucher values use exact Rand precision and stable non-sequential codes', () => {
  assert.equal(voucherAmount('550.5'), '550.50');
  assert.throws(() => voucherAmount('0'));
  assert.throws(() => voucherAmount('1.001'));
  assert.match(voucherCode('voucher_request_key_1234567890'), /^SV-[A-F0-9]{12}$/);
  assert.equal(voucherCode('same-key'), voucherCode('same-key'));
});

test('client voucher page requires recipient identity while preserving delivery choice', () => {
  const html = renderClientVoucherPage({ model:{client:{name:'Christel'},policy:{configured:false,mode:null,months:null},ozowConfigured:true,receivedVouchers:[],orders:[]},csrfToken:'csrf-token' });
  assert.match(html, /Recipient’s name and surname/);
  assert.match(html, /Recipient’s mobile number/);
  assert.match(html, /links the voucher to the recipient’s My Shiloh profile/i);
  assert.match(html, /name="recipientMobile"/);
  assert.match(html, /aria-describedby="recipientMobileHelp"/);
  assert.match(html, /The recipient/);
  assert.match(html, /validity policy/);
  assert.match(html, /type="submit" disabled/);
});

test('client voucher page separates vouchers linked to the recipient from vouchers they bought', () => {
  const html = renderClientVoucherPage({
    model:{
      client:{name:'Evelyn'},
      policy:{configured:true,mode:'fixed_months',months:2},
      ozowConfigured:true,
      receivedVouchers:[{voucher_code:'SV-RECIPIENT123',balance:'900.00',voucher_state:'active',from_name:'Tinkie',voucherPath:'/gift-vouchers/recipient-key'}],
      orders:[{recipient_name:'Naledi',amount:'500.00',state:'awaiting_payment',payment_state:'created'}],
    },
    csrfToken:'csrf-token',
  });
  assert.match(html, /Vouchers for you/);
  assert.match(html, /SV-RECIPIENT123/);
  assert.match(html, /From Tinkie/);
  assert.match(html, /Vouchers you bought/);
  assert.match(html, /Naledi/);
});

test('issued voucher renders approved language artwork and private value state', () => {
  const html = renderPublicVoucherPage({ voucher:{recipient_name:'Naledi',from_name:'Christel',personal_message:'Rest well',language:'af',amount:'600.00',voucher_code:'SV-ABCDEF123456',balance:'400.00',state:'active',valid_until:'2027-09-19'} });
  assert.match(html, /voucher-af\.jpeg/);
  assert.match(html, /Naledi/);
  assert.match(html, /SV-ABCDEF123456/);
  assert.match(html, /R/);
  assert.match(html, /Rest well/);
  assert.match(html, /class="voucher-art af"/);
  assert.match(html, /\.voucher-art\.af \.fill\.to\{left:15\.1%\}/);
  assert.match(html, /\.voucher-art\.af \.fill\.from\{left:15\.1%\}/);
  assert.match(html, /\.voucher-art\.af \.fill\.value\{left:35%\}/);
  assert.match(html, /\.voucher-art\.af \.fill\.valid\{left:23\.9%\}/);
  assert.match(html, /\.fill\{position:absolute;transform:translateY\(-\.45em\)/);
});

test('voucher dates support PostgreSQL Date objects without rendering Invalid Date', () => {
  const postgresDate = new Date('2027-09-19T00:00:00.000Z');
  assert.equal(formatVoucherDate(postgresDate), '19 September 2027');
  assert.equal(formatVoucherDate('2027-09-19'), '19 September 2027');
  assert.equal(formatVoucherDate(null), 'No expiry');
  assert.equal(formatVoucherDate('not-a-date'), 'Expiry unavailable');
  assert.equal(voucherExpiryTimestamp(postgresDate), Date.UTC(2027, 8, 19, 23, 59, 59, 999));
  const html = renderPublicVoucherPage({ voucher:{recipient_name:'Naledi',from_name:'Christel',personal_message:'',language:'en',amount:'600.00',voucher_code:'SV-ABCDEF123456',balance:'600.00',state:'active',valid_until:postgresDate} });
  assert.match(html, /19 September 2027/);
  assert.doesNotMatch(html, /Invalid Date/);
});

test('workspace voucher page supports explicit policy and partial redemption', () => {
  const html = renderWorkspaceVoucherPage({model:{policy:{configured:true,mode:'fixed_months',months:12},authority:{canManage:true,canRedeem:true},vouchers:[{voucher_code:'SV-ABCDEF123456',recipient_name:'Naledi',original_value:'600.00',balance:'400.00',valid_until:'2027-09-19',state:'active'}]},csrfToken:'csrf',displayName:'Christel'});
  assert.match(html, /Voucher validity/);
  assert.match(html, /Fixed number of months/);
  assert.match(html, /Redeem voucher/);
  assert.match(html, /data-voucher-select/);
  assert.match(html, /data-voucher-code="SV-ABCDEF123456"/);
  assert.match(html, /data-label="Valid until"/);
  assert.ok(html.indexOf('Issued vouchers') < html.indexOf('Voucher validity'));
  assert.ok(html.indexOf('Issued vouchers') < html.indexOf('Redeem a voucher'));
  assert.doesNotMatch(html, /table\{display:block;overflow-x:auto\}/);
});

test('workspace voucher page keeps an accessible empty issued-voucher state', () => {
  const html = renderWorkspaceVoucherPage({model:{policy:{configured:true,mode:'no_expiry',months:null},authority:{canManage:false,canRedeem:true},vouchers:[]},csrfToken:'csrf'});
  assert.match(html, /No vouchers have been issued yet/);
  assert.match(html, /aria-live="polite" data-voucher-selection-status/);
});

test('workspace voucher client selects a code and guides staff to the amount', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'workspace', 'gift-vouchers.js'), 'utf8');
  assert.match(script, /closest\('\[data-voucher-select\]'\)/);
  assert.match(script, /codeInput\.value = code/);
  assert.match(script, /amountInput\.max = selection\.dataset\.voucherBalance/);
  assert.match(script, /amountInput\.focus\(\{ preventScroll:true \}\)/);
  assert.match(script, /scrollIntoView/);
});

test('Ozow verified callback owns voucher issuance and no unverified return page can issue', () => {
  const payments = fs.readFileSync(path.join(root, 'src/services/bookingPayments.js'), 'utf8');
  const returns = fs.readFileSync(path.join(root, 'src/routes/paymentReturns.js'), 'utf8');
  assert.match(payments, /issueVerifiedVoucher/);
  assert.match(payments, /verifyNotification/);
  assert.doesNotMatch(returns, /issueVerifiedVoucher/);
});
