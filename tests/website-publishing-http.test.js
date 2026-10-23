'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createWorkspaceWebsiteRouter}=require('../src/routes/workspaceWebsite');
const {createPublicWebsiteRouter}=require('../src/routes/publicWebsite');
const id='b06a730c-30ec-4245-9f98-2dc8eebbb2d0';
async function fixture(t){
  const calls=[];const sessionService={validateSessionToken:async token=>({ok:['owner','staff'].includes(token),adminId:token==='owner'?7:8,sessionId:1,viewer:{displayName:'Synthetic Owner'}}),validateCsrfToken:(_session,token)=>token==='synthetic-csrf',rotateCsrfToken:async()=>({ok:true,csrfToken:'synthetic-csrf'})};
  const service={resolveAccess:async admin=>admin===7,model:async()=>({posts:[{id,slug:'episode-one',kind:'episode',revision:1,draft:{title:'Synthetic episode',summary:'A readable introduction',body:'An accessible story.',episode:1}}]}),uploadImage:async value=>{calls.push(value);return{id};},edit:async value=>{calls.push(value);return{id,revision:2};},history:async()=>[]};
  const app=express();app.use(express.json());app.use('/calendar/website',createWorkspaceWebsiteRouter({env:{NODE_ENV:'test'},sessionService,service}));
  app.use(createPublicWebsiteRouter({contentService:{publicPosts:async()=>[{kind:'episode',slug:'episode-one'}],publicPost:async()=>null,media:async()=>null}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const headers={cookie:'shiloh_staff_session=owner',origin,'x-shiloh-csrf-token':'synthetic-csrf'};
  return{origin,headers,calls};
}
test('website editor and drafts require current staff session and clinic administrator authority',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.origin+'/calendar/website')).status,401);
  assert.equal((await fetch(f.origin+'/calendar/website',{headers:{cookie:'shiloh_staff_session=staff'}})).status,403);
  const editor=await fetch(f.origin+'/calendar/website',{headers:f.headers});assert.equal(editor.status,200);assert.match(editor.headers.get('cache-control'),/no-store/);assert.match(editor.headers.get('x-robots-tag'),/noindex/);
  const preview=await fetch(f.origin+`/calendar/website/${id}/preview?revision=1`,{headers:f.headers});assert.equal(preview.status,200);assert.match(await preview.text(),/Synthetic episode/);
  assert.equal((await fetch(f.origin+`/calendar/website/${id}/preview?revision=0`,{headers:f.headers})).status,409);
  assert.equal((await fetch(f.origin+'/discover/episode-one')).status,404);
});
test('multipart image upload retains origin, session, CSRF, authority and size boundaries',async t=>{
  const f=await fixture(t);const upload=async(headers,size=40)=>{const form=new FormData();form.append('image',new Blob([Buffer.alloc(size)],{type:'image/png'}),'synthetic.png');return fetch(f.origin+'/calendar/website/image',{method:'POST',headers,body:form});};
  assert.equal((await upload({...f.headers,origin:'https://unrelated.example'})).status,403);
  assert.equal((await upload({...f.headers,'x-shiloh-csrf-token':'wrong'})).status,403);
  assert.equal((await upload({...f.headers,cookie:'shiloh_staff_session=staff'})).status,403);
  assert.equal(f.calls.length,0);
  assert.equal((await upload(f.headers,2*1024*1024+1)).status,413);assert.equal(f.calls.length,0);
  assert.equal((await upload(f.headers)).status,201);assert.equal(f.calls.length,1);assert.equal(f.calls[0].adminId,7);assert.equal(f.calls[0].bytes.length,40);
});
test('editor mutations reject cross-origin/CSRF requests and bind actor to session',async t=>{
  const f=await fixture(t);const url=f.origin+`/calendar/website/${id}/publish`;
  const send=(headers,body)=>fetch(url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await send({...f.headers,origin:'https://unrelated.example'},{revision:1})).status,403);
  assert.equal((await send({...f.headers,'x-shiloh-csrf-token':'wrong'},{revision:1})).status,403);
  assert.equal((await send(f.headers,{revision:1,adminId:99})).status,422);
  assert.equal(f.calls.length,0);
  assert.equal((await send(f.headers,{revision:1,document:{title:'Synthetic'}})).status,200);assert.equal(f.calls[0].adminId,7);
});
