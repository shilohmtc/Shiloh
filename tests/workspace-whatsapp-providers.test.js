'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createWorkspaceMetaProvider,createWorkspaceSmsProvider,createBoundedJsonRequest} = require('../src/services/workspaceWhatsAppProviders');
const {createWorkspaceWhatsAppWorker,createWorkspaceWhatsAppRuntime} = require('../src/services/workspaceWhatsAppRuntime');
const template = {id:'123',wabaId:'456',name:'shiloh_workspace_verification',language:'en_GB',category:'AUTHENTICATION',message_send_ttl_seconds:300,
  components:[{type:'BODY',text:'{{1}} is your verification code. For your security, do not share this code.',add_security_recommendation:true},
    {type:'FOOTER',code_expiration_minutes:5},{type:'BUTTONS',buttons:[{type:'URL',otp_type:'COPY_CODE',text:'Copy code',url:'https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}'}]}]};
const response = (body,status = 200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function metaFixture(overrides = {}) {
  const calls = [];
  const provider = createWorkspaceMetaProvider({enabled:true,reviewed:template,wabaId:'456',phoneNumberId:'789',apiVersion:'v99.0',accessToken:'synthetic-token',
    fetchImpl:async (url,options) => {calls.push({url,options});
      if (url.includes('/phone_numbers?')) return response({data:[{id:'789'}]});
      if (url.includes('/message_templates?')) return response({data:[{...template,status:'APPROVED'}]});
      return response({messages:[{id:'wamid.synthetic'}]});
    },...overrides});
  return {provider,calls};
}

test('Meta adapter pins explicit version, account/sender, exact locale and payload; no redirect or token URL',async()=>{
  const f = metaFixture(); const result = await f.provider.deliver({mobile:'27820000001',code:'123456',codeTtlSeconds:300});
  assert.equal(result.ok,true);assert.equal(f.calls.length,3);
  for (const {url,options} of f.calls) {assert.equal(new URL(url).origin,'https://graph.facebook.com');assert.match(new URL(url).pathname,/^\/v99\.0\//);assert.ok(!url.includes('synthetic-token'));assert.equal(options.redirect,'error');}
  const sent=JSON.parse(f.calls[2].options.body);assert.equal(sent.template.language.code,'en_GB');
  assert.equal(sent.template.components[0].parameters[0].text,'123456');assert.equal(sent.template.components[1].parameters[0].text,'123456');
});

test('missing configuration, wrong sender, pagination, locale and component drift fail before send',async()=>{
  for (const overrides of [{enabled:false},{apiVersion:undefined},{accessToken:undefined},{phoneNumberId:'https://evil.invalid'},
    {reviewed:{...template,language:undefined}},{reviewed:{...template,components:undefined}}]) {
    const f=metaFixture(overrides);assert.equal((await f.provider.deliver({})).outcome,'not_sent');assert.equal(f.calls.length,0);
  }
  for (const body of [{data:[{id:'wrong'}]},{data:[{id:'789'}],paging:{next:'https://evil.invalid'}}]) {
    const calls=[];const f=metaFixture({fetchImpl:async(url)=>{calls.push(url);return response(body);}});
    assert.equal((await f.provider.deliver({mobile:'27820000001',code:'123456',codeTtlSeconds:300})).outcome,'not_sent');assert.equal(calls.length,1);
  }
  for (const change of [{language:'en_US'},{components:[]},{status:'PAUSED'}]) {
    let sends=0;const f=metaFixture({fetchImpl:async url=>{if(url.includes('/phone_numbers?'))return response({data:[{id:'789'}]});if(url.includes('/message_templates?'))return response({data:[{...template,status:'APPROVED',...change}]});sends++;return response({});}});
    assert.equal((await f.provider.deliver({mobile:'27820000001',code:'123456',codeTtlSeconds:300})).outcome,'not_sent');assert.equal(sends,0);
  }
});

test('bounded transport stops redirects, oversized/malformed bodies and hung fetch/body with sanitized errors',async()=>{
  for (const fetchImpl of [async()=>new Response('',{status:302}),async()=>new Response('x'.repeat(300)),async()=>new Response('not-json'),
    async()=>{throw Error('synthetic-token 123456 27820000001');},()=>new Promise(()=>{}),
    async()=>new Response(new ReadableStream({start(){}}))]) {
    const request=createBoundedJsonRequest({fetchImpl,timeoutMs:20,maxBytes:200});
    await assert.rejects(request('https://example.invalid',{}),e=>e.message==='Provider unavailable');
  }
});

test('a started Meta send with an error, missing id or timeout is uncertain and never retried',async()=>{
  for (const send of [()=>response({error:{message:'synthetic-token'}},400),()=>response({}),()=>new Promise(()=>{})]) {
    let sends=0;const f=metaFixture({timeoutMs:30,fetchImpl:async url=>{
      if(url.includes('/phone_numbers?'))return response({data:[{id:'789'}]});
      if(url.includes('/message_templates?'))return response({data:[{...template,status:'APPROVED'}]});sends++;return send();}});
    assert.deepEqual(await f.provider.deliver({mobile:'27820000001',code:'123456',codeTtlSeconds:300}),{ok:false,outcome:'uncertain'});assert.equal(sends,1);
  }
});

test('SMS reuses SMSMessenger with one five-minute Workspace message and no balance probe or retry',async()=>{
  const calls=[];const sms=createWorkspaceSmsProvider({enabled:true,accountEmail:'synthetic@example.invalid',apiToken:'synthetic-token',
    fetchImpl:async(url,options)=>{calls.push({url,options});return response({messageId:'synthetic-1'});}});
  assert.deepEqual(await sms.deliver({mobile:'27820000001',code:'123456',codeTtlSeconds:300}),{ok:true,outcome:'accepted',providerMessageId:'sms.synthetic-1'});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json');
  const body=JSON.parse(calls[0].options.body);assert.match(body.message,/Expires in 5 minutes/);assert.ok(body.message.length<160);assert.equal(body.recipientNumber,'27820000001');
  let attempts=0;const failed=createWorkspaceSmsProvider({enabled:true,accountEmail:'synthetic@example.invalid',apiToken:'synthetic-token',fetchImpl:async()=>{attempts++;return response({error:'synthetic-token'},400);}});
  assert.deepEqual(await failed.deliver({mobile:'27820000001',code:'123456',codeTtlSeconds:300}),{ok:false,outcome:'uncertain'});assert.equal(attempts,1);
});

test('worker is opt-in, bounded, non-overlapping, stoppable and sanitizes failures',async()=>{
  let calls=0, release;
  const service={enabled:()=>true,dispatchOne:async()=>{calls++;return{ok:true,processed:true};}};
  assert.equal((await createWorkspaceWhatsAppWorker({service}).runOnce()).code,'WORKER_DISABLED');assert.equal(calls,0);
  const worker=createWorkspaceWhatsAppWorker({service,enabled:true,batchSize:2,pollMs:100});
  assert.equal((await worker.runOnce()).processed,2);assert.equal(calls,2);
  const controller=new AbortController();controller.abort();assert.equal((await worker.run({signal:controller.signal})).stopped,true);assert.equal(calls,2);
  service.dispatchOne=()=>new Promise(r=>{release=r;});const running=worker.runOnce();
  assert.equal((await worker.runOnce()).code,'WORKER_BUSY');release({ok:true,processed:false});await running;
  service.dispatchOne=async()=>{throw Error('secret');};assert.deepEqual(await worker.runOnce(),{ok:false,code:'WORKER_UNAVAILABLE',processed:0});
});

test('runtime defaults inactive; construction neither queries database nor calls provider',async()=>{
  let calls=0;const runtime=createWorkspaceWhatsAppRuntime({db:{connect(){calls++;},query(){calls++;}},fetchImpl(){calls++;}});
  assert.equal(runtime.service.enabled(),false);assert.equal((await runtime.prepare()).ok,false);assert.equal((await runtime.worker.runOnce()).code,'WORKER_DISABLED');assert.equal(calls,0);
});
