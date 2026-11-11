'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {clientHarness}=require('./helpers/clientCodeHarness');
test('tablet proof shares client reservations but cannot issue a My Shiloh session or consume ordinary proofs',async t=>{
  const h=await clientHarness(t);await h.owner();
  const tablet=h.make({phoneProofOnly:true,tabletProofAllowed:async()=>true,budget:{currency:'ZAR',dailyMinor:1000,whatsappCostMinor:100}});
  const input={...h.context,purpose:'tablet_forms'};
  const ordinary=await h.service.begin(h.context),request=await tablet.begin(input);
  assert.equal((await h.service.begin(input)).ok,false);
  assert.equal((await tablet.begin(h.context)).ok,false);
  assert.deepEqual(await tablet.dispatchOne(),{ok:true,processed:true});
  assert.equal(h.sent.length,1);
  assert.equal((await h.service.verify({...input,request:request.request,code:h.sent[0].code})).ok,false);
  assert.equal((await tablet.verify({...h.context,request:ordinary.request,code:h.sent[0].code})).ok,false);
  const proof=await tablet.verify({...input,request:request.request,code:h.sent[0].code});
  assert.deepEqual(proof,{ok:true,verifiedMobile:h.context.mobile});
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM client_browser_sessions')).rows[0].n,0);
  assert.equal((await tablet.verify({...input,request:request.request,code:h.sent[0].code})).ok,false);
  assert.equal((await tablet.completeRegistration({...h.context,grant:'G'.repeat(43)})).ok,false);
  assert.equal(tablet.smsEnabled(),false);
  // Ordinary worker still claims its own request; the shared cooldown defers it.
  assert.equal((await h.service.dispatchOne()).processed,true);
  assert.equal(h.sent.length,1);
  h.advance(61000);await h.service.dispatchOne();assert.equal(h.sent.length,2);
});
test('tablet proof fails on identity drift and shares the three-code cap across purposes/restarts',async t=>{
  const h=await clientHarness(t);await h.owner();
  const tablet=()=>h.make({phoneProofOnly:true,tabletProofAllowed:async()=>true,budget:{currency:'ZAR',dailyMinor:1000,whatsappCostMinor:100}});
  let service=tablet();const input={...h.context,purpose:'tablet_forms'};
  const request=await service.begin(input);await service.dispatchOne();
  await h.db.query("UPDATE crm_v2_clients SET name='Changed synthetic identity'");
  assert.equal((await service.verify({...input,request:request.request,code:h.sent[0].code})).ok,false);
  for(let i=0;i<3;i++) {h.advance(61000);service=tablet();await service.begin(input);await service.dispatchOne();}
  assert.equal(h.sent.length,3);
});
test('normal and tablet proofs concurrently share the exact monetary bucket across restart and SAST rollover',async t=>{
 const crypto=require('node:crypto'),h=await clientHarness(t),budget={currency:'ZAR',dailyMinor:1000,whatsappCostMinor:100};
 const normal=()=>h.make({budget}),tablet=()=>h.make({budget,phoneProofOnly:true,tabletProofAllowed:async()=>true});
 let a=normal(),b=tablet();
 await Promise.all(Array.from({length:11},(_,i)=>(i%2?a:b).begin({...h.context,purpose:i%2?'continue':'tablet_forms',mobile:'278200000'+String(i+1).padStart(2,'0')})));
 await Promise.all(Array.from({length:11},(_,i)=>(i%2?a:b).dispatchOne()));
 assert.equal(h.sent.length,10);
 const day=new Date(h.now().getTime()+7200000).toISOString().slice(0,10);
 const key=crypto.createHmac('sha256',Buffer.alloc(32,3)).update(JSON.stringify(['my-shiloh-code','client-money-day',day])).digest('hex');
 assert.equal((await h.db.query('SELECT attempts FROM client_code_rates WHERE bucket_key=$1',[key])).rows[0].attempts,1000);
 a=normal();b=tablet();await a.begin({...h.context,purpose:'continue',mobile:'27820000012'});await a.dispatchOne();assert.equal(h.sent.length,10);
 const local=h.now().getTime()+7200000;h.advance(86400000-local%86400000+1);
 await a.begin({...h.context,purpose:'continue',mobile:'27820000013'});await b.begin({...h.context,purpose:'tablet_forms',mobile:'27820000014'});
 await Promise.all([a.dispatchOne(),b.dispatchOne()]);assert.equal(h.sent.length,12);
});
test('tablet proof preserves the reviewed fifteen-minute client code TTL',async t=>{
 const h=await clientHarness(t,{whatsappCodeTtlSeconds:900});await h.owner();
 const service=h.make({phoneProofOnly:true,tabletProofAllowed:async()=>true});
 const input={...h.context,purpose:'tablet_forms'},r=await service.begin(input);await service.dispatchOne();
 assert.equal(h.sent[0].codeTtlSeconds,900);h.advance(6*60*1000);
 assert.deepEqual(await service.verify({...input,request:r.request,code:h.sent[0].code}),{ok:true,verifiedMobile:h.context.mobile});
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM client_browser_sessions')).rows[0].n,0);
});
