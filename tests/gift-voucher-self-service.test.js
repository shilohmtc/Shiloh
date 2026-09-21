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

test('client voucher page is policy gated and includes optional direct recipient delivery', () => {
  const html = renderClientVoucherPage({ model:{client:{name:'Christel'},policy:{configured:false,mode:null,months:null},ozowConfigured:true,orders:[]},csrfToken:'csrf-token' });
  assert.match(html, /Who is it for/);
  assert.match(html, /The recipient/);
  assert.match(html, /Recipient’s WhatsApp number/);
  assert.match(html, /validity policy/);
  assert.match(html, /type="submit" disabled/);
});

test('issued voucher renders approved language artwork and private value state', () => {
  const html = renderPublicVoucherPage({ voucher:{recipient_name:'Naledi',from_name:'Christel',personal_message:'Rest well',language:'af',amount:'600.00',voucher_code:'SV-ABCDEF123456',balance:'400.00',state:'active',valid_until:'2027-09-19'} });
  assert.match(html, /voucher-af\.jpeg/);
  assert.match(html, /Naledi/);
  assert.match(html, /SV-ABCDEF123456/);
  assert.match(html, /R/);
  assert.match(html, /Rest well/);
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
  const html = renderWorkspaceVoucherPage({model:{policy:{configured:true,mode:'fixed_months',months:12},authority:{canManage:true,canRedeem:true},vouchers:[]},csrfToken:'csrf',displayName:'Christel'});
  assert.match(html, /Voucher validity/);
  assert.match(html, /Fixed number of months/);
  assert.match(html, /Redeem voucher/);
  assert.match(html, /No vouchers have been issued yet/);
});

test('Ozow verified callback owns voucher issuance and no unverified return page can issue', () => {
  const payments = fs.readFileSync(path.join(root, 'src/services/bookingPayments.js'), 'utf8');
  const returns = fs.readFileSync(path.join(root, 'src/routes/paymentReturns.js'), 'utf8');
  assert.match(payments, /issueVerifiedVoucher/);
  assert.match(payments, /verifyNotification/);
  assert.doesNotMatch(returns, /issueVerifiedVoucher/);
});
