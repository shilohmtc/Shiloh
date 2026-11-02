'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const http=require('node:http');
const {createWorkspaceWebsiteRouter}=require('../src/routes/workspaceWebsite');
const {createPublicWebsiteRouter}=require('../src/routes/publicWebsite');
const {createStaffBrowserSessionService}=require('../src/services/staffBrowserSession');

async function serve(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});return `http://127.0.0.1:${server.address().port}`;}
test('expired Website browser navigation uses existing sign-in recovery; APIs remain unauthorized',async t=>{
  const app=express();app.use('/calendar/website',createWorkspaceWebsiteRouter({env:{NODE_ENV:'test'},sessionService:{validateSessionToken:async()=>({ok:false})},service:{}}));
  const base=await serve(t,app);
  // Node fetch supplies its own sec-fetch-mode; send an actual navigation header without that override.
  const browser=await new Promise((resolve,reject)=>http.get(base+'/calendar/website',{headers:{Accept:'text/html','sec-fetch-mode':'navigate'}},r=>{r.resume();resolve(r)}).on('error',reject));
  assert.equal(browser.statusCode,302);assert.equal(browser.headers.location,'/calendar/staff?reason=session');
  const api=await fetch(base+'/calendar/website/example/history',{headers:{Accept:'application/json'}});assert.equal(api.status,401);assert.equal(api.headers.get('location'),null);
  const write=await fetch(base+'/calendar/website/example/save',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(write.status,401);
});
test('Website retains token rotation, origin, actor and CSRF enforcement across two tabs',async t=>{
  let hash;const db={query:async(sql,args)=>{assert.match(sql,/UPDATE staff_browser_sessions/);hash=args[1];return{rowCount:1}}};
  const sessions=createStaffBrowserSessionService({db});sessions.validateSessionToken=async()=>({ok:true,sessionId:1,adminId:7,csrfHash:hash,viewer:{displayName:'Synthetic'}});
  const writes=[];const app=express();app.use(express.json());app.use('/calendar/website',createWorkspaceWebsiteRouter({env:{NODE_ENV:'test'},sessionService:sessions,service:{resolveAccess:async()=>true,model:async()=>({posts:[]}),edit:async value=>{writes.push(value);return{ok:true}}}}));
  const base=await serve(t,app);const first=await(await fetch(base+'/calendar/website')).text();const old=first.match(/data-csrf="([^"]+)"/)[1];await fetch(base+'/calendar/website');
  const send=(token,origin=base)=>fetch(base+'/calendar/website/synthetic/save',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify({revision:1,document:{title:'Synthetic'}})});
  assert.equal((await send(old)).status,403);assert.equal(writes.length,0);
  const fresh=await sessions.rotateCsrfToken(1);
  assert.equal((await send(fresh.csrfToken,'https://unrelated.example')).status,403);assert.equal(writes.length,0);
  assert.equal((await send(fresh.csrfToken)).status,200);assert.equal(writes.length,1);assert.equal(writes[0].adminId,7);
});
test('editorial failures offer branded recovery, preserve status and never claim offers are empty or available',async t=>{
  const app=express();app.use(createPublicWebsiteRouter({contentService:{publicPosts:async()=>{throw new Error('Synthetic outage')},publicPost:async()=>{throw new Error('Synthetic outage')}}}));const base=await serve(t,app);
  for(const path of ['/discover','/offers','/discover/example','/offers/example']){
    const r=await fetch(base+path);assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'60');assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('content-type'),/text\/html/);
    const html=await r.text();assert.match(html,/Try again/);assert.match(html,/Contact Shiloh/);assert.match(html,/can’t confirm current offers/);assert.doesNotMatch(html,/There are no current offers|20% off|Internal server error/);
  }
  const sitemap=await fetch(base+'/sitemap.xml');assert.equal(sitemap.status,503);assert.match(sitemap.headers.get('content-type'),/xml/);assert.match(await sitemap.text(),/<loc>https:\/\/shilohmtc.co.za\/contact<\/loc>/);
});
test('missing articles retain navigation and remain 404; legitimate empty lists remain 200',async t=>{
  const app=express();app.use(createPublicWebsiteRouter({contentService:{publicPosts:async()=>[],publicPost:async()=>null}}));const base=await serve(t,app);
  const missing=await fetch(base+'/discover/missing');assert.equal(missing.status,404);const html=await missing.text();assert.match(html,/This page is no longer available/);assert.match(html,/href="\/contact"/);assert.doesNotMatch(html,/>Try again</);
  const empty=await fetch(base+'/offers');assert.equal(empty.status,200);assert.match(await empty.text(),/There are no current offers/);
  const sitemap=await fetch(base+'/sitemap.xml');assert.equal(sitemap.status,200);
});
