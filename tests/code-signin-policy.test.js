'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { codeReservationBuckets } = require('../src/services/codeSignInPolicy');
const digest = (...v) => JSON.stringify(v);
const buckets = (audience, channel = 'whatsapp', time = '2026-10-17T21:59:30Z') =>
  codeReservationBuckets({ audience, channel, personKey:'synthetic-person', digest, current:new Date(time) });

test('staff and client sends reserve separate clinic ceilings and shared per-person cooldowns', () => {
  const staff = buckets('staff'), client = buckets('client'), sms = buckets('staff','sms');
  assert.equal(staff[0].limit,10);
  assert.equal(client[0].limit,50);
  assert.equal(client[1].limit,3);
  assert.notEqual(staff[0].key,client[0].key);
  assert.deepEqual(staff,sms.slice(0,3));
  assert.equal(sms[3].limit,2);
  assert.equal(buckets('client','sms')[3].limit,1);
  assert.equal(staff[2].windowMs,60000);
});

test('South African day turns at 22:00 UTC; midnight does not reset resend cooldown', () => {
  const before = buckets('staff'), after = buckets('staff','whatsapp','2026-10-17T22:00:00Z');
  assert.match(before[0].key,/2026-10-17/);
  assert.match(after[0].key,/2026-10-18/);
  assert.equal(before[0].windowMs,30000);
  assert.equal(after[0].windowMs,86400000);
  assert.equal(before[2].key,after[2].key);
});

test('invalid audience, channel, person or time cannot create an unbounded reservation', () => {
  const input = { audience:'staff', channel:'whatsapp', personKey:'synthetic', digest, current:new Date() };
  for (const override of [{audience:'unknown'},{channel:'email'},{personKey:''},{current:new Date('invalid')}]) {
    assert.throws(()=>codeReservationBuckets({...input,...override}));
  }
});
