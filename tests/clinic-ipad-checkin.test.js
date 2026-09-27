'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createClinicIpadPublicRouter,createClinicIpadSetupRouter,originMatches } = require('../src/routes/clinicIpadCheckin');
const { createClientConsultationFormsRouter } = require('../src/routes/clientConsultationForms');
const { validToken, createClinicIpadCheckinService } = require('../src/services/clinicIpadCheckin');
const { evaluateClientManageAuthority } = require('../src/services/workspaceClientMutations');
const { evaluateFormsReadAuthority } = require('../src/services/workspaceForms');
const { evaluateCalendarAuthority, CALENDAR_CAPABILITIES, hasCapability } = require('../src/services/calendarAuthorization');
const ux = require('../src/presentation/clinicIpadCheckinUx');
const { injectClientListManagement } = require('../src/presentation/workspaceClientsManageUx');

const rawDevice = 'a'.repeat(43);
const rawVisit = 'b'.repeat(43);
test('clinic iPad renderer escapes submitted details and uses the repository brand mark', () => {
  const html = ux.details({ error:'Try <again>', values:{ name:'<script>alert(1)</script>' } });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Try &lt;again&gt;/);
  assert.match(html, /shiloh-mark-192\.png/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="Shiloh Check-in"/);
  assert.match(html, /apple-touch-icon" href="\/assets\/brand\/shiloh-apple-touch-180\.png"/);
  assert.match(html, /href="\/check-in\/manifest\.webmanifest"/);
  assert.doesNotMatch(ux.devices([]),/apple-mobile-web-app-capable/);
});

test('staff form delivery choice appears only when approved WhatsApp delivery is ready',()=>{
  assert.match(ux.devices([],{whatsappReady:true}),/data-whatsapp-ready="true"/);
  assert.match(ux.devices([]),/data-whatsapp-ready="false"/);
});

test('Workspace shows iPad controls only for authorised clinic client management while enabled',() => {
  const html='<html><head><style></style></head><body><main data-clients-list-view></main></body></html>';
  const clinic={ manageAllowed:true,authority:{clientScope:{kind:'clinic'}} };
  assert.match(injectClientListManagement(html,clinic,{checkinEnabled:true}),/\/calendar\/check-in\/devices/);
  assert.doesNotMatch(injectClientListManagement(html,clinic),/\/calendar\/check-in\/devices/);
  assert.doesNotMatch(injectClientListManagement(html,{...clinic,authority:{clientScope:{kind:'tenant_staff'}}},{checkinEnabled:true}),/\/calendar\/check-in\/devices/);
});

test('clinic iPad capabilities require 32-byte URL-safe tokens', () => {
  assert.equal(validToken(rawDevice),true);
  assert.equal(validToken('123456'),false);
  assert.equal(validToken(`${rawDevice};other=x`),false);
});

test('Christel and Reception qualify for identical clinic iPad form preparation',async () => {
  const permissions={ 'client:manage':true,'forms:view':true,
    'appointment:create':true,'client:lookup':true };
  for (const [id,display_name,business_role,staff_id] of [
    [2,'Christel','owner',12],[3,'Shiloh Reception','booking_operator',null],
  ]) {
    const principal={id,display_name,business_role,staff_id,staff_status:staff_id?'active':null,
      admin_active:true,calendar_scope:'all_business',service_scope:'all_services',permissions};
    const manage=evaluateClientManageAuthority([principal]);
    const forms=evaluateFormsReadAuthority([principal]);
    const calendar=evaluateCalendarAuthority(principal);
    assert.equal(manage?.clientScope.kind,'clinic');
    assert.equal(forms?.formScope,'all_business');
    assert.equal(calendar?.calendarScope,'all_business');
    assert.equal(hasCapability(calendar,CALENDAR_CAPABILITIES.BOOKING_CREATE),true);
    assert.equal(hasCapability(calendar,CALENDAR_CAPABILITIES.CLIENT_LOOKUP),true);
    const service=createClinicIpadCheckinService({
      clientMutations:{resolveManageAccess:async()=>manage},
    });
    assert.equal((await service.canActivate(id))?.operatorAdminId,id);
  }
});

async function withServer(service, work) {
  const app = express();
  app.use('/check-in',createClinicIpadPublicRouter({ env:{ SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true' },service }));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await work(base); } finally { await new Promise(resolve=>server.close(resolve)); }
}

test('check-in Home Screen app has its own name, scope, welcome launch and official icon',async()=>{
  await withServer({ deviceFor:async()=>null },async base=>{
    const response=await fetch(`${base}/check-in/manifest.webmanifest`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/application\/manifest\+json/);
    const manifest=await response.json();
    assert.equal(manifest.name,'Shiloh Client Check-in');
    assert.equal(manifest.short_name,'Shiloh Check-in');
    assert.equal(manifest.start_url,'/check-in/');
    // Prepared consultation forms live at /forms/f/, so they stay in app mode.
    assert.equal(manifest.scope,'/');
    assert.equal(manifest.id,'/check-in/');
    assert.equal(manifest.display,'standalone');
    assert.match(manifest.icons[0].src,/shiloh-mark-192\.png/);
  });
});

test('client form requires a provisioned device and never exposes another client record',async () => {
  const calls=[];
  const service={
    deviceFor:async token=>token===rawDevice?{ id:1 }:null,
    active:async (_device,visit)=>visit===rawVisit?{ id:2 }:null,
    begin:async()=>({ token:rawVisit }),
    finish:async()=>{ calls.push('finished'); return true; },
    cancelDeviceForm:async()=>{},
    readyForm:async()=>false,
    register:async()=>({ state:'needs_staff' }),
  };
  await withServer(service,async base=>{
    const denied=await fetch(`${base}/check-in/`,{ redirect:'manual' });
    assert.equal(denied.status,401);
    assert.doesNotMatch(denied.headers.get('set-cookie')||'',/shiloh_checkin_device=/);
    assert.doesNotMatch(await denied.text(),/Sarah Jacobs/);
    const cookie=`shiloh_checkin_device=${rawDevice}; shiloh_checkin_visit=${rawVisit}`;
    const active=await fetch(`${base}/check-in/details`,{ headers:{ Cookie:cookie } });
    assert.equal(active.status,200);
    assert.match(active.headers.get('set-cookie'),/shiloh_checkin_device=aaaa.*Max-Age=2592000/);
    assert.equal(active.headers.get('cache-control'),'private, no-store, max-age=0');
    const crossSite=await fetch(`${base}/check-in/details`,{ method:'POST',headers:{ Cookie:cookie,Origin:'https://other.example','Content-Type':'application/x-www-form-urlencoded' },body:'name=Sarah' });
    assert.equal(crossSite.status,403);
    const opaqueCrossSite=await fetch(`${base}/check-in/details`,{method:'POST',headers:{Cookie:cookie,Origin:'null','Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','Content-Type':'application/x-www-form-urlencoded'},body:'name=Sarah'});
    assert.equal(opaqueCrossSite.status,403);
    const saved=await fetch(`${base}/check-in/details`,{ method:'POST',headers:{ Cookie:cookie,Origin:base,'Content-Type':'application/x-www-form-urlencoded' },body:'name=Sarah+Jacobs&mobile=0821234567&dateOfBirth=1985-05-14' });
    assert.equal(saved.status,200);
    assert.match(saved.headers.get('set-cookie'),/shiloh_checkin_visit=; Path=\/check-in/);
    assert.match(await saved.text(),/Reception will help/);
    const welcome=await fetch(`${base}/check-in/`,{ headers:{ Cookie:cookie } });
    assert.equal(welcome.status,200);
    assert.match(welcome.headers.get('set-cookie'),/shiloh_checkin_device=aaaa.*Max-Age=2592000/);
    assert.deepEqual(calls,['finished']);
  });
});

test('opaque Chromium form origin requires same-origin navigation metadata',()=>{
  const header={'origin':'null','sec-fetch-site':'same-origin','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
  const req={get:name=>header[name]};
  assert.equal(originMatches(req),true);
  header['sec-fetch-site']='cross-site';
  assert.equal(originMatches(req),false);
  delete header['sec-fetch-site'];
  assert.equal(originMatches(req),false);
});

test('Safari form posts without Origin use the iPad page token, while cross-site posts remain blocked',async()=>{
  const service={
    deviceFor:async token=>token===rawDevice?{id:1}:null,
    finish:async()=>true,cancelDeviceForm:async()=>{},readyForm:async()=>false,
    begin:async()=>({token:rawVisit}),active:async()=>({id:2}),
  };
  await withServer(service,async base=>{
    const cookie=`shiloh_checkin_device=${rawDevice}`;
    const welcome=await fetch(`${base}/check-in/`,{headers:{Cookie:cookie}});
    const html=await welcome.text();
    const token=html.match(/name="checkinFormToken" value="([A-Za-z0-9_-]{43})"/)?.[1];
    assert.ok(token);
    const form=new URLSearchParams({checkinFormToken:token});
    const headers={Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'};
    const missing=await fetch(`${base}/check-in/start`,{method:'POST',headers,body:'',redirect:'manual'});
    assert.equal(missing.status,403);
    const crossSite=await fetch(`${base}/check-in/start`,{method:'POST',headers:{...headers,Origin:'https://other.example'},body:form,redirect:'manual'});
    assert.equal(crossSite.status,403);
    const foreignMetadata=await fetch(`${base}/check-in/start`,{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'},body:form,redirect:'manual'});
    assert.equal(foreignMetadata.status,403);
    const safari=await fetch(`${base}/check-in/start`,{method:'POST',headers,body:form,redirect:'manual'});
    assert.equal(safari.status,303);
    assert.equal(safari.headers.get('location'),'/check-in/details');
    const opaqueSafari=await fetch(`${base}/check-in/start`,{method:'POST',headers:{...headers,Origin:'null'},body:form,redirect:'manual'});
    assert.equal(opaqueSafari.status,303);
  });
});

test('a prepared form remains hidden until the client confirms their mobile and date of birth',async () => {
  const service={ deviceFor:async()=>({ id:1 }),readyForm:async()=>true,
    beginForm:async (_token,details)=>details.mobile==='0821234567'&&details.dateOfBirth==='1985-05-14'
      ? { formToken:rawDevice,visitToken:rawVisit } : { verified:false } };
  await withServer(service,async base=>{
    const headers={ Cookie:`shiloh_checkin_device=${rawDevice}`,Origin:base,'Content-Type':'application/x-www-form-urlencoded' };
    const verify=await fetch(`${base}/check-in/verify`,{headers});
    assert.equal(verify.status,200);
    assert.match(await verify.text(),/Confirm it’s you/);
    const wrong=await fetch(`${base}/check-in/start-form`,{method:'POST',headers,body:'mobile=0821234567&dateOfBirth=1990-01-01',redirect:'manual'});
    assert.equal(wrong.status,422);
    assert.doesNotMatch(await wrong.text(),new RegExp(rawDevice));
    const right=await fetch(`${base}/check-in/start-form`,{method:'POST',headers,body:'mobile=0821234567&dateOfBirth=1985-05-14',redirect:'manual'});
    assert.equal(right.status,303);
    assert.equal(right.headers.get('location'),`/forms/f/${rawDevice}`);
    assert.match(right.headers.get('set-cookie'),/shiloh_checkin_form=.*Path=\/forms/);
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

test('one-time setup code requires clinic authority and can be redeemed only once',async()=>{
  let pending=null,device=null;
  let currentTime=new Date('2026-09-27T09:00:00Z');
  let nextCode='1234567890';
  const query=async(sql,args=[])=>{
    if (sql==='BEGIN' || sql==='COMMIT' || sql==='ROLLBACK') return {rowCount:0,rows:[]};
    if (sql.includes('INSERT INTO clinic_checkin_setup_codes')) {
      pending={hash:args[0],adminId:args[1],expiresAt:args[2],consumed:false};
      return {rowCount:1,rows:[{code_hash:args[0]}]};
    }
    if (sql.includes('UPDATE clinic_checkin_setup_codes SET redeemed_at')) {
      if (pending?.hash===args[0] && !pending.consumed && pending.expiresAt>args[1]) {
        pending.consumed=true;return {rowCount:1,rows:[{created_by_admin_id:pending.adminId}]};
      }
      return {rowCount:0,rows:[]};
    }
    if (sql.includes('INSERT INTO clinic_checkin_devices')) {
      device={hash:args[0],adminId:args[1]};return {rowCount:1,rows:[{id:9}]};
    }
    if (sql.includes('UPDATE clinic_checkin_setup_codes SET device_id')) return {rowCount:1,rows:[]};
    throw new Error(`Unexpected query: ${sql}`);
  };
  const service=createClinicIpadCheckinService({db:{query,connect:async()=>({query,release(){}})},
    now:()=>currentTime,randomSetupCode:()=> nextCode,randomToken:()=>rawDevice,
    clientMutations:{resolveManageAccess:async id=>id===7?{operatorAdminId:7,clientScope:{kind:'clinic'}}:null}});
  await assert.rejects(service.createSetupCode(8),{httpStatus:403});
  const setup=await service.createSetupCode(7);
  assert.equal(setup.code,'1234567890');
  assert.equal(pending.hash,crypto.createHash('sha256').update(setup.code).digest('hex'));
  assert.equal((await service.redeemSetupCode(setup.code)).token,rawDevice);
  assert.equal(device.adminId,7);
  assert.notEqual(device.hash,rawDevice);
  await assert.rejects(service.redeemSetupCode(setup.code),{httpStatus:409});
  nextCode='9876543210';
  await service.createSetupCode(7);
  currentTime=new Date('2026-09-27T09:06:00Z');
  await assert.rejects(service.redeemSetupCode(nextCode),{httpStatus:409});
});

test('iPad activates using a staff-created code without signing in to Workspace',async()=>{
  const service={deviceFor:async()=>null,redeemSetupCode:async code=>{
    assert.equal(code,'1234567890');return {deviceId:9,token:rawDevice};
  }};
  await withServer(service,async base=>{
    const setup=await fetch(`${base}/check-in/`);
    assert.equal(setup.status,401);
    const html=await setup.text();
    assert.match(html,/Create setup code/);
    assert.doesNotMatch(html,/sign in to Workspace/);
    const nonce=html.match(/name="setupNonce" value="([A-Za-z0-9_-]{43})"/)[1];
    const setupCookie=setup.headers.getSetCookie().find(value=>value.startsWith('shiloh_checkin_setup='));
    const cookie=setupCookie.split(';')[0],body=`setupNonce=${nonce}&setupCode=1234567890`;
    const foreign=await fetch(`${base}/check-in/redeem-code`,{method:'POST',headers:{Cookie:cookie,Origin:'https://foreign.example','Content-Type':'application/x-www-form-urlencoded'},body,redirect:'manual'});
    assert.equal(foreign.status,403);
    const response=await fetch(`${base}/check-in/redeem-code`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body,redirect:'manual'});
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),'/check-in/');
    assert.match(response.headers.getSetCookie().join('\n'),/shiloh_checkin_device=.*HttpOnly/);
  });
});

test('only an authenticated staff Workspace session can create a setup code',async()=>{
  const app=express();app.use(express.json());
  app.use('/calendar/check-in',createClinicIpadSetupRouter({
    env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},
    sessionService:{validateSessionToken:async token=>token==='abc'?{ok:true,adminId:7,sessionId:11}:{ok:false},validateCsrfToken:async()=>true},
    service:{createSetupCode:async id=>{assert.equal(id,7);return {code:'1234567890',expiresInSeconds:300};}},
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const denied=await fetch(`${base}/calendar/check-in/setup-code`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});
    assert.notEqual(denied.status,200);
    const response=await fetch(`${base}/calendar/check-in/setup-code`,{method:'POST',headers:{Origin:base,Cookie:'shiloh_staff_session=abc','X-Shiloh-Csrf-Token':'proof','Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{code:'1234567890',expiresInSeconds:300});
    assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
    assert.doesNotMatch(response.headers.getSetCookie().join('\n'),/shiloh_checkin_device/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('activation clears staff and client cookies before handing the iPad to a visitor',async () => {
  const revoked=[];
  const app=express();
  app.use(express.json());
  app.use('/calendar/check-in',createClinicIpadSetupRouter({
    env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true',NODE_ENV:'production'},
    sessionService:{validateSessionToken:async()=>({ok:true,adminId:7,sessionId:11}),
      validateCsrfToken:async()=>true,revokeSession:async(...args)=>revoked.push(args)},
    service:{activate:async()=>({deviceId:9,token:rawDevice})},
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const response=await fetch(`${base}/calendar/check-in/activate`,{
      method:'POST',headers:{Origin:base.replace('http:','https:'),'X-Forwarded-Proto':'https',Cookie:'__Host-shiloh_staff_session=abc','X-Shiloh-Csrf-Token':'proof','Content-Type':'application/json'},body:'{}',
    });
    assert.equal(response.status,200);
    assert.deepEqual(revoked,[[11,'clinic_ipad_activated']]);
    const cookies=response.headers.getSetCookie().join('\n');
    assert.match(cookies,/shiloh_checkin_device=.*Path=\/check-in.*HttpOnly.*Secure/);
    assert.match(cookies,/Max-Age=0/);
    assert.doesNotMatch(JSON.stringify(await response.json()),new RegExp(rawDevice));
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('Christel and Reception share the staff-only WhatsApp form action',async () => {
  const sent=[];
  const app=express();app.use(express.json());
  app.use('/calendar/check-in',createClinicIpadSetupRouter({
    env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},
    sessionService:{validateSessionToken:async token=>({ok:true,adminId:Number(token),sessionId:1}),
      validateCsrfToken:()=>true},
    service:{listFormAssignments:async adminId=>adminId===2||adminId===3?[{id:7}]:[]},
    deliveryService:{sendAssignmentNow:async(id,options)=>{sent.push([id,options.actorAdminId]);return {sent:true};}},
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const id of [2,3,4]){
      const response=await fetch(`${base}/calendar/check-in/send-form`,{
        method:'POST',headers:{Origin:base,Cookie:`shiloh_staff_session=${id}`,
          'X-Shiloh-Csrf-Token':'proof','Content-Type':'application/json'},
        body:JSON.stringify({appointmentId:42,assignmentId:7}),
      });
      assert.equal(response.status,id===4?409:200);
    }
    assert.deepEqual(sent,[[7,2],[7,3]]);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('five mismatched form identity attempts cancel the handoff without issuing a link',async () => {
  const pending={id:3,assignment_id:5,attempts:0};
  let issued=0,started=0;
  const connection={query:async (sql)=>{
    if (sql==='BEGIN') {started++;return {};}
    if (sql==='COMMIT'||sql==='ROLLBACK') return {};
    if (sql.includes('FROM clinic_checkin_form_handoffs')) return pending.attempts<5
      ? {rowCount:1,rows:[pending]}:{rowCount:0,rows:[]};
    if (sql.includes('FROM consultation_form_assignments')) return {rows:[{normalized_mobile:'27821234567',date_of_birth:'1985-05-14'}]};
    if (sql.includes('SET attempts=attempts+1')) {pending.attempts++;return {rowCount:1};}
    throw new Error('Unexpected query');
  },release:()=>{}};
  const service=createClinicIpadCheckinService({
    db:{query:async()=>({rows:[{id:9}]}),connect:async()=>connection},
    formService:{issueAccessToken:async()=>{issued++;return {token:rawDevice};}},
  });
  for(let attempt=0;attempt<5;attempt++) assert.deepEqual(await service.beginForm(rawDevice,{mobile:'0820000000',dateOfBirth:'1985-05-14'}),{verified:false});
  await assert.rejects(service.beginForm(rawDevice,{mobile:'0821234567',dateOfBirth:'1985-05-14'}),{httpStatus:409});
  assert.equal(pending.attempts,5);
  assert.equal(started,6);
  assert.equal(issued,0);
});

test('disabled device immediately loses its check-in capability',async () => {
  let disabled=false;
  const db={ query:async (sql)=>{
    if (sql.includes('UPDATE clinic_checkin_devices')) { disabled=true; return { rowCount:1,rows:[{id:9}] }; }
    if (sql.includes('UPDATE clinic_checkin_form_handoffs')) return { rowCount:0,rows:[] };
    if (sql.includes('SELECT id,activated_by_admin_id')) return { rows:disabled?[]:[{id:9,activated_by_admin_id:7}] };
    throw new Error('Unexpected database query');
  } };
  const service=createClinicIpadCheckinService({
    db,
    clientMutations:{ resolveManageAccess:async()=>({ operatorAdminId:7,clientScope:{kind:'clinic'} }) },
  });
  assert.equal((await service.deviceFor(rawDevice)).id,9);
  assert.equal(await service.revoke(7,9),true);
  assert.equal(await service.deviceFor(rawDevice),null);
});

test('appointment form on an iPad requires its current visit and is invalid after submission',async () => {
  let ended=false;
  let opened=0;
  const app=express();
  app.use('/forms',createClientConsultationFormsRouter({
    env:{ SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED:'true',SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true',CONSULTATION_FORM_DATA_KEY:'a'.repeat(43) },
    service:{ isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32),
      openForm:async()=>{opened++;return { completed:false };},submitForm:async()=>({}) },
    clinicCheckin:{ formAccess:async (_token,visit)=>({ kiosk:true,allowed:visit===rawVisit&&!ended }),
      finishForm:async()=>{ended=true;return true;} },
    renderForm:()=>'<html><body>PRIVATE HEALTH ANSWERS</body></html>',
    renderUnavailable:()=>'<html><body>Session ended</body></html>',
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const denied=await fetch(`${base}/forms/f/${rawDevice}`);
    assert.equal(denied.status,410);
    assert.equal(opened,0);
    const cookie=`shiloh_checkin_form=${rawVisit}`;
    const visible=await fetch(`${base}/forms/f/${rawDevice}`,{headers:{Cookie:cookie}});
    assert.equal(visible.status,200);
    assert.match(await visible.text(),/clinic-ipad-reset\.js/);
    const submitted=await fetch(`${base}/forms/f/${rawDevice}`,{
      method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:'signature_name=Sarah',
    });
    assert.equal(submitted.status,303);
    assert.equal(submitted.headers.get('location'),'/check-in/thank-you');
    const after=await fetch(`${base}/forms/f/${rawDevice}`,{headers:{Cookie:cookie}});
    assert.equal(after.status,410);
    assert.equal(opened,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('form token remains bound to one visit and is denied after timeout or device revocation',async () => {
  const visitHash=crypto.createHash('sha256').update(rawVisit).digest('hex');
  const row={ id:4,status:'claimed',visit_token_hash:visitHash,
    expires_at:new Date(Date.now()+60_000),revoked_at:null };
  const service=createClinicIpadCheckinService({
    db:{query:async sql=>{
      if (sql.includes('FROM clinic_checkin_form_handoffs h')) return {rows:[row]};
      throw new Error('Unexpected query');
    }},
  });
  assert.deepEqual(await service.formAccess(rawDevice,rawVisit),{kiosk:true,allowed:true});
  assert.deepEqual(await service.formAccess(rawDevice,'c'.repeat(43)),{kiosk:true,allowed:false});
  row.expires_at=new Date(Date.now()-1);
  assert.deepEqual(await service.formAccess(rawDevice,rawVisit),{kiosk:true,allowed:false});
  row.expires_at=new Date(Date.now()+60_000);row.revoked_at=new Date();
  assert.deepEqual(await service.formAccess(rawDevice,rawVisit),{kiosk:true,allowed:false});
});

test('staff cannot queue clinical forms with client management alone',async () => {
  const service=createClinicIpadCheckinService({
    db:{ query:()=>{ throw new Error('No form data should be read'); } },
    clientMutations:{resolveManageAccess:async()=>({operatorAdminId:7,clientScope:{kind:'clinic'}})},
    formsAuthority:{resolveAccess:async()=>null},
  });
  await assert.rejects(service.queueForm(7,1,42,2),{httpStatus:403});
});

test('a form already sent to WhatsApp cannot be reissued by preparing the iPad',async()=>{
  const db={query:async sql=>{
    if(sql.includes('calendarAuthorization:principal')) return {rows:[{id:2,admin_active:true,
      calendar_scope:'all_business',service_scope:'all_services',business_role:'owner',
      permissions:{'appointment:create':true,'client:lookup':true}}]};
    if(sql.includes('FROM consultation_form_assignments a')) return {rows:[{id:7,status:'sent'}]};
    throw new Error(`Unexpected query: ${sql}`);
  },connect:async()=>{throw new Error('No new handoff should be created');}};
  const service=createClinicIpadCheckinService({db,
    clientMutations:{resolveManageAccess:async()=>({operatorAdminId:2,clientScope:{kind:'clinic'}})},
    formsAuthority:{resolveAccess:async()=>({formScope:'all_business'})},
  });
  await assert.rejects(service.queueForm(2,1,42,7),{httpStatus:409});
});
