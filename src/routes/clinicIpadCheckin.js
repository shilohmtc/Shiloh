'use strict';

const express = require('express');
const { createClinicIpadCheckinService, CheckinError } = require('../services/clinicIpadCheckin');
const { requireStaffSession, sameOriginGuard, csrfGuard, parseCookieValue, expectedOrigin,
  serializeExpiredSessionCookie } = require('../middleware/staffBrowserSession');
const { serializeExpiredClientSessionCookie, serializeExpiredClientAuthCookie } = require('../middleware/clientBrowserSession');
const ux = require('../presentation/clinicIpadCheckinUx');

const DEVICE_COOKIE = 'shiloh_checkin_device';
const VISIT_COOKIE = 'shiloh_checkin_visit';
function cookie(name, value, { env = process.env, seconds = 0 } = {}) {
  const parts = [`${name}=${value}`, 'Path=/check-in', 'HttpOnly', 'SameSite=Strict', `Max-Age=${seconds}`];
  if (String(env.NODE_ENV).toLowerCase() === 'production') parts.push('Secure');
  return parts.join('; ');
}
function headers(res) {
  res.set('Cache-Control','private, no-store, max-age=0');
  res.set('Pragma','no-cache');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Robots-Tag','noindex, nofollow, noarchive');
  res.set('X-Frame-Options','DENY');
  res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function originMatches(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === expectedOrigin(req); }
  catch (_error) { return false; }
}
function createClinicIpadPublicRouter({ env = process.env, service = createClinicIpadCheckinService() } = {}) {
  const router = express.Router();
  router.use((_req,res,next) => { headers(res); next(); });
  router.use((_req,res,next) => String(env.SHILOH_CLINIC_IPAD_CHECKIN_ENABLED).toLowerCase() === 'true' ? next() : res.sendStatus(404));
  router.use(express.urlencoded({ extended:false,limit:'4kb',parameterLimit:8 }));
  router.use(async (req,res,next) => {
    try {
      req.checkinDeviceToken = parseCookieValue(req.headers.cookie, DEVICE_COOKIE);
      req.checkinDevice = await service.deviceFor(req.checkinDeviceToken);
      if (!req.checkinDevice) return res.status(401).type('html').send(ux.welcome({ setup:true }));
      next();
    } catch (error) { next(error); }
  });
  router.get('/', async (req,res,next) => {
    try {
      const prior = parseCookieValue(req.headers.cookie, VISIT_COOKIE);
      if (prior) await service.finish(req.checkinDeviceToken,prior);
      res.append('Set-Cookie',cookie(VISIT_COOKIE,'',{ env,seconds:0 }));
      return res.type('html').send(ux.welcome());
    } catch (error) { next(error); }
  });
  router.get('/details', async (req,res,next) => {
    try {
      const visit = parseCookieValue(req.headers.cookie,VISIT_COOKIE);
      if (!await service.active(req.checkinDeviceToken,visit)) return res.redirect(303,'/check-in/');
      return res.type('html').send(ux.details());
    } catch (error) { next(error); }
  });
  router.use((req,res,next) => originMatches(req) ? next() : res.sendStatus(403));
  router.post('/start', async (req,res,next) => {
    try {
      const prior = parseCookieValue(req.headers.cookie,VISIT_COOKIE);
      if (prior) await service.finish(req.checkinDeviceToken,prior);
      const visit = await service.begin(req.checkinDeviceToken);
      res.append('Set-Cookie',cookie(VISIT_COOKIE,visit.token,{ env,seconds:12*60 }));
      return res.redirect(303,'/check-in/details');
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
        return res.status(422).type('html').send(ux.details({ error:error.message, values:req.body }));
      }
      if (error instanceof CheckinError && error.httpStatus === 410) return res.redirect(303,'/check-in/');
      next(error);
    }
  });
  router.post('/finish', async (req,res,next) => {
    try {
      await service.finish(req.checkinDeviceToken,parseCookieValue(req.headers.cookie,VISIT_COOKIE));
      res.append('Set-Cookie',cookie(VISIT_COOKIE,'',{ env,seconds:0 }));
      return res.redirect(303,'/check-in/');
    } catch (error) { next(error); }
  });
  return router;
}

function createClinicIpadSetupRouter({ env = process.env, sessionService, service = createClinicIpadCheckinService() } = {}) {
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
  router.get('/devices.js',staff,(_req,res) => res.type('application/javascript').send(`(function(){document.querySelectorAll('[data-revoke]').forEach(button=>button.addEventListener('click',async()=>{const status=document.querySelector('[data-status]');button.disabled=true;try{const c=await fetch('/calendar/staff-auth/csrf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!c.ok)throw Error('Please sign in again.');const csrf=await c.json();const r=await fetch('/calendar/check-in/revoke',{method:'POST',headers:{'Content-Type':'application/json','X-Shiloh-Csrf-Token':csrf.csrfToken},body:JSON.stringify({deviceId:button.dataset.revoke})});if(!r.ok)throw Error('Could not disable this iPad.');location.reload();}catch(e){status.textContent=e.message;button.disabled=false;}}))})();`));
  router.get('/devices',staff,async (req,res,next) => {
    try { return res.type('html').send(ux.devices(await service.listDevices(req.staffBrowserSession.adminId))); }
    catch (error) { next(error); }
  });
  router.post('/revoke',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),async (req,res,next) => {
    try {
      const revoked = await service.revoke(req.staffBrowserSession.adminId,req.body?.deviceId);
      return res.status(revoked ? 200 : 404).json({ revoked });
    } catch (error) { next(error); }
  });
  router.post('/activate',sameOriginGuard({ env }),staff,csrfGuard({ service:sessionService }),async (req,res,next) => {
    try {
      const activated = await service.activate(req.staffBrowserSession.adminId);
      await sessionService.revokeSession(req.staffBrowserSession.sessionId,'clinic_ipad_activated');
      res.setHeader('Set-Cookie',[
        cookie(DEVICE_COOKIE,activated.token,{ env,seconds:30*24*60*60 }),
        serializeExpiredSessionCookie({ env }),
        serializeExpiredClientSessionCookie({ env }),
        serializeExpiredClientAuthCookie({ env }),
      ]);
      return res.status(200).json({ ok:true,deviceId:activated.deviceId });
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = { createClinicIpadPublicRouter,createClinicIpadSetupRouter,cookie,originMatches };
