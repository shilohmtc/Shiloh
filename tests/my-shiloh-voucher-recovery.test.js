'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GiftVoucherError } = require('../src/services/giftVouchers');
const { voucherRecoveryFixture } = require('./helpers/voucherRecoveryFixture');

test('real voucher SQL and mounted route preserve active-profile/mobile guards and private recovery without logout', async t => {
  const f = await voucherRecoveryFixture(); t.after(f.close);
  const read = () => fetch(`${f.origin}/my-shiloh/gift-vouchers?client=102`, { headers: f.headers });
  for (const profile of ['unverified', 'inactive', 'missing', 'invalid_mobile']) {
    f.state.clientId = profile === 'missing' ? 999 : 101;
    await f.db.query("UPDATE crm_v2_clients SET status=$1,mobile_verified_at=$2,normalized_mobile=$3 WHERE id=101", [
      profile === 'inactive' ? 'archived' : 'active',
      profile === 'invalid_mobile' ? new Date().toISOString() : null,
      profile === 'invalid_mobile' ? 'invalid' : '27820000001',
    ]);
    const response = await read(), html = await response.text();
    assert.equal(response.status, profile === 'invalid_mobile' ? 409 : 401);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.equal(response.headers.get('pragma'), 'no-cache');
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(html, /data-voucher-recovery/);
    assert.match(html, /Back to My Shiloh/);
    assert.doesNotMatch(html, /SV-SYNTHETIC|synthetic-alpha-access|synthetic-beta-access|Synthetic Client|<script|<form|csrf/);
    assert.equal((await f.db.query('SELECT recipient_crm_v2_client_id FROM gift_vouchers WHERE id=1')).rows[0].recipient_crm_v2_client_id, null);
  }
  assert.equal(f.state.beginCalls, 0);
  assert.equal(f.state.errors.length, 0);
  assert.equal(f.state.csrfRotations, 4);
});

test('verification link follows strict runtime readiness, opens the actual entry route, and sends no code', async t => {
  const f = await voucherRecoveryFixture(); t.after(f.close);
  for (const available of [false, 'throw', 1, true]) {
    f.state.codeEnabled = available;
    const r = await fetch(`${f.origin}/my-shiloh/gift-vouchers`, { headers: f.headers });
    assert.equal(r.status, 401);
    const html = await r.text();
    assert.equal(html.includes('href="/my-shiloh/code-auth/"'), available === true);
    const entry = await fetch(`${f.origin}/my-shiloh/code-auth/`, { headers: f.headers });
    assert.equal(entry.status, available === true ? 200 : 404);
    if (available === true) assert.match(await entry.text(), /Continue with WhatsApp/);
  }
  assert.equal(f.state.beginCalls, 0);
  assert.equal((await f.db.query('SELECT mobile_verified_at FROM crm_v2_clients WHERE id=101')).rows[0].mobile_verified_at, null);
});

test('verified recipient keeps the existing wallet and cannot take a voucher already linked to someone else', async t => {
  const f = await voucherRecoveryFixture(); t.after(f.close);
  await f.db.query('UPDATE crm_v2_clients SET mobile_verified_at=NOW() WHERE id=101');
  const r = await fetch(`${f.origin}/my-shiloh/gift-vouchers`, { headers: f.headers });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /SV-SYNTHETIC-ALPHA/);
  assert.doesNotMatch(html, /SV-SYNTHETIC-BETA|synthetic-beta-access|data-voucher-recovery/);
  assert.equal(Number((await f.db.query('SELECT recipient_crm_v2_client_id FROM gift_vouchers WHERE id=2')).rows[0].recipient_crm_v2_client_id), 102);
});

test('unexpected errors and server failures still reach the genuine error boundary; known profile404 retains its status', async t => {
  const f = await voucherRecoveryFixture(); t.after(f.close);
  for (const error of [Error('Synthetic database failure'), new GiftVoucherError('VOUCHER_CLIENT_REQUIRED', 'Synthetic server failure', 500),
    new GiftVoucherError('VOUCHER_UNEXPECTED', 'Synthetic unexpected error', 503), Object.assign(Error('Synthetic duck type'), { code: 'VOUCHER_CLIENT_REQUIRED', httpStatus: 401 })]) {
    f.state.forceError = error;
    const r = await fetch(`${f.origin}/my-shiloh/gift-vouchers`, { headers: f.headers });
    assert.equal(r.status, 500);
    assert.equal(f.state.errors.at(-1), error);
    assert.doesNotMatch(await r.text(), /data-voucher-recovery/);
  }
  f.state.forceError = new GiftVoucherError('VOUCHER_CLIENT_REQUIRED', 'Synthetic unavailable profile', 404);
  const r = await fetch(`${f.origin}/my-shiloh/gift-vouchers`, { headers: f.headers });
  assert.equal(r.status, 404);
  assert.match(await r.text(), /data-voucher-recovery/);
  const previous = f.state.voucherCalls;
  const unauthenticated = await fetch(`${f.origin}/my-shiloh/gift-vouchers`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(f.state.voucherCalls, previous);
});
