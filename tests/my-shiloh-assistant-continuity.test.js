'use strict';
// Deterministic Responses fixtures exercise production orchestration, not model quality.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');
const {createMyShilohAssistantService}=require('../src/services/myShilohAssistant');
const {createMyShilohReadTools,TOOL_NAMES}=require('../src/services/myShilohReadTools');
const {createMyShilohActionTools}=require('../src/services/myShilohActionTools');
const {createAssistantPreparation}=require('../src/services/myShilohAssistantPreparation');
function loadSource(file,stubs){const filename=path.resolve(__dirname,'../src/services',file);const local=createRequire(filename);const module={exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>Object.hasOwn(stubs,name)?stubs[name]:local(name),process:{env:{}},setInterval,Date,Buffer},{filename});return module.exports;}
const log={info(){},warn(){},error(){}};
const service='Synthetic treatment',practitioner='Synthetic practitioner',date='2026-11-03';
function canonicalSlots(){return Array.from({length:32},(_,index)=>({starts_at:new Date(Date.UTC(2026,10,3,6,index*15)),ends_at:new Date(Date.UTC(2026,10,3,7,index*15)),staff_name:practitioner}));}

test('later alternatives beyond first eight remain canonical, validated and clinic-local across year boundary',async()=>{
 let calls=0;
 const tools=createMyShilohReadTools({contextService:{loadNextAppointment:async()=>null},availability:async()=>{calls++;return {status:'available',slots:canonicalSlots()};}});
 const args={service,date,practitioner,daypart:null,afterTime:null};
 const first=await tools.execute(TOOL_NAMES.FIND_AVAILABLE_SLOTS,args,{crmV2ClientId:55});
 const later=await tools.execute(TOOL_NAMES.FIND_AVAILABLE_SLOTS,{...args,afterTime:'14:00'},{crmV2ClientId:55});
 assert.equal(first.slots.length,8);assert.equal(later.slots[0].startsAt,'2026-11-03T12:15:00.000Z');assert.ok(later.slots.every(slot=>!first.slots.some(item=>item.startsAt===slot.startsAt)));
 assert.equal((await tools.execute(TOOL_NAMES.FIND_AVAILABLE_SLOTS,{...args,afterTime:'24:01'},{crmV2ClientId:55})).ok,false);assert.equal(calls,2);
 const year=createMyShilohReadTools({contextService:{loadNextAppointment:async()=>null},availability:async()=>({status:'available',slots:[{starts_at:'2026-12-31T23:30:00Z',ends_at:'2027-01-01T00:30:00Z',staff_name:practitioner}]})});
 assert.equal((await year.execute(TOOL_NAMES.FIND_AVAILABLE_SLOTS,{...args,date:'2027-01-01',afterTime:'01:00'},{crmV2ClientId:55})).slots.length,1);
});

test('production Responses loop and existing PostgreSQL session memory retain selected details across turns and isolate session/signout',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());
 const db={query:async(sql,values)=>{const r=await pg.query(sql,values);return{rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}};
 const memory=loadSource('memory.js',{'../db/pool':{pool:db},'../lib/logger':log});
 const states=new Map(),requests=[],availabilityCalls=[],bookingCalls=[];let serial=0;
 function response(text,state){const id='synthetic_response_'+(++serial);states.set(id,state);return{id,output:[],output_text:text};}
 function call(name,args,state){const id='synthetic_call_'+(++serial);states.set(id,state);return{id,output:[{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}]};}
 const responses={create:async request=>{
   requests.push(request); const previous=states.get(request.previous_response_id);
   if(Array.isArray(request.input)){
     const result=JSON.parse(request.input[0].output);
     assert.equal(result.ok,true);
     if(previous.stage==='history'){assert.equal(result.treatments[0].service,service);return response('Which day and practitioner would you prefer?',{stage:'choose',service});}
     if(previous.stage==='slots'){assert.equal(result.slots[0].practitioner,practitioner);return response('Here are the current afternoon options.',{...previous,stage:'offered',slot:result.slots[0].startsAt});}
     if(previous.stage==='later'){assert.equal(result.slots[0].startsAt,'2026-11-03T12:15:00.000Z');return response('14:15 is available. Would you like to review it?',{...previous,stage:'later_offered',slot:result.slots[0].startsAt});}
     assert.equal(previous.stage,'prepare');assert.equal(Object.hasOwn(result.service,'id'),false);return response('Ready to review.',{...previous,stage:'prepared'});
   }
   if(!previous){if(request.input==='Book my usual')return call(TOOL_NAMES.TREATMENT_HISTORY,{}, {stage:'history'});return response('Which treatment and day would you like?',{stage:'unknown'});}
   if(request.input==='Tuesday afternoon with Synthetic practitioner'){
     assert.equal(previous.service,service);return call(TOOL_NAMES.FIND_AVAILABLE_SLOTS,{service:previous.service,practitioner,date,daypart:'afternoon',afterTime:null},{...previous,stage:'slots',practitioner,date});
   }
   if(request.input==='A little later'){
     assert.equal(previous.service,service);assert.equal(previous.practitioner,practitioner);assert.equal(previous.date,date);
     return call(TOOL_NAMES.FIND_AVAILABLE_SLOTS,{service:previous.service,practitioner:previous.practitioner,date:previous.date,daypart:'afternoon',afterTime:'14:00'},{...previous,stage:'later'});
   }
   assert.equal(request.input,'Review 14:15');assert.equal(previous.stage,'later_offered');
   return call('prepare_my_booking',{service:previous.service,practitioner:previous.practitioner,startsAt:previous.slot},{...previous,stage:'prepare'});
 }};
 const ai=loadSource('ai.js',{
   openai:class{constructor(){return{responses};}},'./memory':memory,'./knowledge':{retrieveKnowledge:async()=>[]},'./profile':{getProfile:async()=>({})},
   './activeCatalogueKnowledge':{getActiveCatalogueKnowledge:async()=>null},'./practitionerKnowledge':{getPractitionerKnowledge:async()=>null},
   './clinicFaq':{processClinicFaqMessage:()=>({handled:false}),getClinicFaqKnowledge:()=>null},
   '../config/heidelbergGuide':{getHeidelbergGuideKnowledge:()=>null,buildHeidelbergGuideReply:()=>null},
   './googlePlaces':{isLivePlacesQuery:()=>false},'../lib/logger':log,
 });
 const context={getContext:async({crmV2ClientId})=>({client:{id:crmV2ClientId,name:'Synthetic'},generatedAt:'2026-10-15T08:00:00Z'}),loadNextAppointment:async()=>null,loadTreatmentHistory:async id=>{assert.equal(id,55);return[{service,practitioner,startsAt:'2026-10-01T08:00:00Z'}];}};
 const readTools=createMyShilohReadTools({contextService:context,availability:async(intent,options)=>{availabilityCalls.push({intent,options});return{status:'available',slots:canonicalSlots().filter(slot=>slot.starts_at.getUTCHours()>=10)};}});
 const booking={catalogue:async()=>[{id:101,name:service}],practitioners:async()=>({service:{id:101,name:service,price:720},practitioners:[{id:11,name:practitioner}]}),slots:async args=>{bookingCalls.push(args);return{slots:canonicalSlots().map(slot=>({startsAt:slot.starts_at.toISOString()}))};}};
 const actionTools=createMyShilohActionTools({preparation:createAssistantPreparation({booking})});
 const assistant=createMyShilohAssistantService({ai:ai.generateReply,contextService:context,readTools,actionTools,clearConversationSession:memory.clearSession});
 const send=(sessionId,message)=>assistant.reply({sessionId,crmV2ClientId:55,message});
 await send(1,'Book my usual');await send(1,'Tuesday afternoon with Synthetic practitioner');await send(1,'A little later');
 const prepared=await send(1,'Review 14:15');assert.equal(prepared.action.type,'booking_request');assert.match(prepared.action.href,/startsAt=2026-11-03T12%3A15/);
 assert.equal(bookingCalls[0].date,date);assert.equal(bookingCalls[0].crmV2ClientId,55);assert.equal(availabilityCalls.length,2);
 const initialRequests=requests.filter(item=>typeof item.input==='string');assert.equal(initialRequests[0].previous_response_id,undefined);assert.ok(initialRequests.slice(1).every(item=>item.previous_response_id));
 const other=await send(2,'A little later');assert.match(other.reply,/Which treatment/);assert.equal(initialRequests.length,4);assert.equal(requests.at(-1).previous_response_id,undefined);
 await assistant.clearConversation({sessionId:1});const reset=await send(1,'A little later');assert.match(reset.reply,/Which treatment/);assert.equal(requests.at(-1).previous_response_id,undefined);
 const rows=(await pg.query('SELECT phone FROM conversation_sessions ORDER BY phone')).rows;assert.deepEqual(rows.map(item=>item.phone),['myshiloh:1','myshiloh:2']);
});
