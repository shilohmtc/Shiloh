const test=require('node:test');
const assert=require('node:assert/strict');
const axios=require('axios');
const {CONTRACTS,configuredTemplateName,compareContract,fetchAllTemplates,inspectMetaTemplateInventory,assertTemplateSendAllowed,resetTemplateInventoryCache}=require('../src/services/metaTemplateContracts');
const originalGet=axios.get;
const env={...process.env};
test.afterEach(()=>{axios.get=originalGet;process.env={...env};resetTemplateInventoryCache();});

test('complete registry contains all 31 exact expected/current/legacy identities',()=>{
 assert.equal(CONTRACTS.length,31); assert.equal(new Set(CONTRACTS.map(x=>x.contract.name)).size,31);
 assert.equal(CONTRACTS.find(x=>x.key==='workspace_booking_request_alert').contract.name,'shiloh_workspace_booking_request_alert_v1');
 assert.equal(CONTRACTS.find(x=>x.key==='birthday_v2').contract.name,'shiloh_birthday_wish_v2');
 assert.equal(CONTRACTS.find(x=>x.key==='birthday_v1').sendable,false);
 const bookingV2=CONTRACTS.find(x=>x.key==='booking_confirmation_v2');assert.equal(bookingV2.contract.name,'shiloh_booking_confirmation_v2');assert.equal(bookingV2.sendable,true);
 assert.equal(CONTRACTS.find(x=>x.key==='reschedule_approval_request').contract.name,'shiloh_reschedule_approval_request_v1');
 assert.equal(CONTRACTS.find(x=>x.key==='reschedule_declined').contract.name,'shiloh_reschedule_declined_v1');
 assert.equal(CONTRACTS.find(x=>x.key==='staff_auth_otp').contract.name,'shiloh_staff_auth_otp_v1');
 assert.equal(CONTRACTS.find(x=>x.key==='consultation_form').contract.name,'shiloh_consultation_form_v1');
 assert.equal(CONTRACTS.find(x=>x.key==='consultation_form_reminder').contract.name,'shiloh_consultation_form_reminder_v1');
});
test('contract comparison detects copy, variable, button, and ordering drift',()=>{
 const entry=CONTRACTS.find(x=>x.key==='booking_approval_request');
 const exact={...entry.contract,components:structuredClone(entry.contract.components)};
 assert.equal(compareContract(entry,exact).exact,true);
 exact.components[1].buttons.reverse(); assert.equal(compareContract(entry,exact).components,false);
 exact.components=structuredClone(entry.contract.components);exact.components[0].text=exact.components[0].text.replace('{{5}}','{{6}}');
 assert.equal(compareContract(entry,exact).exact,false);
});
test('provider inventory follows pagination and never returns account/provider ids',async()=>{
 process.env.WHATSAPP_BUSINESS_ACCOUNT_ID='secret-waba';process.env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE='shiloh_booking_confirmation_v1';
 const entry=CONTRACTS.find(x=>x.key==='booking_confirmation');let calls=0;
 axios.get=async url=>{calls++;return {data:calls===1?{data:[],paging:{next:'https://next.invalid/page'}}:{data:[{id:'provider-id',status:'APPROVED',quality_score:{score:'GREEN'},...entry.contract}]}}};
 const report=await inspectMetaTemplateInventory();assert.equal(calls,2);const state=report.templates.find(x=>x.key==='booking_confirmation');assert.equal(state.ready,true);assert.equal(JSON.stringify(report).includes('secret-waba'),false);assert.equal(JSON.stringify(report).includes('provider-id'),false);
});
test('send gate rejects arbitrary names, disabled booking update and legacy identities',async()=>{
 await assert.rejects(()=>assertTemplateSendAllowed('arbitrary_env_name'),/not an approved Shiloh/);
 await assert.rejects(()=>assertTemplateSendAllowed('appointment_followup'),/not an approved Shiloh/);
 process.env.WHATSAPP_BOOKING_UPDATE_TEMPLATE='shiloh_booking_update_v1';
 await assert.rejects(()=>assertTemplateSendAllowed('shiloh_booking_update_v1'),/gate is disabled/);
});
test('reschedule approval transport stays disabled even when provider-ready until feature activation',async()=>{
 process.env.WHATSAPP_BUSINESS_ACCOUNT_ID='hidden';
 process.env.WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE='shiloh_reschedule_approval_request_v1';
 process.env.WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE='shiloh_reschedule_declined_v1';
 process.env.WHATSAPP_RESCHEDULE_APPROVAL_ENABLED='false';
 const request=CONTRACTS.find(x=>x.key==='reschedule_approval_request');
 const declined=CONTRACTS.find(x=>x.key==='reschedule_declined');
 axios.get=async()=>({data:{data:[{id:'request',status:'APPROVED',...request.contract},{id:'declined',status:'APPROVED',...declined.contract}]}});
 const report=await inspectMetaTemplateInventory();
 assert.equal(report.templates.find(x=>x.key==='reschedule_approval_request').ready,true);
 assert.equal(report.templates.find(x=>x.key==='reschedule_declined').ready,true);
 await assert.rejects(()=>assertTemplateSendAllowed(request.contract.name),/Reschedule-approval delivery gate is disabled/);
 await assert.rejects(()=>assertTemplateSendAllowed(declined.contract.name),/Reschedule-approval delivery gate is disabled/);
});
test('reschedule approval readiness fails closed on pending mismatch duplicates and wrong configuration',async()=>{
 process.env.WHATSAPP_BUSINESS_ACCOUNT_ID='hidden';
 process.env.WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE='wrong_template';
 process.env.WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE='shiloh_reschedule_declined_v1';
 const request=CONTRACTS.find(x=>x.key==='reschedule_approval_request');
 const declined=CONTRACTS.find(x=>x.key==='reschedule_declined');
 const drift={...declined.contract,components:structuredClone(declined.contract.components)};drift.components[0].text=drift.components[0].text.replace('not approved','declined');
 axios.get=async()=>({data:{data:[{id:'r1',status:'PENDING',...request.contract},{id:'r2',status:'PENDING',...request.contract},{id:'d1',status:'APPROVED',...drift}]}});
 const report=await inspectMetaTemplateInventory();
 const requestState=report.templates.find(x=>x.key==='reschedule_approval_request');
 const declinedState=report.templates.find(x=>x.key==='reschedule_declined');
 assert.equal(requestState.configured,false);assert.equal(requestState.provider.duplicateCount,1);assert.equal(requestState.ready,false);
 assert.equal(declinedState.contract.exact,false);assert.equal(declinedState.ready,false);
});
test('fetchAllTemplates requests every provider page',async()=>{let n=0;axios.get=async()=>({data:n++?{data:[{name:'b'}]}:{data:[{name:'a'}],paging:{next:'next'}}});assert.deepEqual((await fetchAllTemplates('x')).map(x=>x.name),['a','b']);});

test('realistic Meta fixture ignores managed metadata but detects semantic drift',()=>{
 const fixture=require('./fixtures/meta-message-templates-realistic.json').data[0];
 const entry=CONTRACTS.find(x=>x.key==='booking_approval_request');
 assert.equal(compareContract(entry,fixture).exact,true);
 for(const mutate of [
   value=>{value.components[0].text=value.components[0].text.replace('{{4}}','{{5}}');},
   value=>{value.components[1].buttons.reverse();},
   value=>{value.components.unshift({type:'HEADER',format:'TEXT',text:'Unexpected'});},
   value=>{value.components.push({type:'FOOTER',text:'Unexpected'});},
 ]) { const changed=structuredClone(fixture);mutate(changed);assert.equal(compareContract(entry,changed).components,false); }
});

test('every current operational contract validates exactly and drift fails',()=>{
 const current=CONTRACTS.filter(x=>x.sendable);assert.equal(current.length,26);
 for(const entry of current){const provider={...entry.contract,components:structuredClone(entry.contract.components)};assert.equal(compareContract(entry,provider).exact,true,entry.key);provider.category=entry.contract.category==='UTILITY'?'MARKETING':'UTILITY';assert.equal(compareContract(entry,provider).exact,false,entry.key);}
});

test('provider variants require exact language and duplicate exact-language variants fail closed',async()=>{
 process.env.WHATSAPP_BUSINESS_ACCOUNT_ID='hidden';process.env.WHATSAPP_BIRTHDAY_TEMPLATE='shiloh_birthday_wish_v2';
 const entry=CONTRACTS.find(x=>x.key==='birthday_v2');
 axios.get=async()=>({data:{data:[{id:'z',status:'APPROVED',...entry.contract},{id:'a',status:'APPROVED',...entry.contract},{id:'fr',status:'APPROVED',...entry.contract,language:'fr'}]}});
 const state=(await inspectMetaTemplateInventory()).templates.find(x=>x.key==='birthday_v2');assert.equal(state.provider.language,'en');assert.equal(state.provider.duplicateCount,1);assert.equal(state.ready,false);
});

test('staff finalization configuration is reconciled exactly',()=>{
 const staff=CONTRACTS.find(x=>x.key==='staff_finalization');assert.equal(staff.env,'WHATSAPP_STAFF_FINALIZATION_TEMPLATE');
});

async function staffFinalizationState(override) {
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID='hidden';
  if (override === undefined) delete process.env.WHATSAPP_STAFF_FINALIZATION_TEMPLATE; else process.env.WHATSAPP_STAFF_FINALIZATION_TEMPLATE=override;
  const entry=CONTRACTS.find(x=>x.key==='staff_finalization');
  axios.get=async()=>({data:{data:[{id:'staff-en',status:'APPROVED',quality_score:{score:'GREEN'},...entry.contract}]}});
  const state=(await inspectMetaTemplateInventory()).templates.find(x=>x.key==='staff_finalization');
  return {entry,state};
}

test('staff finalization unset override defaults consistently to the approved canonical name',async()=>{
  const {entry,state}=await staffFinalizationState(undefined);assert.equal(configuredTemplateName(entry),'shiloh_staff_finalization_v1');assert.equal(state.configuredName,'shiloh_staff_finalization_v1');assert.equal(state.ready,true);assert.equal((await assertTemplateSendAllowed('shiloh_staff_finalization_v1')).ready,true);
});
test('staff finalization exact optional override passes inventory and send gates',async()=>{
  const {entry,state}=await staffFinalizationState('shiloh_staff_finalization_v1');assert.equal(configuredTemplateName(entry),'shiloh_staff_finalization_v1');assert.equal(state.ready,true);assert.equal((await assertTemplateSendAllowed('shiloh_staff_finalization_v1')).ready,true);
});
test('staff finalization wrong optional override fails inventory and send gates closed',async()=>{
  const {entry,state}=await staffFinalizationState('unapproved_staff_template');assert.equal(configuredTemplateName(entry),'unapproved_staff_template');assert.equal(state.configured,false);assert.equal(state.ready,false);await assert.rejects(()=>assertTemplateSendAllowed('shiloh_staff_finalization_v1'),/configuration does not match/);
});
