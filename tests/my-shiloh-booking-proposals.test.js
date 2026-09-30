'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMyShilohRouter } = require('../src/routes/myShiloh');
const { BookingRequestError } = require('../src/services/clientBookingApproval');

test('proposal endpoint binds responses to the verified session and requires origin and CSRF', async (t) => {
  const calls = [];
  const service = {
    async validateSessionToken(token) { return token === 'session' ? {ok:true,crmV2ClientId:55,sessionId:8} : {ok:false}; },
    validateCsrfToken(_session, supplied) { return supplied === 'csrf'; },
  };
  const app=express();app.use(express.json());
  app.use(createMyShilohRouter({env:{NODE_ENV:'test'},sessionService:service,proposalService:{
    async acceptProposedAlternative(input) { calls.push(input);return {status:'approved',reply:'Deposit remains required.'}; },
    async requestAnotherOption(input) { calls.push(input);throw new BookingRequestError('BOOKING_PROPOSAL_STALE','That option is no longer active.',409); },
  }}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.address().port}`;
  const send=(payload={}, headers={})=>fetch(`${origin}/my-shiloh/api/booking-proposals/respond`,{
    method:'POST',headers:{'content-type':'application/json',origin,cookie:'shiloh_client_session=session','x-shiloh-csrf-token':'csrf',...headers},
    body:JSON.stringify({appointmentId:901,proposalVersion:4,action:'accept',crmV2ClientId:999,sender:'27820000000',...payload}),
  });
  assert.equal((await send({}, {cookie:''})).status,401);
  assert.equal((await send({}, {'x-shiloh-csrf-token':'wrong'})).status,403);
  assert.equal((await send({}, {origin:'https://unrelated.invalid'})).status,403);
  assert.equal((await send({action:'cancel'})).status,400);
  assert.equal(calls.length,0);
  const accepted=await send();assert.equal(accepted.status,200);
  assert.match(accepted.headers.get('cache-control'),/no-store/);
  assert.deepEqual(calls[0],{appointmentId:901,proposalVersion:4,crmV2ClientId:55});
  const stale=await send({action:'another'});assert.equal(stale.status,409);
  assert.equal((await stale.json()).code,'BOOKING_PROPOSAL_STALE');
});
