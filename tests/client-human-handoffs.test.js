'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClientHumanHandoffService } = require('../src/services/clientHumanHandoffs');
const { createMyShilohAssistantService } = require('../src/services/myShilohAssistant');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');

test('human handoff request is client-scoped and idempotent without appointment or message writes', async () => {
  const queries=[];
  const db={ async query(sql,params) {
    queries.push({sql,params});
    if (sql.includes('FROM crm_v2_clients WHERE')) return { rowCount:1,rows:[{id:22}] };
    if (sql.includes('INSERT INTO client_human_handoffs')) return { rowCount:0,rows:[] };
    if (sql.includes('FROM client_human_handoffs') && sql.includes('crm_v2_client_id=$1')) return { rowCount:1,rows:[{id:81}] };
    throw new Error(`Unexpected query ${sql}`);
  } };
  const service=createClientHumanHandoffService({db});
  assert.deepEqual(await service.request(22),{id:81,status:'open',created:false});
  assert.deepEqual(queries[1].params,[22]);
  assert.equal(queries.some(item=>/INSERT INTO (appointments|client_messages|payments)/i.test(item.sql)),false);
  await assert.rejects(service.request(0),{code:'HUMAN_CLIENT_INVALID'});
});

test('only current Reception authority can close the open handoff', async () => {
  const db={ async query(sql,params) {
    assert.match(sql,/WHERE id=\$1 AND status='open'/);
    assert.deepEqual(params,[81,4]);
    return { rowCount:1,rows:[{id:81}] };
  } };
  const service=createClientHumanHandoffService({db});
  await assert.rejects(service.close({principal:{id:9,business_role:'practitioner',calendar_scope:'all_business'},id:81}),{code:'HUMAN_FORBIDDEN'});
  assert.deepEqual(await service.close({principal:{id:4,business_role:'owner',calendar_scope:'all_business'},id:81}),{id:81,status:'closed'});
});

test('WhatsApp pause uses the exact active CRM mobile and preserves staff commands', async () => {
  let checked=false;
  const service=createClientHumanHandoffService({db:{async query(sql,params){
    assert.match(sql,/JOIN crm_v2_clients c/);
    assert.match(sql,/NOT EXISTS \(SELECT 1 FROM staff_admin_accounts/);
    assert.deepEqual(params,['27821234567']);
    checked=true;
    return { rows:[{id:81}] };
  }}});
  assert.equal(await service.activeForPhone('unknown'),null);
  assert.deepEqual(await service.activeForPhone('27821234567'),{id:81});
  assert.equal(checked,true);
});

test('historical open handoffs do not suppress My Shiloh replies or authenticated tools', async () => {
  let reads=0;
  let actions=0;
  const service=createMyShilohAssistantService({
    ai:async(_key,_message,options)=>{
      await options.toolExecutor('read', {});
      await options.toolExecutor('prepare', {});
      return 'Your appointment details are available.';
    },
    contextService:{async getContext(){return {client:{name:'Jane'},version:'v1'};}},
    readTools:{definitions:[],async execute(_name,_args,context){assert.equal(context.crmV2ClientId,22);reads+=1;return {ok:true};}},
    actionTools:{definitions:[],async execute(_name,_args,context){assert.equal(context.crmV2ClientId,22);assert.equal(context.sessionId,2);actions+=1;return {modelResult:{ok:true}};},handles(name){return name==='prepare';}},
    handoffService:{async activeForClient(){throw new Error('Retired handoffs must not be read');}},
  });
  const reply=await service.reply({sessionId:2,crmV2ClientId:22,message:'Hello'});
  assert.equal(reply.reply,'Your appointment details are available.');
  assert.equal(reads,1);
  assert.equal(actions,1);
});

test('signed-in client keeps the assistant and direct Reception link with historical handoffs', () => {
  const html=renderMyShilohPage({client:{id:22,firstName:'Jane'},humanWhatsAppNumber:'27662399138',humanHandoffActive:true});
  assert.match(html,/data-shiloh-chat-form/);
  assert.match(html,/href="https:\/\/wa\.me\/27662399138\?text=[^"]+" rel="noopener noreferrer">Message Reception/);
  assert.doesNotMatch(html,/data-human-handoff|automatic replies are paused|Reception is handling/);
  const dashboard=renderDashboardPage({
    requestedDateKey:'2026-10-03',operationalDateKey:'2026-10-03',displayName:'Christel',mode:'owner_overview',
    appointments:[],carryOver:[],teamGroups:[],awaitingFinalization:[],bookingRequests:[],rescheduleRequests:[],
    holidayDecisions:[],planningRequests:[],humanHandoffs:[{id:81,client_name:'<Jane>',client_mobile:'27662399138'}],
    calendar:{timeline:{staff:[]}},
  });
  assert.doesNotMatch(dashboard,/data-dashboard-human-handoff|Finish handoff|<Jane>/);
  assert.doesNotMatch(dashboard,/Needs attention/);
});

// Old installed clients may still call this endpoint. It must remain protected
// and retire without writing a handoff, alert, appointment or payment.
test('cached client handoff endpoint returns 410 without calling the retired service', async () => {
  const express=require('express');
  const {createMyShilohRouter}=require('../src/routes/myShiloh');
  const session={ok:true,crmV2ClientId:22,sessionId:2};
  const app=express();app.use(express.json());
  app.use(createMyShilohRouter({env:{NODE_ENV:'test'},
    sessionService:{async validateSessionToken(token){return token==='valid'?session:{ok:false};},validateCsrfToken(current,token){return current===session&&token==='csrf';}},
    humanHandoffService:{async request(){throw new Error('Unexpected handoff write');}},
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const headers={origin:base,cookie:'shiloh_client_session=valid','x-shiloh-csrf-token':'csrf','content-type':'application/json'};
    const post=(overrides)=>fetch(base+'/my-shiloh/api/human-handoff',{method:'POST',headers:{...headers,...overrides},body:'{}'});
    assert.equal((await post({origin:'https://untrusted.example'})).status,403);
    assert.equal((await post({cookie:''})).status,401);
    assert.equal((await post({'x-shiloh-csrf-token':'wrong'})).status,403);
    const retired=await post({});assert.equal(retired.status,410);
    assert.equal((await retired.json()).code,'HUMAN_HANDOFF_RETIRED');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('assistant instructions distinguish direct contact from booking approval', () => {
  const {buildInstructions}=require('../src/services/orchestrator');
  const instructions=buildInstructions({surface:'my_shiloh'});
  assert.match(instructions,/needs no approval and does not pause this assistant/);
  assert.match(instructions,/authorized clinic decision is still required/);
});
