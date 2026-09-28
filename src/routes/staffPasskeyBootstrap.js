'use strict';

const express = require('express');
const { pool } = require('../db/pool');
const staffWhatsAppPasskeyBootstrap = require('../services/staffWhatsAppPasskeyBootstrap');
const { bootstrapPage, bootstrapScript } = require('../presentation/staffPasskeyBootstrapUx');
const {
  sameOriginGuard,
  requestFingerprintHash,
  serializeSessionCookie,
} = require('../middleware/staffBrowserSession');
const { serializePasskeyHintCookie } = require('./staffPasskeyAuth');
const { defaultDeviceLabel } = require('../services/staffPasskeyAuth');
const { createStaffSmsDeviceSetupService } = require('../services/staffSmsDeviceSetup');

function createStaffPasskeyBootstrapRouter({
  env = process.env,
  bootstrapService = staffWhatsAppPasskeyBootstrap,
  smsSetupService = createStaffSmsDeviceSetupService({ env }),
} = {}) {
  if (!bootstrapService || typeof bootstrapService.startRegistration !== 'function') throw new Error('staff passkey bootstrap service is required');
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });

  function noStore(res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  function secure(res) {
    noStore(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  }
  function sendError(res, result) {
    noStore(res);
    if (result?.code === 'STAFF_PASSKEY_BOOTSTRAP_DISABLED') return res.status(404).json({ error: 'Not Found', requestId: res.req?.id });
    if (result?.code === 'STAFF_PASSKEY_BOOTSTRAP_UNAVAILABLE') return res.status(503).json({ error: 'Secure setup is temporarily unavailable', requestId: res.req?.id });
    return res.status(401).json({ error: 'This setup link is invalid, expired, already used, or no longer authorized', requestId: res.req?.id });
  }

  router.get('/bootstrap', (req, res) => {
    const policy = bootstrapService.policy();
    if (!policy.enabled) return res.sendStatus(404);
    if (!policy.operational) return res.sendStatus(503);
    secure(res);
    return res.status(200).type('html').send(bootstrapPage());
  });

  router.get('/bootstrap.js', (req, res) => {
    const policy = bootstrapService.policy();
    if (!policy.enabled) return res.sendStatus(404);
    if (!policy.operational) return res.sendStatus(503);
    secure(res);
    return res.status(200).type('application/javascript').send(bootstrapScript());
  });

  router.get('/sms-setup', (req, res) => {
    if (!smsSetupService.enabled()) return res.sendStatus(404);
    secure(res);
    return res.status(200).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up Shiloh Workspace</title><style>body{margin:0;background:#f7f5ef;color:#20322b;font:18px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{max-width:460px;width:100%;background:#fffdf9;border:1px solid #dfe5df;border-radius:20px;padding:24px;box-sizing:border-box}h1{font-size:1.5rem}label{display:block;margin:20px 0 8px;font-weight:700}input,button{box-sizing:border-box;width:100%;min-height:48px;padding:10px;font:inherit;border-radius:12px}input{border:1px solid #76887c}button{margin-top:16px;background:#294c3c;color:#fff;border:0;font-weight:700}p{line-height:1.5}#status{color:#8a3f3f}</style><script src="/calendar/staff-auth/passkeys/sms-setup.js" defer></script></head><body><main><h1>Set up Shiloh Workspace</h1><p>Enter the 6-digit SMS code sent to your staff mobile. Your administrator must approve this setup first.</p><form id="setup"><label for="code">SMS code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button type="submit">Verify and set up this device</button></form><p id="status" role="status" aria-live="polite"></p></main></body></html>`);
  });
  router.get('/sms-setup.js', (req, res) => {
    if (!smsSetupService.enabled()) return res.sendStatus(404);
    secure(res);
    return res.status(200).type('application/javascript').send(`(function(){'use strict';var form=document.getElementById('setup'),status=document.getElementById('status'),button=form.querySelector('button');var request=new URLSearchParams(location.hash.slice(1)).get('request')||'';history.replaceState(null,'',location.pathname);form.addEventListener('submit',async function(e){e.preventDefault();if(!/^[A-Za-z0-9_-]{43}$/.test(request)){status.textContent='This setup link has expired. Ask your administrator for a new one.';return;}button.disabled=true;status.textContent='Verifying your code…';try{var r=await fetch('/calendar/staff-auth/passkeys/sms-setup/verify',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({request:request,code:form.elements.namedItem('code').value})});var b=await r.json().catch(function(){return{};});if(!r.ok||!b.url)throw Error('invalid');request='';location.replace(b.url);}catch(_){status.textContent='This code could not be verified. Check it or ask your administrator for a fresh setup.';button.disabled=false;}});})();`);
  });
  router.post('/sms-setup/verify', sameOrigin, async (req, res, next) => {
    try {
      const result = await smsSetupService.verify({ request: req.body?.request, code: req.body?.code,
        requestFingerprintHash: requestFingerprintHash(req) });
      noStore(res);
      if (!result.ok) return res.status(result.code === 'STAFF_SMS_SETUP_UNAVAILABLE' ? 503 : 401)
        .json({ error: 'Code invalid or expired', requestId: req.id });
      return res.status(200).json({ url: result.url });
    } catch (error) { return next(error); }
  });

  router.post('/bootstrap/start', sameOrigin, async (req, res, next) => {
    try {
      const result = await bootstrapService.startRegistration({
        token: req.body?.token,
        mode: req.body?.mode,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return sendError(res, result);
      noStore(res);
      return res.status(200).json({ options: result.options, expiresAt: result.expiresAt, displayName: result.displayName, mode: result.mode });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/bootstrap/finish', sameOrigin, async (req, res, next) => {
    try {
      const result = await bootstrapService.finishRegistration({
        response: req.body?.response,
        deviceLabel: defaultDeviceLabel(req.headers?.['user-agent']),
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return sendError(res, result);
      noStore(res);
      const cookies = [
        serializeSessionCookie(result.sessionToken, {
          env,
          maxAgeSeconds: Math.max(1, Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000)),
        }),
        serializePasskeyHintCookie(result.credentialHint, { env }),
      ];
      res.setHeader('Set-Cookie', cookies);
      return res.status(201).json({
        authenticated: true,
        csrfToken: result.csrfToken,
        viewer: result.viewer || null,
        recoveryRequired: false,
        mode: result.mode,
        revokedCredentialCount: result.revokedCredentialCount || 0,
        revokedSessionCount: result.revokedSessionCount || 0,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createStaffPasskeyBootstrapRouter };
