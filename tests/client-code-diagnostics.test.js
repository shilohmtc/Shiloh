'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {clientHarness}=require('./helpers/clientCodeHarness');

test('delivery diagnostics classify synthetic failures without leaking request data or changing outcomes',async t=>{
  const scenarios=[
    ['provider_accepted',{},'ready'],
    ['provider_not_sent',{outcome:'not_sent'},'not_sent'],
    ['provider_result_uncertain',{outcome:'uncertain'},'uncertain'],
    ['provider_exception_uncertain',{deliver:async()=>{throw Error('SECRET phone OTP payload');}},'uncertain'],
    ['provider_readiness',{readiness:async()=>({ready:false,reason:'SECRET'})},'not_sent'],
    ['provider_readiness',{readiness:async()=>({ready:true,codeTtlSeconds:900})},'not_sent'],
    ['readiness_or_record_unavailable',{readiness:async()=>{throw Error('SECRET');}},'not_sent'],
    ['request_state_or_timing',{advance:241000},'not_sent'],
    ['identity_ineligible',{identity:async()=>({verified:false})},'not_sent'],
    ['previous_delivery_uncertain',{uncertain:async()=>true},'not_sent'],
    ['resend_deferred',{rateUntil:async()=>new Date(Date.now()+60000)},'queued'],
    ['limits_or_budget',{takeRate:async()=>false},'not_sent'],
  ];
  for(const [reason,options,state] of scenarios)await t.test(reason,async t=>{
    const h=await clientHarness(t);await h.owner();const events=[];
    const delivery={audience:'client',configured:()=>true,readiness:options.readiness|| (async()=>({ready:true,codeTtlSeconds:300})),
      deliver:options.deliver|| (async()=>options.outcome?{ok:false,outcome:options.outcome,raw:'SECRET'}:{ok:true,providerMessageId:'wamid.synthetic',raw:'SECRET'})};
    const service=h.make({delivery,onDiagnostic:event=>events.push(event)});
    const response=await service.begin(h.context);
    assert.deepEqual(Object.keys(response).sort(),['accepted','ok','request']);
    if(options.advance)h.advance(options.advance);
    // Override only the dispatch phase; intake reservations remain real.
    const store={transaction:fn=>h.store.transaction(tx=>fn({...tx,...Object.fromEntries(['identity','uncertain','rateUntil','takeRate'].filter(k=>options[k]).map(k=>[k,options[k]]))}))};
    const dispatch=h.make({delivery,store,onDiagnostic:event=>events.push(event)});
    assert.deepEqual(await dispatch.dispatchOne(),{ok:true,processed:true});
    assert.deepEqual(events,[{event:'client_code_delivery_diagnostic',reason}]);
    const rows=await h.db.query('SELECT payload FROM client_code_records');
    assert.equal(rows.rows[0].payload.state,state);
    const serialized=JSON.stringify(events);
    for(const secret of ['SECRET',h.context.mobile,h.context.browserToken,response.request,rows.rows[0].payload.hash])assert.equal(serialized.includes(secret),false);
    assert.equal(h.sent.length,0);assert.equal(h.sms.length,0);
  });
});

test('diagnostic logger failure cannot turn provider acceptance into an authentication failure',async t=>{
  const h=await clientHarness(t);await h.owner();
  const service=h.make({onDiagnostic:()=>{throw Error('logger unavailable');}});
  await service.begin(h.context);
  assert.deepEqual(await service.dispatchOne(),{ok:true,processed:true});
  assert.equal((await h.db.query('SELECT payload FROM client_code_records')).rows[0].payload.state,'ready');
});
