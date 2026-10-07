'use strict';

const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const { createHmac, timingSafeEqual, randomBytes } = require('crypto');
const { createClinicIpadCheckinService, CheckinError, validToken } = require('../services/clinicIpadCheckin');
const { requireStaffSession, sameOriginGuard, csrfGuard, parseCookieValue, expectedOrigin,
  serializeExpiredSessionCookie } = require('../middleware/staffBrowserSession');
const { serializeExpiredClientSessionCookie, serializeExpiredClientAuthCookie } = require('../middleware/clientBrowserSession');
const ux = require('../presentation/clinicIpadCheckinUx');

const DEVICE_COOKIE = 'shiloh_checkin_device';
const DEVICE_IDLE_SECONDS = 30*24*60*60;
const VISIT_COOKIE = 'shiloh_checkin_visit';
const FORM_COOKIE = 'shiloh_checkin_form';
const SETUP_COOKIE = 'shiloh_checkin_setup';
const PAIR_COOKIE = 'shiloh_checkin_pair';
const setupAttempts = new Map();
const pairStarts = new Map();
function formToken(deviceToken) {
  return createHmac('sha256',deviceToken).update('shiloh-clinic-ipad-form-v1').digest('base64url');
}
function hasFormToken(req) {
  const provided = req.body?.checkinFormToken;
  if (typeof provided !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return false;
  const expected = formToken(req.checkinDeviceToken);
  return timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
}
function cookie(name, value, { env = process.env, seconds = 0 } = {}) {
  const path = name === FORM_COOKIE ? '/forms' : '/check-in';
  const parts = [`${name}=${value}`, `Path=${path}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${seconds}`];
  if (String(env.NODE_ENV).toLowerCase() === 'production') parts.push('Secure');
  return parts.join('; ');
}
function headers(res) {
  res.set('Cache-Control','private, no-store, max-age=0');
  res.set('Pragma','no-cache');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Robots-Tag','noindex, nofollow, noarchive');
  res.set('X-Frame-Options','DENY');
  res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function originMatches(req) {
  const origin = req.get('origin');
  // Chromium sends Origin: null for native form posts from a no-referrer page.
  // Fetch Metadata still identifies the same-origin top-level navigation.
  if (!origin || origin === 'null') return req.get('sec-fetch-site') === 'same-origin'
    && req.get('sec-fetch-mode') === 'navigate' && req.get('sec-fetch-dest') === 'document';
  try { return new URL(origin).origin === expectedOrigin(req); }
  catch (_error) { return false; }
}
function createClinicIpadPublicRouter({ env = process.env, service = createClinicIpadCheckinService() } = {}) {
  const router = express.Router();
  router.use((_req,res,next) => { headers(res); next(); });
  router.use((_req,res,next) => String(env.SHILOH_CLINIC_IPAD_CHECKIN_ENABLED).toLowerCase() === 'true' ? next() : res.sendStatus(404));
  router.get('/manifest.webmanifest',(_req,res) => res.type('application/manifest+json').send({
    name:'Shiloh Client Check-in',short_name:'Shiloh Check-in',
    id:'/check-in/',start_url:'/check-in/',scope:'/',display:'standalone',
    background_color:'#f6f3eb',theme_color:'#f6f3eb',
    icons:[
      { src:'/assets/brand/shiloh-mark-192.png',sizes:'192x192',type:'image/png' },
      { src:'/assets/brand/shiloh-mark-512.png',sizes:'512x512',type:'image/png' }
    ]
  }));
  router.use(express.urlencoded({ extended:false,limit:'4kb',parameterLimit:8 }));
  router.get('/pair.js',(_req,res)=>res.type('application/javascript').send('setTimeout(()=>location.reload(),3000);'));
  router.get('/pair',async(req,res,next)=>{
    try {
      if (await service.deviceFor(parseCookieValue(req.headers.cookie,DEVICE_COOKIE))) return res.redirect(303,'/check-in/');
      const existing=parseCookieValue(req.headers.cookie,PAIR_COOKIE);
      const match=/^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(existing||'');
      let pairing=match?await service.pairFor(match[2],match[1]):null;
      if (pairing?.device_id) {
        const device=await service.deviceFor(match[2]);
        if (!device || String(device.id)!==String(pairing.device_id)) throw new CheckinError('This iPad pairing could not be completed.',409);
        res.setHeader('Set-Cookie',[
          cookie(DEVICE_COOKIE,match[2],{env,seconds:DEVICE_IDLE_SECONDS}),
          cookie(PAIR_COOKIE,'',{env,seconds:0}),
          serializeExpiredSessionCookie({env}),serializeExpiredClientSessionCookie({env}),serializeExpiredClientAuthCookie({env}),
        ]);
        return res.redirect(303,'/check-in/');
      }
      let pairId=pairing?match[1]:null;
      if (!pairId) {
        const key=req.ip||req.socket.remoteAddress||'unknown',time=Date.now();
        const starts=(pairStarts.get(key)||[]).filter(at=>time-at<10*60*1000);
        if (starts.length>=10) return res.status(429).type('html').send(ux.shell('<h1>Ask reception for help.</h1><p>Too many setup QR codes were requested. Please wait ten minutes before trying again.</p>'));
        starts.push(time);pairStarts.set(key,starts);
        const created=await service.startPair();pairId=created.pairId;
        res.append('Set-Cookie',cookie(PAIR_COOKIE,`${pairId}.${created.token}`,{env,seconds:5*60}));
      }
      const url=new URL('/calendar/check-in/approve-pair',expectedOrigin(req));
      url.searchParams.set('pair',pairId);
      const svg=await QRCode.toString(url.href,{type:'svg',width:280,margin:2});
      return res.type('html').send(ux.pair(svg,pairId));
    }catch(error){next(error);}
  });
  router.post('/redeem-code',async(req,res,next)=>{
    const nonce=parseCookieValue(req.headers.cookie,SETUP_COOKIE);
    const entered=req.body?.setupNonce;
    const origin=req.get('origin');
    if ((origin && origin!=='null' && !originMatches(req)) || req.get('sec-fetch-site')==='cross-site'
      || !validToken(nonce) || !validToken(entered)
      || !timingSafeEqual(Buffer.from(nonce),Buffer.from(entered))) return res.sendStatus(403);
    const key=req.ip||req.socket.remoteAddress||'unknown',time=Date.now();
    const attempts=(setupAttempts.get(key)||[]).filter(at=>time-at<10*60*1000);
    if (attempts.length>=10) return res.status(429).type('html').send(ux.welcome({setup:true,setupNonce:nonce,error:'Too many attempts. Please wait ten minutes before trying again.'}));
    try {
      const activated=await service.redeemSetupCode(req.body?.setupCode);
      setupAttempts.delete(key);
      res.setHeader('Set-Cookie',[
        cookie(DEVICE_COOKIE,activated.token,{env,seconds:DEVICE_IDLE_SECONDS}),
        cookie(SETUP_COOKIE,'',{env,seconds:0}),
        serializeExpiredSessionCookie({env}),
        serializeExpiredClientSessionCookie({env}),
        serializeExpiredClientAuthCookie({env}),
      ]);
      return res.redirect(303,'/check-in/');
    }catch(error){
      if (!(error instanceof CheckinError)) return next(error);
      attempts.push(time); setupAttempts.set(key,attempts);
      return res.status(error.httpStatus).type('html').send(ux.welcome({setup:true,setupNonce:nonce,error:error.message}));
    }
  });
  router.use(async (req,res,next) => {
    try {
      req.checkinDeviceToken = parseCookieValue(req.headers.cookie, DEVICE_COOKIE);
      req.checkinDevice = await service.deviceFor(req.checkinDeviceToken);
      if (!req.checkinDevice) {
        const nonce=randomBytes(32).toString('base64url');
        res.append('Set-Cookie',cookie(SETUP_COOKIE,nonce,{env,seconds:10*60}));
        return res.status(401).type('html').send(ux.welcome({setup:true,setupNonce:nonce}));
      }
      // Renew only a verified, non-revoked iPad capability during normal use.
      // An idle iPad still requires a staff member to activate it after 30 days.
      if (req.method === 'GET') res.append('Set-Cookie',cookie(DEVICE_COOKIE,req.checkinDeviceToken,{ env,seconds:DEVICE_IDLE_SECONDS }));
      next();
    } catch (error) { next(error); }
  });
  router.get('/form-ready',async(req,res,next)=>{try{return res.json({ready:await service.readyForm(req.checkinDeviceToken)});}catch(error){next(error);}});
  router.get('/welcome.js',(_req,res)=>res.type('application/javascript').send(`(()=>{if(document.querySelector('[data-form-ready]'))return;setInterval(async()=>{try{const r=await fetch('/check-in/form-ready',{cache:'no-store'});if(r.ok&&(await r.json()).ready)location.reload();}catch(_error){}},3000);})();`));
  router.get('/client.js',(_req,res) => res.type('application/javascript').sendFile(path.join(__dirname,'..','..','public','check-in','client.js')));
  router.get('/', async (req,res,next) => {
    try {
      const prior = parseCookieValue(req.headers.cookie, VISIT_COOKIE);
      if (prior) await service.finish(req.checkinDeviceToken,prior);
      await service.cancelDeviceForm(req.checkinDeviceToken);
      res.append('Set-Cookie',cookie(VISIT_COOKIE,'',{ env,seconds:0 }));
      res.append('Set-Cookie',cookie(FORM_COOKIE,'',{ env,seconds:0 }));
      return res.type('html').send(ux.welcome({ formReady:await service.readyForm(req.checkinDeviceToken),csrfToken:formToken(req.checkinDeviceToken) }));
    } catch (error) { next(error); }
  });
  router.get('/thank-you',(_req,res) => res.type('html').send(ux.done()));
  router.get('/verify',async (req,res,next) => {
    try {
      if (!await service.readyForm(req.checkinDeviceToken)) return res.redirect(303,'/check-in/');
      return res.type('html').send(ux.verify({...await service.formDetails(req.checkinDeviceToken),csrfToken:formToken(req.checkinDeviceToken)}));
    } catch(error) { next(error); }
  });
  router.get('/details', async (req,res,next) => {
    try {
      const visit = parseCookieValue(req.headers.cookie,VISIT_COOKIE);
      if (!await service.active(req.checkinDeviceToken,visit)) return res.redirect(303,'/check-in/');
      return res.type('html').send(ux.details({csrfToken:formToken(req.checkinDeviceToken)}));
    } catch (error) { next(error); }
  });
  router.use((req,res,next) => {
    if (originMatches(req)) return next();
    // Safari may omit Origin and Fetch Metadata for native form navigation.
    // Accept that case only with a token rendered on this verified iPad.
    const origin=req.get('origin'),site=req.get('sec-fetch-site');
    if ((!origin || origin==='null') && site!=='cross-site' && hasFormToken(req)) return next();
    return res.sendStatus(403);
  });
  router.post('/start', async (req,res,next) => {
    try {
      const prior = parseCookieValue(req.headers.cookie,VISIT_COOKIE);
      if (prior) await service.finish(req.checkinDeviceToken,prior);
      const visit = await service.begin(req.checkinDeviceToken);
      res.append('Set-Cookie',cookie(VISIT_COOKIE,visit.token,{ env,seconds:12*60 }));
      return res.redirect(303,'/check-in/details');
    } catch (error) { next(error); }
  });
  router.post('/start-form', async (req,res,next) => {
    try {
      const form = await service.beginForm(req.checkinDeviceToken,req.body);
      res.append('Set-Cookie',cookie(FORM_COOKIE,form.visitToken,{ env,seconds:40*60 }));
      return res.redirect(303,`/forms/f/${form.formToken}`);
    } catch (error) {
      if (error instanceof CheckinError && error.httpStatus===422) {
        try { return res.status(422).type('html').send(ux.verify({...await service.formDetails(req.checkinDeviceToken),error:error.message,csrfToken:formToken(req.checkinDeviceToken)})); }
        catch (changed) { return next(changed); }
      }
      next(error);
    }
  });
  router.post('/details', async (req,res,next) => {
    try {
      const result = await service.register({ deviceToken:req.checkinDeviceToken,
        sessionToken:parseCookieValue(req.headers.cookie,VISIT_COOKIE),
        name:req.body.name,mobile:req.body.mobile,dateOfBirth:req.body.dateOfBirth });
      res.append('Set-Cookie',cookie(VISIT_COOKIE,'',{ env,seconds:0 }));
      return res.type('html').send(ux.done({ needsStaff:result.state==='needs_staff' }));
    } catch (error) {
      if (error instanceof CheckinError && error.httpStatus === 422) {
        return res.status(422).type('html').send(ux.details({ error:error.message, values:req.body,csrfToken:formToken(req.checkinDeviceToken) }));
      }
      if (error instanceof CheckinError && error.httpStatus === 410) return res.redirect(303,'/check-in/');
      next(error);
    }
  });
  router.post('/finish', async (req,res,next) => {
    try {
      await service.finish(req.checkinDeviceToken,parseCookieValue(req.headers.cookie,VISIT_COOKIE));
      await service.cancelDeviceForm(req.checkinDeviceToken,{includeQueued:true});
      res.append('Set-Cookie',cookie(VISIT_COOKIE,'',{ env,seconds:0 }));
      res.append('Set-Cookie',cookie(FORM_COOKIE,'',{ env,seconds:0 }));
      return res.redirect(303,'/check-in/');
    } catch (error) { next(error); }
  });
  router.use((error,_req,res,next) => {
    if (!(error instanceof CheckinError)) return next(error);
    return res.status(error.httpStatus).type('html').send(ux.shell(`<h1>Reception can help.</h1><p>${error.message}</p><a class="button" href="/check-in/">Back to welcome</a>`));
  });
  return router;
}

function createClinicIpadSetupRouter({ env = process.env, sessionService, service = createClinicIpadCheckinService() } = {}) {
  if (!sessionService) throw new Error('Staff browser session service required');
  const router = express.Router();
  const staff = requireStaffSession({ service:sessionService, env });
  const staffPhone = requireStaffSession({ service:sessionService, env,humanNavigationSigninPath:'/calendar/staff' });
  router.use((_req,res,next) => { headers(res); next(); });
  router.use((_req,res,next) => String(env.SHILOH_CLINIC_IPAD_CHECKIN_ENABLED).toLowerCase() === 'true' ? next() : res.sendStatus(404));
  router.get('/setup.js',staff,(_req,res) => res.type('application/javascript').send(`(function(){const button=document.querySelector('[data-activate]'),status=document.querySelector('[data-status]');button.addEventListener('click',async()=>{button.disabled=true;try{const c=await fetch('/calendar/staff-auth/csrf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!c.ok)throw Error('Please sign in again.');const csrf=await c.json();const r=await fetch('/calendar/check-in/activate',{method:'POST',headers:{'Content-Type':'application/json','X-Shiloh-Csrf-Token':csrf.csrfToken},body:'{}'});if(!r.ok)throw Error('Activation failed. Please ask reception for help.');location.replace('/check-in/');}catch(e){status.textContent=e.message;button.disabled=false;}})})();`));
  router.get('/setup',staff,async (req,res,next) => {
    try {
      const authority = await service.canActivate(req.staffBrowserSession.adminId);
      if (!authority) return res.sendStatus(403);
      return res.type('html').send(ux.setup());
    } catch (error) { next(error); }
  });
  router.get('/approve-pair.js',staff,(_req,res)=>res.type('application/javascript').send(`(function(){const button=document.querySelector('[data-approve-pair]'),status=document.querySelector('[data-status]');button.addEventListener('click',async()=>{button.disabled=true;try{const c=await fetch('/calendar/staff-auth/csrf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!c.ok)throw Error('Please sign in to Workspace on this phone and scan the QR again.');const csrf=await c.json();const r=await fetch('/calendar/check-in/approve-pair',{method:'POST',headers:{'Content-Type':'application/json','X-Shiloh-Csrf-Token':csrf.csrfToken},body:JSON.stringify({pairId:button.dataset.approvePair})});if(!r.ok)throw Error('This QR code expired or could not be approved. Show a new QR on the iPad.');status.textContent='Approved. The iPad will open check-in automatically.';}catch(e){status.textContent=e.message;button.disabled=false;}})})();`));
  router.get('/approve-pair',staffPhone,async(req,res,next)=>{
    try {
      const pairing=await service.pairDetails(req.staffBrowserSession.adminId,req.query.pair);
      if (!pairing) return res.status(410).type('html').send(ux.shell('<h1>QR code expired.</h1><p>Show a new QR code on the iPad and scan it again.</p>'));
      return res.type('html').send(ux.approvePair(req.query.pair,Boolean(pairing.device_id)));
    }catch(error){next(error);}
  });
  router.post('/approve-pair',sameOriginGuard({env}),staff,csrfGuard({service:sessionService}),async(req,res,next)=>{
    try {return res.status(200).json(await service.approvePair(req.staffBrowserSession.adminId,req.body?.pairId));}
    catch(error){next(error);}
  });
  router.get('/devices.js',staff,(_req,res) => res.type('application/javascript').send(`(function(){
const status=document.querySelector('[data-status]'),options=document.querySelector('[data-form-options]');
async function send(path,payload){const c=await fetch('/calendar/staff-auth/csrf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!c.ok)throw Error('Please sign in again.');const csrf=await c.json();const r=await fetch('/calendar/check-in/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Shiloh-Csrf-Token':csrf.csrfToken},body:JSON.stringify(payload)});if(!r.ok)throw Error('The action could not be completed. Please check the appointment and iPad.');return r.json();}
document.querySelector('[data-setup-code]')?.addEventListener('click',async event=>{const button=event.currentTarget,code=document.querySelector('[data-setup-code-result]'),message=document.querySelector('[data-code-status]');button.disabled=true;code.hidden=true;message.textContent='Creating a code…';try{const result=await send('setup-code',{});code.textContent=result.code.slice(0,5)+' '+result.code.slice(5);code.hidden=false;message.textContent='Enter this code on the iPad within five minutes. It works once.';}catch(error){message.textContent='Could not create a code. Please try again.';}finally{button.disabled=false;}});
document.querySelectorAll('[data-revoke]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await send('revoke',{deviceId:button.dataset.revoke});location.reload();}catch(e){status.textContent=e.message;button.disabled=false;}}));
document.querySelector('[data-find-forms]').addEventListener('submit',async event=>{
event.preventDefault();options.replaceChildren();status.textContent='Finding the appointment forms…';
const appointmentId=new FormData(event.target).get('appointmentId');
try{const r=await fetch('/calendar/check-in/assignments/'+encodeURIComponent(appointmentId));
if(!r.ok)throw Error('Forms are unavailable for this appointment.');const data=await r.json();
if(!data.assignments.length){status.textContent='No unfinished forms are assigned to this appointment.';return;}
status.textContent='Confirm the client, appointment and form before preparing it on the iPad.';
for(const item of data.assignments){
const row=document.createElement('div'),label=document.createElement('label'),select=document.createElement('select'),button=document.createElement('button');
label.textContent=item.client_name+' · mobile ending '+item.mobile_last4+' · '+new Date(item.starts_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})+' · '+item.title+' · iPad ';
for(const device of document.querySelectorAll('[data-revoke]')){const option=document.createElement('option');option.value=device.dataset.revoke;option.textContent='iPad '+device.dataset.revoke;select.append(option);}
button.type='button';button.className='button secondary';button.textContent='Prepare on iPad';
if(item.handoff_id){const cancel=document.createElement('button');cancel.type='button';cancel.className='button secondary';cancel.textContent='Cancel prepared form on iPad '+item.handoff_device_id;cancel.addEventListener('click',async()=>{cancel.disabled=true;try{await send('cancel-handover',{deviceId:item.handoff_device_id,handoffId:item.handoff_id});document.querySelector('[data-find-forms]').requestSubmit();}catch(e){status.textContent=e.message;cancel.disabled=false;}});label.append(select);select.value=String(item.handoff_device_id);select.disabled=true;row.append(label,cancel);options.append(row);continue;}
button.addEventListener('click',async()=>{button.disabled=true;select.disabled=true;try{const deviceId=select.value;
const prepared=await send('queue-form',{appointmentId,assignmentId:item.id,deviceId});
const confirmation=document.createElement('button');confirmation.type='button';confirmation.className='button';
confirmation.textContent='I confirm this person and iPad '+deviceId+' — Hand over';
const guidance=document.createElement('p');guidance.textContent='Check the actual person matches '+item.client_name+' and you are handing over iPad '+deviceId+'. No details are shown until you confirm.';
const cancel=document.createElement('button');cancel.type='button';cancel.className='button secondary';cancel.textContent='Cancel prepared form';cancel.addEventListener('click',async()=>{cancel.disabled=true;try{await send('cancel-handover',{deviceId,handoffId:prepared.handoffId});document.querySelector('[data-find-forms]').requestSubmit();}catch(e){status.textContent=e.message;cancel.disabled=false;}});
row.append(guidance,confirmation,cancel);status.textContent='Prepared. Confirm the person and physical iPad at handover.';
confirmation.addEventListener('click',async()=>{confirmation.disabled=true;try{await send('handover',{deviceId,handoffId:prepared.handoffId,confirmed:true});status.textContent='Handover confirmed. On the iPad tap Complete my form to check the details.';}catch(e){status.textContent=e.message;confirmation.disabled=false;}});
}catch(e){status.textContent=e.message;button.disabled=false;select.disabled=false;}});
label.append(select);row.append(label);
if(['not_sent','sent','opened'].includes(item.status))row.append(button);
options.append(row);
}}catch(e){status.textContent=e.message;}});
})();`));
  router.get('/devices',staff,async (req,res,next) => {
    try { return res.type('html').send(ux.devices(await service.listDevices(req.staffBrowserSession.adminId), req.query.appointmentId)); }
    catch (error) { next(error); }
  });
  router.get('/assignments/:appointmentId',staff,async (req,res,next) => {
    try {
      const assignments = await service.listFormAssignments(req.staffBrowserSession.adminId,req.params.appointmentId);
      return res.json({ assignments });
    } catch (error) { next(error); }
  });
  router.post('/queue-form',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),async (req,res,next) => {
    try {
      const queued = await service.queueForm(req.staffBrowserSession.adminId,
        req.body?.deviceId,req.body?.appointmentId,req.body?.assignmentId);
      return res.status(200).json(queued);
    } catch (error) { next(error); }
  });
  router.post('/cancel-handover',sameOriginGuard({env}),staff,csrfGuard({service:sessionService}),async(req,res,next)=>{
    try{return res.json(await service.cancelHandover(req.staffBrowserSession.adminId,req.body?.deviceId,req.body?.handoffId));}catch(error){next(error);}
  });
  router.post('/handover',sameOriginGuard({env}),staff,csrfGuard({service:sessionService}),async(req,res,next)=>{
    try {return res.json(await service.confirmHandover(req.staffBrowserSession.adminId,req.body?.deviceId,req.body?.handoffId,req.body?.confirmed));}
    catch(error) {next(error);}
  });
  // Retired delivery links fail closed, including when old clients post directly.
  router.post('/send-form',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),(_req,res) =>
    res.status(410).json({ error:'WhatsApp form delivery has been retired. Prepare the form on an iPad or use My Shiloh.' }));
  router.post('/revoke',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),async (req,res,next) => {
    try {
      const revoked = await service.revoke(req.staffBrowserSession.adminId,req.body?.deviceId);
      return res.status(revoked ? 200 : 404).json({ revoked });
    } catch (error) { next(error); }
  });
  router.post('/setup-code',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),async (req,res,next) => {
    try { return res.status(200).json(await service.createSetupCode(req.staffBrowserSession.adminId)); }
    catch(error) { next(error); }
  });
  router.post('/activate',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),async (req,res,next) => {
    try {
      const activated = await service.activate(req.staffBrowserSession.adminId);
      await sessionService.revokeSession(req.staffBrowserSession.sessionId,'clinic_ipad_activated');
      res.setHeader('Set-Cookie',[
        cookie(DEVICE_COOKIE,activated.token,{ env,seconds:DEVICE_IDLE_SECONDS }),
        serializeExpiredSessionCookie({ env }),
        serializeExpiredClientSessionCookie({ env }),
        serializeExpiredClientAuthCookie({ env }),
      ]);
      return res.status(200).json({ ok:true,deviceId:activated.deviceId });
    } catch (error) { next(error); }
  });
  router.use((error,_req,res,next) => error instanceof CheckinError
    ? res.status(error.httpStatus).json({ error:error.message }) : next(error));
  return router;
}
module.exports = { createClinicIpadPublicRouter,createClinicIpadSetupRouter,cookie,originMatches };
