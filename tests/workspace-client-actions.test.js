'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {requireClientActionContext}=require('../src/services/workspaceClientActionContext');
const {clientActionForm}=require('../src/presentation/workspaceClientActionsUx');
const principal={id:14,admin_active:true,business_role:'owner',permissions:{'client:lookup':true}};
function fixture(principalRows=[principal],clientRows=[{id:42,name:'Selected client',normalized_mobile:'27821234567'}]){const calls=[];return {calls,db:{query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.includes('clientAction:principal')?principalRows:clientRows};}}};}
test('financial client context resolves exact clinic relationship under transaction locks',async()=>{const f=fixture();const client=await requireClientActionContext(f.db,14,42,{lock:true});assert.equal(client.id,42);assert.match(f.calls[0].sql,/FOR SHARE OF a/);assert.match(f.calls[1].sql,/r.relationship_type='clinic'/);assert.match(f.calls[1].sql,/FOR SHARE OF c,r/);assert.deepEqual(f.calls[1].params,[42]);});
test('financial capability alone, tenant scope, ambiguous and archived records never give client actions',async()=>{for(const p of [{...principal,permissions:{}},{...principal,business_role:'tenant_practitioner',staff_id:2,staff_status:'active'}]){const f=fixture([p]);await assert.rejects(requireClientActionContext(f.db,14,42),{httpStatus:403});assert.equal(f.calls.length,1);}for(const rows of [[],[{id:42},{id:42}]])await assert.rejects(requireClientActionContext(fixture([principal],rows).db,14,42),{httpStatus:404});});
test('client action UI requires its distinct capability, active profile and available ledger',()=>{const model={client:{id:42,status:'active',name:'Selected client',normalized_mobile:'27821234567'},rewards:{data:{authority:{canManage:true}}},vouchers:{data:{authority:{canIssue:true}}}};assert.match(clientActionForm(model,'rewards'),/data-client-id="42"/);assert.match(clientActionForm(model,'rewards'),/method="post" action="\/calendar\/clients\/42\/actions\/rewards"/);assert.doesNotMatch(clientActionForm(model,'rewards'),/clientSearch/);const voucher=clientActionForm(model,'vouchers');assert.match(voucher,/value="Selected client"/);assert.match(voucher,/paymentConfirmed/);for(const state of [{restricted:true},{unavailable:true},{data:{authority:{}}}])assert.equal(clientActionForm({...model,vouchers:state},'vouchers'),'');assert.equal(clientActionForm({...model,client:{...model.client,status:'archived'}},'rewards'),'');});

test('contextual reward adjustments use the selected wallet, audit actor and unchanged replay',async()=>{
  const {createShilohRewardsService}=require('../src/services/shilohRewards');
  const calls=[],entries=[];
  const operator={...principal,display_name:'Synthetic owner',calendar_scope:'all_business',service_scope:'all_services',permissions:{'client:lookup':true,'loyalty:view':true,'loyalty:manage':true}};
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.includes('calendarAuthorization:principal')||sql.includes('clientAction:principal'))return {rows:[operator]};
    if(sql.includes('clientAction:client'))return {rows:[{id:42,name:'Same name',normalized_mobile:'27821234567'}]};
    if(sql.includes("SELECT id FROM crm_v2_clients WHERE id="))return {rows:[{id:42}]};
    if(sql.includes('INSERT INTO loyalty_wallets')){assert.equal(params[0],42);return {rows:[{id:7}]};}
    if(sql.includes('SELECT id FROM loyalty_wallets'))return {rows:[{id:7}]};
    if(sql.includes('SELECT * FROM loyalty_wallet_entries WHERE operation_key='))return {rows:entries};
    if(sql.includes('SUM(signed_amount)'))return {rows:[{balance:'0',credited:'0',used:'0'}]};
    if(sql.includes('INSERT INTO loyalty_wallet_entries')){entries.push({id:81,wallet_id:params[0],signed_amount:params[1]});return {rows:entries};}
    if(sql.includes('INSERT INTO crm_audit_events')){assert.equal(params[0],14);return {rows:[]};}
    throw Error('Unexpected reward query '+sql);
  };
  const service=createShilohRewardsService({db:{query,connect:async()=>({query,release(){}})}});
  const input={adminId:14,contextClientId:42,clientSearch:'Different client',amount:'25',direction:'add',operationId:'synthetic-context-001'};
  assert.equal((await service.adjust(input)).status,'adjusted');
  assert.equal((await service.adjust(input)).status,'idempotent_replay');
  assert.equal(entries.length,1);assert.equal(entries[0].signed_amount,'25.00');
  assert.equal(calls.some(c=>c.sql.includes('LOWER(name)')),false);
  entries[0].wallet_id=999;
  await assert.rejects(service.adjust(input),{code:'REWARDS_OPERATION_CONTEXT_CHANGED'});
  assert.equal(calls.at(-1).sql,'ROLLBACK');
});
