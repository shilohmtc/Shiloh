'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createWorkspaceOperationalRouter}=require('../src/routes/workspaceOperational');

test('completed visit reads and enquiry outcomes use current session identity, origin, CSRF and private responses',async()=>{
  const session={ok:true,adminId:7,viewer:{calendarScope:'all_business'},accountPrincipal:{id:7,business_role:'owner',calendar_scope:'all_business'}};
  const calls=[];
  const app=express();app.use(express.json());app.use('/calendar/workspace',createWorkspaceOperationalRouter({
    env:{NODE_ENV:'test',SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'},
    sessionService:{async validateSessionToken(token){return token==='valid'?session:{ok:false};},validateCsrfToken(s,token){return s===session&&token==='csrf';}},
    dashboardService:{async planningAppointments(input){calls.push(input);return{appointments:[],revision:'2030-10-30T09:00:00Z'};},async resolvePlanningRequest(input){calls.push(input);return{id:81,status:input.action};}},
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`,path=origin+'/calendar/workspace/planning-requests/81';
    assert.equal((await fetch(path+'/appointments?kind=attended')).status,401);
    let response=await fetch(path+'/appointments?kind=attended',{headers:{cookie:'shiloh_staff_session=valid'}});
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const headers={cookie:'shiloh_staff_session=valid',origin,'content-type':'application/json','x-shiloh-csrf-token':'csrf'};
    const payload={appointmentId:801,expectedRevision:'2030-10-30T09:00:00Z',confirmed:true,operationId:'00000000-0000-4000-8000-000000000081',adminId:999};
    for(const action of ['attended','cancelled']){
      const body=JSON.stringify({...payload,...(action==='cancelled'?{appointmentId:undefined}:{})});
      assert.equal((await fetch(path+'/'+action,{method:'POST',headers:{...headers,cookie:''},body})).status,401);
      assert.equal((await fetch(path+'/'+action,{method:'POST',headers:{...headers,origin:'https://other.test'},body})).status,403);
      assert.equal((await fetch(path+'/'+action,{method:'POST',headers:{...headers,'x-shiloh-csrf-token':'invalid'},body})).status,403);
      response=await fetch(path+'/'+action,{method:'POST',headers,body});assert.equal(response.status,200);
    }
    assert.equal(calls.length,3);assert.equal(calls[0].attended,true);
    assert.equal(calls[1].adminId,7);assert.equal(calls[1].sessionPrincipal,session.accountPrincipal);
    assert.equal(calls[1].appointmentId,801);assert.equal(calls[1].confirmed,true);assert.equal(calls[1].expectedRevision,payload.expectedRevision);
    assert.equal(calls[2].action,'cancelled');assert.equal(calls[2].appointmentId,undefined);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
