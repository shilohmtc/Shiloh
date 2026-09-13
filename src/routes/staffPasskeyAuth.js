const express = require('express');
const { pool } = require('../db/pool');
const { createStaffBrowserSessionService } = require('../services/staffBrowserSession');
const { createStaffPasskeyAuthService, normalizeCredentialHint } = require('../services/staffPasskeyAuth');
const { managePage, manageScript } = require('../presentation/staffPasskeyUx');
const {
  sameOriginGuard,
  requestFingerprintHash,
  requireStaffSession,
  csrfGuard,
  serializeSessionCookie,
  parseCookieValue,
} = require('../middleware/staffBrowserSession');

const PASSKEY_HINT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
function passkeyHintCookieName(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
    ? '__Host-shiloh_staff_device_credential'
    : 'shiloh_staff_device_credential';
}
function serializePasskeyHintCookie(value, { env = process.env, maxAgeSeconds = PASSKEY_HINT_MAX_AGE_SECONDS } = {}) {
  const hint = normalizeCredentialHint(value);
  if (!hint) throw new Error('valid passkey credential hint is required');
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const parts = [
    `${passkeyHintCookieName(env)}=${hint}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`,
  ];
  if (production) parts.push('Secure');
  return parts.join('; ');
}
function serializeExpiredPasskeyHintCookie({ env = process.env } = {}) {
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const parts = [
    `${passkeyHintCookieName(env)}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (production) parts.push('Secure');
  return parts.join('; ');
}
function passkeyHintFromRequest(req, env = process.env) {
  return normalizeCredentialHint(parseCookieValue(req.headers?.cookie, passkeyHintCookieName(env)));
}

function createStaffPasskeyAuthRouter({
  env = process.env,
  sessionService = createStaffBrowserSessionService({ db: pool }),
  passkeyService = createStaffPasskeyAuthService({ db: pool, env }),
} = {}) {
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });
  const requireSession = requireStaffSession({ service: sessionService, env, allowRecoveryRequired: true });
  const requireCsrf = csrfGuard({ service: sessionService });
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
  function error(res, result, fallback = 'Passkey request could not be verified') {
    noStore(res);
    if (result.code === 'STAFF_PASSKEY_DISABLED') return res.status(404).json({ error: 'Not Found', requestId: res.req?.id });
    if (result.code === 'STAFF_PASSKEY_UNAVAILABLE') return res.status(503).json({ error: 'Passkey authentication is temporarily unavailable', requestId: res.req?.id });
    if (result.code === 'STAFF_RECENT_STRONG_AUTH_REQUIRED') return res.status(428).json({ error: 'Recent strong authentication required', requestId: res.req?.id });
    if (result.code === 'STAFF_PASSKEY_KNOWN_PRINCIPAL_REQUIRED') return res.status(428).json({ error: 'Device sign-in setup required', requestId: res.req?.id });
    if (result.code === 'STAFF_AUTH_FORBIDDEN') return res.status(403).json({ error: 'Forbidden', requestId: res.req?.id });
    if (result.code === 'STAFF_PASSKEY_NOT_FOUND') return res.status(404).json({ error: 'Not Found', requestId: res.req?.id });
    return res.status(401).json({ error: fallback, requestId: res.req?.id });
  }
  function sendSession(res, result) {
    noStore(res);
    const cookies = [serializeSessionCookie(result.sessionToken, {
      env, maxAgeSeconds: Math.max(1, Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000)),
    })];
    if (result.credentialHint) cookies.push(serializePasskeyHintCookie(result.credentialHint, { env }));
    res.setHeader('Set-Cookie', cookies);
    return res.status(200).json({ authenticated: true, csrfToken: result.csrfToken, viewer: result.viewer || null, recoveryRequired: false });
  }

  router.get('/known-principal', async (req, res, next) => {
    try {
      const result = await passkeyService.knownPrincipal({ credentialIdHint: passkeyHintFromRequest(req, env) });
      noStore(res);
      if (!result.ok && result.code === 'STAFF_PASSKEY_KNOWN_PRINCIPAL_REQUIRED') return res.status(200).json({ known: false });
      if (!result.ok) return error(res, result);
      return res.status(200).json({ known: true, displayName: result.displayName });
    } catch (e) { return next(e); }
  });
  router.post('/authentication/options', sameOrigin, async (req, res, next) => {
    try {
      const result = await passkeyService.beginAuthentication({
        credentialIdHint: passkeyHintFromRequest(req, env),
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return error(res, result);
      noStore(res);
      return res.status(200).json({ options: result.options, expiresAt: result.expiresAt, displayName: result.displayName });
    } catch (e) { return next(e); }
  });
  router.post('/authentication/finish', sameOrigin, async (req, res, next) => {
    try {
      const result = await passkeyService.finishAuthentication({
        response: req.body?.response,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return error(res, result);
      return sendSession(res, result);
    } catch (e) { return next(e); }
  });
  router.get('/manage', requireSession, async (req, res, next) => {
    try {
      const result = await passkeyService.listCredentials({ session: req.staffBrowserSession });
      if (!result.ok) return error(res, result);
      secure(res);
      return res.status(200).type('html').send(managePage({ credentials: result.credentials }));
    } catch (e) { return next(e); }
  });
  router.get('/manage.js', requireSession, async (req, res, next) => {
    try {
      const result = await passkeyService.listCredentials({ session: req.staffBrowserSession });
      if (!result.ok) return error(res, result);
      secure(res);
      return res.status(200).type('application/javascript').send(manageScript());
    } catch (e) { return next(e); }
  });
  router.get('/', requireSession, async (req, res, next) => {
    try {
      const result = await passkeyService.listCredentials({ session: req.staffBrowserSession });
      if (!result.ok) return error(res, result);
      noStore(res);
      return res.status(200).json({ credentials: result.credentials });
    } catch (e) { return next(e); }
  });
  router.post('/registration/options', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await passkeyService.beginRegistration({
        session: req.staffBrowserSession,
        mode: req.body?.mode,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return error(res, result);
      noStore(res);
      return res.status(200).json({ options: result.options, expiresAt: result.expiresAt, mode: result.mode });
    } catch (e) { return next(e); }
  });
  router.post('/registration/finish', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await passkeyService.finishRegistration({
        session: req.staffBrowserSession,
        response: req.body?.response,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return error(res, result);
      noStore(res);
      res.setHeader('Set-Cookie', serializePasskeyHintCookie(result.credentialHint, { env }));
      return res.status(201).json({ ok: true, credentialId: result.credentialId, mode: result.mode, revokedCredentialCount: result.revokedCredentialCount || 0, revokedSessionCount: result.revokedSessionCount || 0 });
    } catch (e) { return next(e); }
  });
  router.post('/:credentialId/revoke', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const hintBefore = passkeyHintFromRequest(req, env);
      const result = await passkeyService.revokeCredential({
        session: req.staffBrowserSession,
        credentialId: req.params.credentialId,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return error(res, result);
      noStore(res);
      if (hintBefore && hintBefore === normalizeCredentialHint(result.credentialHint)) {
        res.setHeader('Set-Cookie', serializeExpiredPasskeyHintCookie({ env }));
      }
      return res.status(204).send();
    } catch (e) { return next(e); }
  });
  return router;
}
module.exports = {
  createStaffPasskeyAuthRouter,
  PASSKEY_HINT_MAX_AGE_SECONDS,
  passkeyHintCookieName,
  serializePasskeyHintCookie,
  serializeExpiredPasskeyHintCookie,
  passkeyHintFromRequest,
};
