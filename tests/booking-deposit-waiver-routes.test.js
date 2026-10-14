'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),{once}=require('node:events');
const {createCalendarPaymentsRouter}=require('../src/routes/calendarPayments');
test('waiver route binds current session and appointment, rejects spoofed/unknown keys and retains session/origin/CSRF privacy',async t=>{
 const received=[],app=express();app.use(express.json());app.use('/calendar/payments',createCalendarPaymentsRouter({env:{NODE_ENV:'test'},sessionService:{validateSessionToken:async token=>token==='synthetic'?{ok:true,adminId:2}:{ok:false},validateCsrfToken:(_s,token)=>token==='synthetic-csrf'},service:{recordDepositWaiver:async input=>{received.push(input);return {status:'waived'};}}}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const origin=`http://127.0.0.1:${server.address().port}`,body={reason:'Agreed exception',confirmed:true,operationId:'synthetic_route',requirementId:90,expectedRevision:'2026-10-14T08:00:00.000Z'},headers={cookie:'shiloh_staff_session=synthetic',origin,'content-type':'application/json','x-shiloh-csrf-token':'synthetic-csrf'};
 const post=(data=body,extra={})=>fetch(origin+'/calendar/payments/appointments/201/deposit/waive',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
 const good=await post();assert.equal(good.status,201);assert.match(good.headers.get('cache-control'),/no-store/);assert.equal(received[0].adminId,2);assert.equal(received[0].appointmentId,'201');
 for(const data of [{...body,adminId:999},{...body,appointmentId:999},{...body,amount:'0'},[],null])assert.equal((await post(data)).status,400);
 assert.equal((await post(body,{cookie:''})).status,401);assert.equal((await post(body,{origin:'https://untrusted.invalid'})).status,403);assert.equal((await post(body,{'x-shiloh-csrf-token':'invalid'})).status,403);assert.equal(received.length,1);
});
