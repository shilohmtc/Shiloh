'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {rewardAmount,money}=require('../src/services/shilohRewards');
const {renderClientRewardsPage,renderWorkspaceRewardsPage}=require('../src/presentation/shilohRewardsUx');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'migrations/140_shiloh_rewards_wallet.sql'),'utf8');
const service=fs.readFileSync(path.join(root,'src/services/shilohRewards.js'),'utf8');
const payments=fs.readFileSync(path.join(root,'src/services/bookingPayments.js'),'utf8');

test('Shiloh Rewards has one immutable Rand wallet authority with the agreed defaults',()=>{
  assert.match(migration,/earn_basis_points INTEGER NOT NULL DEFAULT 500/);
  assert.match(migration,/unlock_threshold NUMERIC\(12,2\) NOT NULL DEFAULT 100\.00/);
  assert.match(migration,/expiry_mode TEXT NOT NULL DEFAULT 'no_expiry'/);
  assert.match(migration,/loyalty_wallet_entries/);
  assert.match(migration,/operation_key TEXT NOT NULL UNIQUE/);
  assert.match(migration,/Retired fifth-visit loyalty history/);
  assert.doesNotMatch(migration,/UPDATE loyalty_rewards SET status/);
});

test('earning uses exact Rand precision',()=>{
  assert.equal(rewardAmount('650.00',500),'32.50');
  assert.equal(rewardAmount('499.99',500),'25.00');
  assert.equal(money('100'),'100.00');
  assert.throws(()=>money('10.001'));
});

test('rewards only accrue from payment evidence after completed treatment and reverse refunds',()=>{
  assert.match(service,/ple\.created_at>=cfg\.activated_at/);
  assert.match(service,/a\.status='completed'/);
  assert.match(service,/row\.entry_type==='refund'/);
  assert.match(service,/earn_reversal/);
  assert.match(service,/Automatic return after booking cancellation/);
  assert.match(payments,/payer_crm_v2_client_id/);
  assert.match(payments,/resolveRefundPayer/);
  assert.match(payments,/Choose which payer is receiving this refund so their rewards stay accurate/);
  assert.doesNotMatch(service,/gift_voucher_orders/);
});

test('client redemption requires unlock, ownership, balance and explicit secure actor',()=>{
  assert.match(service,/position\.balance<config\.unlockThreshold/);
  assert.match(service,/REWARDS_BOOKING_FORBIDDEN/);
  assert.match(service,/REWARDS_EXCEEDS_BALANCE/);
  assert.match(service,/applied_by_client_session_id/);
  assert.match(service,/clientConfirmed/);
});

test('My Shiloh shows locked and unlocked reward states in plain language',()=>{
  const common={client:{id:1,name:'Christel'},policy:{earnRate:5,unlockThreshold:100},entries:[],appointments:[]};
  const locked=renderClientRewardsPage({model:{...common,wallet:{balance:40,unlocked:false}},csrfToken:'csrf'});
  assert.match(locked,/R\s*60[,.]00 to go/);
  assert.match(locked,/5% of every completed, paid treatment/);
  assert.match(locked,/disabled/);
  const open=renderClientRewardsPage({model:{...common,wallet:{balance:120,unlocked:true},appointments:[{id:7,starts_at:'2026-10-01T08:00:00Z',total_price:'650',service_name:'Massage'}]},csrfToken:'csrf'});
  assert.match(open,/Ready whenever you choose/);
  assert.match(open,/Use rewards/);
});

test('Workspace adjustment keeps the note optional',()=>{
  const html=renderWorkspaceRewardsPage({model:{policy:{earnRate:5,unlockThreshold:100},authority:{canManage:true},wallets:[]},csrfToken:'csrf',displayName:'Christel'});
  assert.match(html,/goodwill reward or correction/);
  assert.match(html,/Note <span class="muted">\(optional\)<\/span>/);
  assert.doesNotMatch(html,/name="notes"[^>]*required/);
});
