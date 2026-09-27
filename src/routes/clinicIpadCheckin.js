'use strict';

const express = require('express');
const path = require('path');
const { createHmac, timingSafeEqual, randomBytes } = require('crypto');
const { createClinicIpadCheckinService, CheckinError, validToken } = require('../services/clinicIpadCheckin');
const { createConsultationFormDeliveryService } = require('../services/consultationFormDelivery');
const { requireStaffSession, sameOriginGuard, csrfGuard, parseCookieValue, expectedOrigin,
  serializeExpiredSessionCookie } = require('../middleware/staffBrowserSession');
const { serializeExpiredClientSessionCookie, serializeExpiredClientAuthCookie } = require('../middleware/clientBrowserSession');
const ux = require('../presentation/clinicIpadCheckinUx');

const DEVICE_COOKIE = 'shiloh_checkin_device';
const DEVICE_IDLE_SECONDS = 30*24*60*60;
const VISIT_COOKIE = 'shiloh_checkin_visit';
const FORM_COOKIE = 'shiloh_checkin_form';
const SETUP_COOKIE = 'shiloh_checkin_setup';
const setupAttempts = new Map();
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
      return res.type('html').send(ux.verify({csrfToken:formToken(req.checkinDeviceToken)}));
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
      if (!form.verified && !form.formToken) return res.status(422).type('html').send(ux.verify({error:'Those details did not match. Please check them or ask reception for help.',csrfToken:formToken(req.checkinDeviceToken)}));
      res.append('Set-Cookie',cookie(FORM_COOKIE,form.visitToken,{ env,seconds:40*60 }));
      return res.redirect(303,`/forms/f/${form.formToken}`);
    } catch (error) { next(error); }
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
      await service.cancelDeviceForm(req.checkinDeviceToken);
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

function createClinicIpadSetupRouter({ env = process.env, sessionService, service = createClinicIpadCheckinService(),
  deliveryService = createConsultationFormDeliveryService({ env }) } = {}) {
  if (!sessionService) throw new Error('Staff browser session service required');
  const router = express.Router();
  const staff = requireStaffSession({ service:sessionService, env });
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
  router.get('/devices.js',staff,(_req,res) => res.type('application/javascript').send(`(function(){
const status=document.querySelector('[data-status]'),options=document.querySelector('[data-form-options]');
async function send(path,payload){const c=await fetch('/calendar/staff-auth/csrf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!c.ok)throw Error('Please sign in again.');const csrf=await c.json();const r=await fetch('/calendar/check-in/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Shiloh-Csrf-Token':csrf.csrfToken},body:JSON.stringify(payload)});if(!r.ok)throw Error('The action could not be completed. Please check the appointment and iPad.');return r.json();}
document.querySelector('[data-setup-code]').addEventListener('click',async event=>{const button=event.currentTarget,code=document.querySelector('[data-setup-code-result]'),message=document.querySelector('[data-code-status]');button.disabled=true;code.hidden=true;message.textContent='Creating a code…';try{const result=await send('setup-code',{});code.textContent=result.code.slice(0,5)+' '+result.code.slice(5);code.hidden=false;message.textContent='Enter this code on the iPad within five minutes. It works once.';}catch(error){message.textContent='Could not create a code. Please try again.';}finally{button.disabled=false;}});
document.querySelectorAll('[data-revoke]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await send('revoke',{deviceId:button.dataset.revoke});location.reload();}catch(e){status.textContent=e.message;button.disabled=false;}}));
document.querySelector('[data-find-forms]').addEventListener('submit',async event=>{
event.preventDefault();options.replaceChildren();status.textContent='Finding the appointment forms…';
const appointmentId=new FormData(event.target).get('appointmentId');
try{const r=await fetch('/calendar/check-in/assignments/'+encodeURIComponent(appointmentId));
if(!r.ok)throw Error('Forms are unavailable for this appointment.');const data=await r.json();
if(!data.assignments.length){status.textContent='No unfinished forms are assigned to this appointment.';return;}
status.textContent='Confirm the client, appointment and form before choosing how to deliver it.';
for(const item of data.assignments){
const row=document.createElement('div'),label=document.createElement('label'),select=document.createElement('select'),button=document.createElement('button');
label.textContent=item.client_name+' · mobile ending '+item.mobile_last4+' · '+new Date(item.starts_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})+' · '+item.title+' · iPad ';
for(const device of document.querySelectorAll('[data-revoke]')){const option=document.createElement('option');option.value=device.dataset.revoke;option.textContent='iPad '+device.dataset.revoke;select.append(option);}
button.type='button';button.className='button secondary';button.textContent='Prepare on iPad';
button.addEventListener('click',async()=>{button.disabled=true;try{await send('queue-form',{appointmentId,assignmentId:item.id,deviceId:select.value});status.textContent='The form is ready on the selected iPad.';}catch(e){status.textContent=e.message;button.disabled=false;}});
label.append(select);row.append(label);
if(item.status==='not_sent')row.append(button);
if(options.dataset.whatsappReady==='true' && item.status==='not_sent'){
const whatsapp=document.createElement('button');whatsapp.type='button';whatsapp.className='button secondary';whatsapp.textContent='Send to client’s WhatsApp';
whatsapp.addEventListener('click',async()=>{if(!window.confirm('Send '+item.title+' to '+item.client_name+' at mobile ending '+item.mobile_last4+'?'))return;
whatsapp.disabled=true;try{await send('send-form',{appointmentId,assignmentId:item.id});status.textContent='The form was sent to the client’s WhatsApp.';}
catch(e){status.textContent=e.message;whatsapp.disabled=false;}});row.append(whatsapp);}
options.append(row);
}}catch(e){status.textContent=e.message;}});
})();`));
  router.get('/devices',staff,async (req,res,next) => {
    try { const whatsappReady=String(env.SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED).toLowerCase()==='true'
        && String(env.SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED).toLowerCase()==='true'
        && Boolean(env.SHILOH_CONSULTATION_FORM_DELIVERY_NOT_BEFORE);
      return res.type('html').send(ux.devices(await service.listDevices(req.staffBrowserSession.adminId),{whatsappReady})); }
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
  router.post('/send-form',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),async (req,res,next) => {
    try {
      const assignments=await service.listFormAssignments(req.staffBrowserSession.adminId,req.body?.appointmentId);
      if (!assignments.some(row=>String(row.id)===String(req.body?.assignmentId))) {
        throw new CheckinError('This form is not available for that appointment.',409);
      }
      const result=await deliveryService.sendAssignmentNow(req.body.assignmentId,
        {actorAdminId:req.staffBrowserSession.adminId});
      return res.status(result.sent?200:409).json(result);
    } catch(error) { next(error); }
  });
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
