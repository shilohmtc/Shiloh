'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClinicIpadPublicRouter } = require('../src/routes/clinicIpadCheckin');
const { validToken, createClinicIpadCheckinService } = require('../src/services/clinicIpadCheckin');
const ux = require('../src/presentation/clinicIpadCheckinUx');

const rawDevice = 'a'.repeat(43);
const rawVisit = 'b'.repeat(43);
test('clinic iPad renderer escapes submitted details and uses the repository brand mark', () => {
  const html = ux.details({ error:'Try <again>', values:{ name:'<script>alert(1)</script>' } });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Try &lt;again&gt;/);
  assert.match(html, /shiloh-mark-192\.png/);
});

test('clinic iPad capabilities require 32-byte URL-safe tokens', () => {
  assert.equal(validToken(rawDevice),true);
  assert.equal(validToken('123456'),false);
  assert.equal(validToken(`${rawDevice};other=x`),false);
});

async function withServer(service, work) {
  const app = express();
  app.use('/check-in',createClinicIpadPublicRouter({ env:{ SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true' },service }));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await work(base); } finally { await new Promise(resolve=>server.close(resolve)); }
}

test('client form requires a provisioned device and never exposes another client record',async () => {
  const calls=[];
  const service={
    deviceFor:async token=>token===rawDevice?{ id:1 }:null,
    active:async (_device,visit)=>visit===rawVisit?{ id:2 }:null,
    begin:async()=>({ token:rawVisit }),
    finish:async()=>{ calls.push('finished'); return true; },
    register:async()=>({ state:'needs_staff' }),
  };
  await withServer(service,async base=>{
    const denied=await fetch(`${base}/check-in/`,{ redirect:'manual' });
    assert.equal(denied.status,401);
    assert.doesNotMatch(await denied.text(),/Sarah Jacobs/);
    const cookie=`shiloh_checkin_device=${rawDevice}; shiloh_checkin_visit=${rawVisit}`;
    const active=await fetch(`${base}/check-in/details`,{ headers:{ Cookie:cookie } });
    assert.equal(active.status,200);
    assert.equal(active.headers.get('cache-control'),'private, no-store, max-age=0');
    const crossSite=await fetch(`${base}/check-in/details`,{ method:'POST',headers:{ Cookie:cookie,Origin:'https://other.example','Content-Type':'application/x-www-form-urlencoded' },body:'name=Sarah' });
    assert.equal(crossSite.status,403);
    const saved=await fetch(`${base}/check-in/details`,{ method:'POST',headers:{ Cookie:cookie,Origin:base,'Content-Type':'application/x-www-form-urlencoded' },body:'name=Sarah+Jacobs&mobile=0821234567&dateOfBirth=1985-05-14' });
    assert.equal(saved.status,200);
    assert.match(saved.headers.get('set-cookie'),/shiloh_checkin_visit=; Path=\/check-in/);
    assert.match(await saved.text(),/Reception will help/);
    const welcome=await fetch(`${base}/check-in/`,{ headers:{ Cookie:cookie } });
    assert.equal(welcome.status,200);
    assert.deepEqual(calls,['finished']);
  });
});

test('disabled check-in does not touch device records',async () => {
  const app=express();
  app.use('/check-in',createClinicIpadPublicRouter({ env:{},service:{ deviceFor:()=>{ throw new Error('unexpected DB read'); } } }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try {
    const res=await fetch(`http://127.0.0.1:${server.address().port}/check-in/`);
    assert.equal(res.status,404);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('device activation requires existing clinic client management authority',async () => {
  const queries=[];
  const service=createClinicIpadCheckinService({
    db:{ query:async (sql,args)=>{queries.push({sql,args});return {rows:[{id:9}]};} },
    randomToken:()=>rawDevice,
    clientMutations:{ resolveManageAccess:async id=>id===7?{ operatorAdminId:7,clientScope:{kind:'clinic'} }:null },
  });
  await assert.rejects(service.activate(8),{httpStatus:403});
  assert.equal(queries.length,0);
  const activated=await service.activate(7);
  assert.equal(activated.deviceId,9);
  assert.equal(activated.token,rawDevice);
  assert.equal(queries.length,1);
  assert.doesNotMatch(JSON.stringify(queries),new RegExp(rawDevice));
});
