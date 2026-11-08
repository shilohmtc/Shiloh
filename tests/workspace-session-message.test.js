const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
function request(url, options={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method:options.method||'GET',headers:options.headers||{}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>res.headers[name.toLowerCase()]||null},text:async()=>body,json:async()=>JSON.parse(body)}));
    });req.on('error',reject);req.end();
  });
}
const { createWorkspaceMessagesRouter } = require('../src/routes/workspaceMessages');
const { createStaffCalendarAccessRouter } = require('../src/routes/staffCalendarAccessUx');
const env = { SHILOH_CALENDAR_READONLY_UX_ENABLED:'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true' };

test('Messages navigation recovers through existing sign-in without reading protected data; API and mutation failures stay 401', async t => {
  let reads=0;
  const app=express();
  app.use('/calendar/messages',createWorkspaceMessagesRouter({env,sessionService:{validateSessionToken:async()=>({ok:false})},service:{buildModel:async()=>{reads++;throw Error('Protected data must not be read');}}}));
  app.use('/calendar/staff',createStaffCalendarAccessRouter({env}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  for(const cookie of ['', 'shiloh_staff_session=expired', 'shiloh_staff_session=revoked']) {
    const response=await request(base+'/calendar/messages?view=attention',{redirect:'manual',headers:{Accept:'text/html',Cookie:cookie,'Sec-Fetch-Dest':'document'}});
    assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/calendar/staff?reason=session');assert.match(response.headers.get('cache-control'),/no-store/);
    const signin=await request(base+response.headers.get('location'));const html=await signin.text();
    assert.equal(signin.status,200);assert.match(html,/data-workspace-session-notice/);assert.match(html,/Sign in to continue/);assert.match(html,/Your Workspace sign-in is no longer active/);assert.doesNotMatch(html,/site timed out|\{"error":"Unauthorized"/i);
  }
  for(const options of [{headers:{Accept:'application/json'}},{headers:{Accept:'text/html','Sec-Fetch-Mode':'cors'}},{method:'POST',headers:{Accept:'text/html'}}]) {
    const response=await request(base+'/calendar/messages',{redirect:'manual',...options});assert.equal(response.status,401);assert.equal(response.headers.get('location'),null);assert.equal((await response.json()).error,'Unauthorized');
  }
  for(const reason of ['', '?reason=logout', '?reason=access', '?reason=untrusted']) {
    const response=await request(base+'/calendar/staff'+reason);assert.doesNotMatch(await response.text(),/data-workspace-session-notice/);
  }
  assert.equal(reads,0);
});
