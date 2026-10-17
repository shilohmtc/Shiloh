'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { sameOriginGuard, requireStaffSession, csrfGuard, parseCookieValue, serializeSessionCookie } = require('../middleware/staffBrowserSession');
const { networkGroup } = require('../services/clientCrmDetailAuth');
const { defaultDeviceLabel } = require('../services/staffPasskeyAuth');
const { serializePasskeyHintCookie } = require('./staffPasskeyAuth');
const { workspaceWhatsAppPage, workspaceWhatsAppScript } = require('../presentation/workspaceWhatsAppUx');
const { authInvitationPage, authInvitationScript } = require('../presentation/authInvitations');

const BASE = '/calendar/staff-auth/whatsapp';
const validToken = value => /^[A-Za-z0-9_-]{43}$/.test(value || '');
function createWorkspaceWhatsAppRouter({ service, sessions, invitations, env = {}, enabled = false } = {}) {
  const router = express.Router();
  const production = env.NODE_ENV === 'production';
  const browserCookie = production ? '__Host-shiloh_workspace_otp_browser' : 'shiloh_workspace_otp_browser';
  router.use((req,res,next) => {
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    if (enabled !== true || !service?.enabled() || typeof sessions?.validateSessionToken !== 'function' || typeof sessions?.validateCsrfToken !== 'function') return res.sendStatus(404);
    next();
  });
  if (!sessions || !service) return router;
  router.use(express.json({ limit:'32kb', strict:true }));
  function browser(req,res,create = false) {
    let token = parseCookieValue(req.headers.cookie, browserCookie);
    if (!validToken(token) && create) {
      token = crypto.randomBytes(32).toString('base64url');
      res.append('Set-Cookie', `${browserCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${production ? '; Secure' : ''}`);
    }
    return validToken(token) ? token : null;
  }
  function page(req,res,admin = false) {
    browser(req,res,true);
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    return res.type('html').send(workspaceWhatsAppPage({ admin, smsFallback:service.fallbackEnabled?.() === true }));
  }
  const requireSession = requireStaffSession({ service:sessions, env });
  const csrf = csrfGuard({ service:sessions });
  router.get('/', (req,res) => page(req,res));
  router.get('/enroll', requireSession, (req,res) => page(req,res));
  router.get('/welcome', requireSession, (req,res) => {
    browser(req,res,true);
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.type('html').send(authInvitationPage({audience:'staff',base:BASE}));
  });
  router.get('/invitations.js',(_req,res)=>res.type('application/javascript').send(authInvitationScript({audience:'staff',base:BASE})));
  router.get('/approve', requireSession, (req,res) => page(req,res,true));
  router.get('/app.js', (_req,res) => res.type('application/javascript').send(workspaceWhatsAppScript()));
  router.use(sameOriginGuard({ env }));
  router.use(async (req,res,next) => {
    const browserToken = browser(req,res), network = networkGroup(req.ip || req.socket.remoteAddress);
    try {
      if (!browserToken || !await service.admitRequest({ browserToken, network })) return res.status(429).json({ error:'Please wait before trying again.' });
      req.workspaceOtpContext = { browserToken, network };
      next();
    } catch (_) { res.status(503).json({ error:'Sign-in is temporarily unavailable.' }); }
  });
  function action(fn, sessionResult = false) {
    return async (req,res) => {
      try {
        const result = await fn(req);
        if (!result?.ok) return res.status(result?.code === 'WORKSPACE_WHATSAPP_DISABLED' ? 503 : 401).json({ error:'This request could not be verified. Try again or ask your administrator.' });
        if (sessionResult && result.sessionToken) {
          res.append('Set-Cookie', serializeSessionCookie(result.sessionToken,{ env, maxAgeSeconds:Math.max(1,Math.floor((new Date(result.expiresAt)-Date.now())/1000)) }));
          if (result.credentialHint) res.append('Set-Cookie', serializePasskeyHintCookie(result.credentialHint,{ env }));
          return res.json({ authenticated:true, csrfToken:result.csrfToken, viewer:result.viewer });
        }
        res.json(result);
      } catch (_) { res.status(503).json({ error:'This request could not be completed. Please try again.' }); }
    };
  }
  router.post('/start', action(req => service.begin({ ...req.workspaceOtpContext, mobile:req.body.mobile,
    purpose:req.body.purpose, setupIntent:req.body.setupIntent })));
  router.post('/fallback/sms', action(req => service.requestSmsFallback({ ...req.workspaceOtpContext, request:req.body.request, purpose:req.body.purpose })));
  router.post('/verify', action(req => service.verify({ ...req.workspaceOtpContext, request:req.body.request,
    code:req.body.code, purpose:req.body.purpose }),true));
  router.post('/setup/request', action(req => service.requestSetup({ ...req.workspaceOtpContext,
    purpose:req.body.purpose, mobile:req.body.mobile })));
  router.post('/enrollment/own', requireSession, csrf, action(req => service.requestOwnEnrollment({
    ...req.workspaceOtpContext, sessionId:req.staffBrowserSession.sessionId, proof:req.body.proof })));
  router.post('/invitations/visit',requireSession,csrf,action(req=>invitations?.visit(req.staffBrowserSession)));
  router.post('/setup/review', requireSession, csrf, action(req => service.inspectSetup({ intent:req.body.intent, sessionId:req.staffBrowserSession.sessionId })));
  router.post('/setup/approve', requireSession, csrf, action(req => service.approveSetup({ intent:req.body.intent,
    identityConfirmed:req.body.identityConfirmed, sessionId:req.staffBrowserSession.sessionId })));
  router.post('/passkey/start', action(req => service.beginRegistration({ grant:req.body.grant, browserToken:req.workspaceOtpContext.browserToken })));
  router.post('/passkey/finish', action(req => service.finishRegistration({ grant:req.body.grant,
    browserToken:req.workspaceOtpContext.browserToken, response:req.body.response,
    deviceLabel:defaultDeviceLabel(req.headers['user-agent']) }),true));
  router.use((_error,_req,res,_next) => res.status(400).json({ error:'Request could not be read.' }));
  return router;
}
module.exports = { createWorkspaceWhatsAppRouter, BASE };
