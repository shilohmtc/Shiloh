'use strict';
// Synthetic clocks, provider responses and isolated databases only.
const test=require('node:test'),assert=require('node:assert/strict');
const {clientHarness}=require('./helpers/clientCodeHarness');
const {inspectWorkspaceTemplate}=require('../src/services/workspaceWhatsAppTemplate');
const {clientCodeScript}=require('../src/presentation/clientCodeUx');
const pinned=require('../src/config/clientWhatsAppManifest.json');
function contract(){const t=structuredClone(pinned.template);t.id='900000001';t.name='synthetic_client_fifteen';t.components[1]={type:'FOOTER',text:'Expires in 15 minutes.',code_expiration_minutes:15};t.components[2].buttons[0].url=t.components[2].buttons[0].url.replace('minutes=5','minutes=15');t.components[2].buttons[0].example=t.components[2].buttons[0].example.map(x=>x.replace('minutes=5','minutes=15'));return t;}
test('client validity is separate from delivery TTL; Workspace requires explicit fifteen-minute selection',()=>{
 const c=contract(),inspect=(r=c,a=r)=>inspectWorkspaceTemplate({reviewed:r,inventory:[a],wabaId:r.wabaId,expectedName:r.name,expectedCodeTtlSeconds:900});
 for(const ttl of [30,300,600,900]){const r={...c,message_send_ttl_seconds:ttl};assert.equal(inspect(r).codeTtlSeconds,900);}
 for(const ttl of [29,901,1800])assert.equal(inspect({...c,message_send_ttl_seconds:ttl}).ready,false);
 for(const change of [{status:'PENDING'},{language:'en_GB'},{id:'900000002'}])assert.equal(inspect(c,{...c,...change}).ready,false);
 const bad=contract();bad.components[2].buttons[0].url=bad.components[2].buttons[0].url.replace('minutes=15','minutes=5');assert.equal(inspect(bad).ready,false);
 const staff={...c,name:'shiloh_workspace_verification'};assert.equal(inspect(staff).ready,true);assert.equal(inspectWorkspaceTemplate({reviewed:staff,inventory:[staff],wabaId:staff.wabaId}).ready,false);
 assert.equal(inspectWorkspaceTemplate({reviewed:pinned.template,inventory:[pinned.template],wabaId:pinned.wabaId,expectedName:pinned.template.name,expectedCodeTtlSeconds:900}).codeTtlSeconds,900);
 const legacy=structuredClone(pinned.template);legacy.components[1]={type:'FOOTER',text:'Expires in 5 minutes.',code_expiration_minutes:5};legacy.components[2].buttons[0].url=legacy.components[2].buttons[0].url.replace('minutes=15','minutes=5');legacy.components[2].buttons[0].example=legacy.components[2].buttons[0].example.map(x=>x.replace('minutes=15','minutes=5'));legacy.message_send_ttl_seconds=300;
 assert.equal(inspectWorkspaceTemplate({reviewed:legacy,inventory:[legacy],wabaId:pinned.wabaId,expectedName:legacy.name}).codeTtlSeconds,300);
 assert.match(clientCodeScript({whatsappCodeTtlSeconds:900}),/expire after 15 minutes/);assert.match(clientCodeScript(),/expire after five minutes/);
});
for(const elapsed of [301000,601000,899999,900000])test(`fifteen-minute deadline/storage boundary at ${elapsed}ms`,async t=>{
 const h=await clientHarness(t,{whatsappCodeTtlSeconds:900});await h.owner();const r=await h.service.begin(h.context);await h.service.dispatchOne();assert.equal(h.sent[0].codeTtlSeconds,900);h.advance(elapsed);
 await h.service.dispatchOne();const proof=await h.service.verify({...h.context,request:r.request,code:h.sent[0].code});assert.equal(proof.ok,elapsed<900000);
 if(proof.ok){assert.equal((await h.service.verify({...h.context,request:r.request,code:h.sent[0].code})).ok,false);const s=await h.sessions.validateSessionToken(proof.sessionToken);assert.equal(new Date(proof.expiresAt)-new Date(s.issuedAt),30*86400000);}
});
test('fifteen-minute codes retain cooldown, three daily sends, revocation, browser binding and five attempts',async t=>{
 const h=await clientHarness(t,{whatsappCodeTtlSeconds:900});await h.owner();let previous;
 for(let i=0;i<4;i++){
  const r=await h.make().begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,Math.min(i+1,3));
  if(i===0){await h.make().begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,1);}
  if(previous&&i<3)assert.equal((await h.service.verify({...h.context,request:previous.request,code:previous.code})).ok,false);
  if(i<3)previous={request:r.request,code:h.sent.at(-1).code};h.advance(60000);
 }
 assert.equal((await h.service.verify({...h.context,request:previous.request,code:previous.code,browserToken:'Z'.repeat(43)})).ok,false);
 assert.equal((await h.service.verify({...h.context,request:previous.request,code:previous.code,purpose:'register'})).ok,false);
 for(let i=0;i<5;i++)assert.equal((await h.service.verify({...h.context,request:previous.request,code:'wrong'})).ok,false);
 assert.equal((await h.service.verify({...h.context,request:previous.request,code:previous.code})).ok,false);
});
test('uncertain fifteen-minute delivery blocks another send; dormant SMS validity stays five minutes',async t=>{
 const h=await clientHarness(t,{whatsappCodeTtlSeconds:900});await h.owner();h.outcome('uncertain');const r=await h.service.begin(h.context);await h.service.dispatchOne();h.advance(601000);
 await h.service.requestSmsFallback({...h.context,request:r.request});await h.make().begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,1);assert.equal(h.sms.length,0);
 h.advance(299000);h.outcome('accepted');await h.service.requestSmsFallback({...h.context,request:r.request});await h.service.dispatchOne();assert.equal(h.sms.length,1);assert.equal(h.sms[0].codeTtlSeconds,300);
 h.advance(300000);assert.equal((await h.service.verify({...h.context,request:r.request,code:h.sms[0].code})).ok,false);
});
test('late proof still grants only five minutes for explicit registration',async t=>{
 const h=await clientHarness(t,{whatsappCodeTtlSeconds:900}),input={...h.context,purpose:'continue'},r=await h.service.begin(input);await h.service.dispatchOne();h.advance(899000);
 const proof=await h.service.verify({...input,request:r.request,code:h.sent[0].code});assert.equal(proof.profileRequired,true);h.advance(300000);
 assert.equal((await h.service.completeRegistration({...input,grant:proof.grant,profile:{firstName:'Synthetic',surname:'Client',dateOfBirth:'1990-01-01',gender:'female'}})).ok,false);
});
test('accepted same-origin start refreshes the same anonymous cookie to its existing 30 minutes without session changes',async t=>{
 const express=require('express'),{createClientCodeRouter,BASE}=require('../src/routes/clientCodeAuth');let admitted=true;
 const h=await clientHarness(t,{whatsappCodeTtlSeconds:900}),app=express();app.use(BASE,createClientCodeRouter({enabled:true,service:{...h.service,admitRequest:async()=>admitted},sessions:h.sessions,env:{NODE_ENV:'production'}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const origin=`http://127.0.0.1:${server.address().port}`;
 const page=await fetch(origin+BASE+'/'),cookie=page.headers.get('set-cookie').split(';')[0];assert.match(page.headers.get('set-cookie'),/Max-Age=1800; Secure/);
 const post=(path,body={},extra={})=>fetch(origin+BASE+path,{method:'POST',headers:{Origin:origin.replace('http:','https:'),'X-Forwarded-Proto':'https','Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(body)});
 const start=await post('/start',{mobile:h.context.mobile});assert.equal(start.status,200);assert.equal(start.headers.get('set-cookie'),cookie+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800; Secure');
 assert.equal((await post('/start',{}, {Origin:'https://evil.example'})).headers.get('set-cookie'),null);admitted=false;const limited=await post('/start');assert.equal(limited.status,429);assert.equal(limited.headers.get('set-cookie'),null);
 admitted=true;assert.equal((await post('/verify')).headers.get('set-cookie'),null);
});
test('reviewed fifteen-minute runtime pins provider inventory and signs in after minute ten',async t=>{
 const {createClientCodeRuntime}=require('../src/services/clientCodeRuntime'),h=await clientHarness(t);await h.owner();const config={...pinned,template:contract()},sent=[];
 const runtime=createClientCodeRuntime({enabled:true,config,db:h.db,sessions:h.sessions,hmacKey:Buffer.alloc(32,3),metaCredentials:{accessToken:'synthetic-only'},now:h.now,fetchImpl:async(url,o)=>{
  if(o.method==='GET')return new Response(JSON.stringify({data:url.includes('/phone_numbers')?[{id:config.phoneNumberId}]:[config.template]}));
  const body=JSON.parse(o.body);assert.equal(body.template.name,config.template.name);assert.equal(body.template.language.code,'en');sent.push(body);return new Response(JSON.stringify({messages:[{id:'wamid.synthetic'}]}));
 }});t.after(()=>runtime.stop());assert.equal(runtime.service.enabled(),false);assert.equal((await runtime.prepare()).ok,true);assert.equal(runtime.service.smsEnabled(),false);
 const r=await runtime.service.begin(h.context);await runtime.service.dispatchOne();h.advance(601000);await runtime.service.dispatchOne();
 const proof=await runtime.service.verify({...h.context,request:r.request,code:sent[0].template.components[0].parameters[0].text});assert.equal((await h.sessions.validateSessionToken(proof.sessionToken)).ok,true);
});
test('previously issued five-minute code never gains validity from a newer runtime setting',async t=>{
 const h=await clientHarness(t);await h.owner();const r=await h.service.begin(h.context);await h.service.dispatchOne();h.advance(300000);
 assert.equal((await h.make({whatsappCodeTtlSeconds:900}).verify({...h.context,request:r.request,code:h.sent[0].code})).ok,false);
});
test('client three-code allowance retains the South African calendar-day boundary',async t=>{
 const h=await clientHarness(t,{whatsappCodeTtlSeconds:900});await h.owner();
 for(let i=0;i<4;i++){await h.make().begin(h.context);await h.make().dispatchOne();h.advance(60000);}assert.equal(h.sent.length,3);
 const shifted=new Date(h.now().getTime()+7200000),end=new Date(shifted);end.setUTCHours(24,0,0,0);h.advance(end-shifted+60000);
 await h.make().begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,4);
});
