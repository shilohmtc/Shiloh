'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClientHumanHandoffService } = require('../src/services/clientHumanHandoffs');
const { createMyShilohAssistantService } = require('../src/services/myShilohAssistant');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');
const fs = require('node:fs');
const path = require('node:path');

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

test('My Shiloh refuses AI and tool actions while a human handoff is open', async () => {
  let calls=0;
  const service=createMyShilohAssistantService({
    ai:async()=>{calls+=1;return 'Automated reply';},
    contextService:{async getContext(){return {client:{name:'Jane'},version:'v1'};}},
    readTools:{definitions:[],async execute(){}},
    actionTools:{definitions:[],async execute(){},handles(){return false;}},
    handoffService:{async activeForClient(){return {id:81};}},
  });
  await assert.rejects(service.reply({sessionId:2,crmV2ClientId:22,message:'Hello'}),{code:'MY_SHILOH_HUMAN_HANDOFF_ACTIVE'});
  assert.equal(calls,0);
});

test('a handoff starting while AI is composing suppresses the late answer', async () => {
  let active=false;
  const service=createMyShilohAssistantService({
    ai:async()=>{active=true;return 'Late automated reply';},
    contextService:{async getContext(){return {client:{name:'Jane'},version:'v1'};}},
    readTools:{definitions:[],async execute(){}},
    actionTools:{definitions:[],async execute(){},handles(){return false;}},
    handoffService:{async activeForClient(){return active ? {id:81} : null;}},
  });
  await assert.rejects(service.reply({sessionId:2,crmV2ClientId:22,message:'Hello'}),{code:'MY_SHILOH_HUMAN_HANDOFF_ACTIVE'});
});

test('signed-in client sees the paused state and Reception sees manual-channel limits', () => {
  const html=renderMyShilohPage({client:{id:22,firstName:'Jane'},whatsappNumber:'27836835433',humanWhatsAppNumber:'27662399138',humanHandoffActive:true});
  assert.match(html,/automatic replies are paused/);
  assert.doesNotMatch(html,/data-shiloh-chat-form/);
  assert.match(html,/wa\.me\/27662399138/);
  const dashboard=renderDashboardPage({
    requestedDateKey:'2026-09-27',operationalDateKey:'2026-09-27',displayName:'Christel',mode:'owner_overview',
    appointments:[],carryOver:[],teamGroups:[],awaitingFinalization:[],bookingRequests:[],rescheduleRequests:[],
    holidayDecisions:[],planningRequests:[],humanHandoffs:[{id:81,client_name:'<Jane>',client_mobile:'27662399138'}],
    calendar:{timeline:{staff:[]}},
  });
  assert.match(dashboard,/data-dashboard-human-handoff="81"/);
  assert.match(dashboard,/cannot read that separate conversation/);
  assert.match(dashboard,/0662399138/);
  assert.doesNotMatch(dashboard,/<Jane>/);
});

test('handoff routes require the existing client and staff session boundaries', () => {
  const root=path.join(__dirname,'..');
  const client=fs.readFileSync(path.join(root,'src/routes/myShiloh.js'),'utf8');
  const staff=fs.readFileSync(path.join(root,'src/routes/workspaceOperational.js'),'utf8');
  assert.match(client,/router\.post\('\/my-shiloh\/api\/human-handoff', sameOrigin, requireSession, requireCsrf/);
  assert.match(client,/humanHandoffService\.request\(req\.myShilohClientSession\.crmV2ClientId\)/);
  assert.match(staff,/router\.post\('\/human-handoffs\/:handoffId\/close', sameOrigin, requireCsrf/);
  assert.match(staff,/dashboardService\.closeHumanHandoff/);
});
