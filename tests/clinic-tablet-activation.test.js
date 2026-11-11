'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const express=require('express');
const {prepareConfiguredClinicTablet,FLAG}=require('../src/services/clinicTabletBookedActivation');
const {buildClinicTabletBookedPreparation}=require('../src/services/clinicTabletBookedPreparation');
const {createClinicTabletBookedRouter}=require('../src/routes/clinicTabletBooked');
const {createClientCodeRelease}=require('../src/services/clientCodeRelease');
test('tablet defaults are inert and production needs explicit reviewed activation',async t=>{
 const never=()=>assert.fail('Disabled preparation must not query, send, construct or start');
 assert.equal(await prepareConfiguredClinicTablet({env:{},clientRelease:new Proxy({},{get:never}),createCheckin:never}),null);
 assert.throws(()=>buildClinicTabletBookedPreparation(),/approval required/);
 const release=createClientCodeRelease({env:{},db:{query:never,connect:never},fetchImpl:never});
 await assert.rejects(release.prepareTabletJourney({approved:true}),/running/);
 const app=express();app.use('/check-in/booked',createClinicTabletBookedRouter({enabled:true,env:{NODE_ENV:'production'},service:new Proxy({},{get:never})}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/check-in/booked/`);assert.equal(response.status,404);assert.equal(response.headers.get('set-cookie'),null);
 for(const env of [{[FLAG]:'true'},{[FLAG]:'true',SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true',SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED:'true'}])await assert.rejects(prepareConfiguredClinicTablet({env,clientRelease:{status:()=>({enabled:false})},createCheckin:never}),/prerequisites/);
});
test('configured preparation starts exactly the existing private runtime component',async()=>{
 let prepared,started=0;const component={start:async()=>{started++;return {ok:true};},stop:async()=>{}};
 const release={status:()=>({enabled:true}),prepareTabletJourney:async options=>{prepared=options;return component;}};
 const checkin={},forms={};const result=await prepareConfiguredClinicTablet({env:{[FLAG]:'true',SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true',SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED:'true'},clientRelease:release,createCheckin:()=>checkin,forms});
 assert.equal(result,component);assert.deepEqual(prepared,{approved:true,checkin,formService:forms});assert.equal(started,1);
});
