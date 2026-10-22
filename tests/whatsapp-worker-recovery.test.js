'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {createWorkspaceWhatsAppWorker}=require('../src/services/workspaceWhatsAppRuntime');
const {harness}=require('./helpers/workspaceWhatsAppHarness');

test('temporary failures retry with capped backoff, recover without restart, and do not overlap loops',async()=>{
  const controller=new AbortController(),events=[],attempts=[];
  let calls=0,inFlight=0,maximum=0;
  const worker=createWorkspaceWhatsAppWorker({enabled:true,pollMs:100,retryMaxMs:200,
    service:{enabled:()=>true,dispatchOne:async()=>{
      maximum=Math.max(maximum,++inFlight); attempts.push(Date.now());
      try { await delay(5); if(++calls<=4)throw Error('synthetic-token 27820000001'); return {ok:true,processed:false}; }
      finally {inFlight--;}
    }},onStateChange:event=>{events.push(event);if(event.event==='worker_recovered')controller.abort();}});
  const pending=worker.run({signal:controller.signal});
  assert.equal((await worker.run({signal:controller.signal})).code,'WORKER_BUSY');
  assert.deepEqual(await pending,{ok:true,stopped:true});
  assert.equal(calls,5);assert.equal(maximum,1);
  assert.ok(attempts[1]-attempts[0]>=95);assert.ok(attempts[2]-attempts[1]>=195);
  assert.deepEqual(events.map(e=>e.event),['worker_recovering','worker_recovered']);
  assert.equal(events[1].consecutiveFailures,4);assert.equal(worker.status().state,'stopped');
  assert.doesNotMatch(JSON.stringify(events),/synthetic-token|27820000001/);
});

test('shutdown interrupts retry delay immediately; disabled service cannot restart or dispatch',async()=>{
  const controller=new AbortController();let calls=0,enabled=true,recovering;
  const ready=new Promise(r=>{recovering=r;});
  const worker=createWorkspaceWhatsAppWorker({enabled:true,pollMs:1000,
    service:{enabled:()=>enabled,dispatchOne:async()=>{calls++;throw Error('temporary');}},
    onStateChange:event=>{if(event.event==='worker_recovering')recovering();}});
  const pending=worker.run({signal:controller.signal});await ready;
  const before=Date.now();controller.abort();await pending;
  assert.ok(Date.now()-before<500);assert.equal(calls,1);
  enabled=false;assert.equal((await worker.run({signal:new AbortController().signal})).code,'WORKER_DISABLED');
  assert.equal(calls,1);
});

test('losing eligibility during backoff closes worker instead of endlessly retrying or reopening it',async()=>{
  let enabled=true,calls=0;const events=[];
  const worker=createWorkspaceWhatsAppWorker({enabled:true,pollMs:100,
    service:{enabled:()=>enabled,dispatchOne:async()=>{calls++;throw Error('temporary');}},
    onStateChange:event=>{events.push(event);if(event.event==='worker_recovering')enabled=false;}});
  assert.equal((await worker.run({signal:new AbortController().signal})).code,'WORKER_DISABLED');
  assert.equal(calls,1);assert.equal(worker.status().state,'disabled');
  assert.deepEqual(events.map(e=>e.event),['worker_recovering','worker_disabled']);
});

test('diagnostic callback failure cannot turn a temporary queue error into permanent shutdown',async()=>{
  const controller=new AbortController();let calls=0;
  const worker=createWorkspaceWhatsAppWorker({enabled:true,pollMs:100,
    service:{enabled:()=>true,dispatchOne:async()=>{if(++calls===1)return {ok:false};controller.abort();return {ok:true,processed:false};}},
    onStateChange:()=>{throw Error('observer failed');}});
  assert.equal((await worker.run({signal:controller.signal})).ok,true);assert.equal(calls,2);
});

test('SQL recovery after provider acceptance cannot replay claimed message; fresh request still signs in',async t=>{
  const h=await harness(t),first=await h.service.begin(h.context),controller=new AbortController();
  await h.db.query("ALTER TABLE staff_auth_security_events ADD CONSTRAINT test_worker_fail_accepted CHECK(event_type<>'workspace_whatsapp_provider_accepted')");
  let notify,recovered;const failed=new Promise(r=>{notify=r;}),ready=new Promise(r=>{recovered=r;});
  const worker=createWorkspaceWhatsAppWorker({enabled:true,service:h.service,pollMs:100,
    onStateChange:event=>{if(event.event==='worker_recovering')notify();if(event.event==='worker_recovered'){controller.abort();recovered();}}});
  t.after(()=>controller.abort());const pending=worker.run({signal:controller.signal});
  await failed;assert.equal(h.sent.length,1);
  await h.db.query('ALTER TABLE staff_auth_security_events DROP CONSTRAINT test_worker_fail_accepted');
  const secondContext={...h.context,mobile:'27820000002',browserToken:'C'.repeat(43)};
  const second=await h.service.begin(secondContext);assert.equal(second.accepted,true);
  await ready;await pending;assert.equal(h.sent.length,2);
  assert.deepEqual(h.sent.map(s=>s.mobile),['27820000001','27820000002']);
  assert.equal((await h.service.verify({...h.context,request:first.request,code:h.sent[0].code})).ok,false);
  assert.equal((await h.service.verify({...secondContext,request:second.request,code:h.sent[1].code})).ok,true);
  assert.equal((await h.service.dispatchOne()).processed,false);assert.equal(h.sent.length,2);
});
