const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createWorkspaceOperationalRouter}=require('../src/routes/workspaceOperational');
const {cursor}=require('../src/services/workspacePaymentReview');
test('payment review GET is session-bound, private, read-only and preserves deposit access on balance failure',async t=>{
 const calls=[];let available=true;
 const app=express();app.use('/calendar/workspace',createWorkspaceOperationalRouter({
  env:{NODE_ENV:'test',SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'},
  sessionService:{validateSessionToken:async token=>token==='synthetic'?{ok:true,adminId:7}:{ok:false}},
  paymentReviewService:{async getWorkspaceReview(input){cursor(input.after);calls.push(input);return available?{state:'known',items:[],next:null}:{state:'unavailable'};}},
  dashboardService:{async depositQueue(input){assert.equal(input.adminId,7);return {items:[]};}},
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/calendar/workspace/payments`,headers={cookie:'shiloh_staff_session=synthetic'};
 assert.equal((await fetch(url)).status,401);assert.equal(calls.length,0);
 const response=await fetch(url+'?after=25&adminId=99',{headers});
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
 assert.match(await response.text(),/Unfinished payments/);assert.equal(calls[0].adminId,7);assert.equal(calls[0].after,'25');
 assert.equal((await fetch(url+'?after=-1',{headers})).status,400);
 assert.equal((await fetch(url,{headers,method:'POST'})).status,404);
 available=false;const failed=await fetch(url,{headers});assert.equal(failed.status,503);const html=await failed.text();assert.match(html,/Completed-payment details are temporarily unavailable/);assert.match(html,/Upcoming deposits/);
});
