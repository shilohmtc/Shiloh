'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {randomUUID}=require('node:crypto');
const {createMyShilohRouter}=require('../src/routes/myShiloh');
const {createWorkspaceOperationalRouter}=require('../src/routes/workspaceOperational');
const {MyShilohBookingError}=require('../src/services/myShilohBooking');
const {BookingIncidentError,UUID}=require('../src/services/bookingSubmissionIncidents');
const observability=require('../src/lib/observability');
const {reportConfirmationFailure}=require('../src/services/bookingIncidentReporting');
async function serve(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}

test('only unexpected signed-in confirmations record failures; original status/code and server identity are preserved',async t=>{
  const failures=[],successes=[],reports=[];let outcome='unexpected';
  t.mock.method(observability,'captureException',(error,tags)=>reports.push({error,tags}));
  const service={failure:async(context,error)=>{failures.push({context,error});return {reference:randomUUID(),linkSaved:true};},success:async(context,result)=>successes.push({context,result})};
  const booking={review:async()=>{throw new Error('PRIVATE_REVIEW_CANARY');},createRequest:async input=>{
    assert.equal(input.crmV2ClientId,55);
    if(outcome==='validation')throw new MyShilohBookingError('BOOKING_SLOT_UNAVAILABLE','Please choose another time.',409);
    if(outcome==='known503')throw new MyShilohBookingError('BOOKING_CART_APPROVAL_FAILED','The request could not be completed.',503);
    if(outcome==='success')return {status:'pending_resolution',appointmentId:901};
    throw Object.assign(new Error('PRIVATE_NAME_PHONE_DOB_HEALTH_SECRET_PAYMENT_CANARY'),{code:'42P08',name:'PRIVATE_NAME_CANARY'});
  }};
  const app=express();app.use(express.json());
  app.use(createMyShilohRouter({env:{NODE_ENV:'test'},incidentService:service,bookingService:booking,multipleBookingService:booking,couplesBookingService:booking,
    sessionService:{validateSessionToken:async token=>token==='synthetic'?{ok:true,crmV2ClientId:55,sessionId:1}:{ok:false},validateCsrfToken:(_s,token)=>token==='csrf'}}));
  app.use((_error,_req,res,_next)=>res.status(500).json({error:'Internal server error'}));
  const origin=await serve(t,app),attempt=randomUUID();
  const headers={'content-type':'application/json',origin,cookie:'shiloh_client_session=synthetic','x-shiloh-csrf-token':'csrf','x-shiloh-booking-attempt':attempt};
  const send=(path,body={},extra={})=>fetch(origin+'/my-shiloh/api/booking/'+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await send('confirm',{}, {cookie:''})).status,401);
  assert.equal((await send('confirm',{}, {origin:'https://example.invalid'})).status,403);
  assert.equal((await send('confirm',{}, {'x-shiloh-csrf-token':''})).status,403);
  assert.equal((await send('confirm',{crmV2ClientId:999})).status,422);
  for(const path of ['multiple/review','couples/review'])assert.equal((await send(path)).status,500);
  assert.equal(failures.length,0);assert.equal(reports.length,0);
  outcome='validation';for(const path of ['confirm','multiple/confirm','couples/confirm'])assert.equal((await send(path)).status,409);
  assert.equal(failures.length,0);
  outcome='unexpected';
  for(const [index,path] of ['confirm','multiple/confirm','couples/confirm'].entries()){
    const response=await send(path);assert.equal(response.status,500);assert.match(response.headers.get('cache-control'),/no-store/);
    const body=await response.json();assert.equal(body.error,'Internal server error');assert.match(body.supportReference,UUID);assert.equal(body.incidentLinkSaved,true);
    assert.equal(failures[index].context.clientId,55);assert.equal(failures[index].context.attemptKey,attempt);
    assert.equal(reports[index].tags['support.reference'],body.supportReference);assert.equal(reports[index].tags['error.code'],'42P08');
    assert.equal(reports[index].error.message,'Booking confirmation failed');assert.equal(reports[index].error.name,'Error');
    assert.equal(JSON.stringify({...reports[index].tags,...body}).includes('PRIVATE_'),false);
  }
  assert.deepEqual(failures.map(x=>x.context.kind),['ordinary','multiple','couples']);
  outcome='known503';const response=await send('multiple/confirm');assert.equal(response.status,503);assert.equal((await response.json()).code,'BOOKING_CART_APPROVAL_FAILED');
  outcome='success';for(const path of ['confirm','multiple/confirm','couples/confirm'])assert.equal((await send(path)).status,201);
  assert.equal(successes.length,3);assert.equal(failures.length,4);
});

test('failed recording/reporting cannot substitute an error, claim a link, create a booking or disclose client details',async()=>{
  const privateText='PRIVATE_CLIENT_DOB_PHONE_HEALTH_PAYMENT_CREDENTIAL_CANARY';
  const error=Object.assign(new Error(privateText),{code:'42P08'});
  let captured;
  const body=await reportConfirmationFailure({service:{failure:async()=>{throw new Error(privateText);}},context:{},error,
    req:{route:{path:'/my-shiloh/api/booking/confirm'}},report:{captureException:(safe,tags)=>{captured={safe,tags};}}});
  assert.equal(body.incidentLinkSaved,false);assert.match(body.supportReference,UUID);assert.match(body.supportMessage,/could not save/);
  assert.equal(JSON.stringify(body).includes(privateText),false);assert.equal(captured.safe.message.includes(privateText),false);
  const event=observability.sanitizeSentryEvent({user:{name:privateText},request:{data:privateText},extra:{clientId:55,payload:privateText},breadcrumbs:[{message:privateText}],tags:{...captured.tags,client:privateText,attempt:randomUUID()},exception:{values:[{type:captured.safe.name,value:captured.safe.message}]}});
  assert.equal(JSON.stringify(event).includes(privateText),false);assert.deepEqual(event.tags,captured.tags);
  assert.equal(observability.sanitizeSentryEvent({tags:{'support.reference':'0820000001'}}).tags['support.reference'],undefined);
});

test('Workspace support endpoints require staff session, current server permission, same-origin and CSRF; client opening and resolution use audited service actions',async t=>{
  const reference=randomUUID(),calls=[];let allowed=true;
  const requireAccess=()=>{if(!allowed)throw new BookingIncidentError('BOOKING_PROBLEMS_FORBIDDEN','Access denied.',403);};
  const incidentService={list:async input=>{requireAccess();calls.push(['list',input]);return {items:[],filter:'needs_help'};},openClient:async input=>{requireAccess();calls.push(['open',input]);return {href:'/calendar/clients/55'};},resolve:async input=>{requireAccess();calls.push(['resolve',input]);return {resolved:true};}};
  const app=express();app.use(express.json());
  app.use('/calendar/workspace',createWorkspaceOperationalRouter({env:{SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'},incidentService,
    sessionService:{validateSessionToken:async token=>token==='synthetic'?{ok:true,adminId:10}:{ok:false},validateCsrfToken:(_s,token)=>token==='csrf'}}));
  const origin=await serve(t,app),path=origin+'/calendar/workspace/booking-problems';
  const headers={'content-type':'application/json',origin,cookie:'shiloh_staff_session=synthetic','x-shiloh-csrf-token':'csrf'};
  assert.equal((await fetch(path)).status,401);
  const resolve=(extra={},body={revision:'1'})=>fetch(path+'/'+reference+'/resolve',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await resolve({cookie:''})).status,401);assert.equal((await resolve({origin:'https://example.invalid'})).status,403);assert.equal((await resolve({'x-shiloh-csrf-token':''})).status,403);
  assert.equal((await resolve({}, {revision:'1',clientId:999})).status,422);assert.equal(calls.length,0);
  assert.equal((await fetch(path+'?status=needs_help&offset=25',{headers})).status,200);
  const open=await fetch(path+'/'+reference+'/client',{headers,redirect:'manual'});assert.equal(open.status,303);assert.equal(open.headers.get('location'),'/calendar/clients/55');assert.equal(open.headers.get('referrer-policy'),'no-referrer');
  assert.equal((await resolve()).status,200);assert.equal(calls[2][1].adminId,10);assert.equal(calls[2][1].reference,reference);
  allowed=false;assert.equal((await resolve()).status,403);assert.equal((await fetch(path,{headers})).status,403);assert.equal((await fetch(path+'/'+reference+'/client',{headers,redirect:'manual'})).status,403);
});
