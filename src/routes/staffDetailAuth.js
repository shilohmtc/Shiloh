'use strict';
const express = require('express');
const { pool } = require('../db/pool');
const { createStaffDetailAuthService } = require('../services/staffDetailAuth');
const { createStaffDetailSetupService } = require('../services/staffDetailSetup');
const { createStaffBrowserSessionService } = require('../services/staffBrowserSession');
const { staffDetailAuthEnabled } = require('../services/staffDetailIdentity');
const {
  sameOriginGuard,
  requireStaffSession,
  csrfGuard,
  parseCookieValue,
  requestFingerprintHash,
  serializeSessionCookie,
} = require('../middleware/staffBrowserSession');
const { setAccessSecurityHeaders } = require('./staffCalendarAccessUx');
const ux = require('../presentation/staffDetailSigninUx');
const { styles } = require('../presentation/staffCalendarAccessUx');
function createStaffDetailAuthRouter({
  env = process.env,
  auth = createStaffDetailAuthService({ env }),
  setup = createStaffDetailSetupService(),
  sessions = createStaffBrowserSessionService({ db: pool }),
} = {}) {
  const router = express.Router(),
    sameOrigin = sameOriginGuard({ env }),
    session = requireStaffSession({ service: sessions, env }),
    csrf = csrfGuard({ service: sessions });
  router.use((_req, res, next) => {
    setAccessSecurityHeaders(res);
    if (['/sign-in', '/signin.js'].includes(_req.path) && !staffDetailAuthEnabled(env))
      return res.status(404).send('Not Found');
    next();
  });
  router.get('/signin.js', (_req, res) =>
    res.type('application/javascript').send(ux.signinScript()),
  );
  router.get('/setup.js', session, (_req, res) =>
    res.type('application/javascript').send(ux.setupScript()),
  );
  router.post('/sign-in', sameOrigin, async (req, res) => {
    const name =
      env.NODE_ENV === 'production'
        ? '__Host-shiloh_staff_detail_device'
        : 'shiloh_staff_detail_device';
    const result = await auth.attempt({
      input: req.body,
      address: req.socket?.remoteAddress,
      deviceToken: parseCookieValue(req.headers.cookie, name),
      requestFingerprintHash: requestFingerprintHash(req),
    });
    const cookies = [];
    if (result.browserToken)
      cookies.push(
        `${name}=${result.browserToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${env.NODE_ENV === 'production' ? '; Secure' : ''}`,
      );
    if (result.ok)
      cookies.push(
        serializeSessionCookie(result.sessionToken, {
          env,
          maxAgeSeconds: Math.max(1, Math.floor((new Date(result.expiresAt) - Date.now()) / 1000)),
        }),
      );
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    if (result.ok) return res.json({ authenticated: true, viewer: result.viewer });
    const status =
      result.code === 'STAFF_DETAIL_AUTH_RATE_LIMITED'
        ? 429
        : result.code === 'STAFF_DETAIL_AUTH_UNAVAILABLE'
          ? 503
          : 401;
    return res
      .status(status)
      .json({ error: 'Could not sign in. Check your details or ask your Shiloh administrator.' });
  });
  router.get('/manage', session, async (req, res, next) => {
    try {
      const model = await setup.read({
        session: req.staffBrowserSession,
        targetId: req.query.target || req.staffBrowserSession.adminId,
      });
      if (!model.ok)
        return res
          .status(403)
          .send('Only Reception, Christel and JP can edit staff sign-in details.');
      return res.type('html').send(ux.setupPage(model, styles()));
    } catch (error) {
      next(error);
    }
  });
  router.post('/setup', sameOrigin, session, csrf, async (req, res) => {
    const result = await setup.save({
      targetId: req.body?.targetId,
      input: req.body?.input,
      expectedRevision: req.body?.expectedRevision,
      session: req.staffBrowserSession,
    });
    if (result.ok) return res.json({ saved: true });
    const code = result.code;
    return res
      .status(
        code === 'STAFF_DETAIL_SETUP_STALE'
          ? 409
          : code === 'STAFF_DETAIL_SETUP_INVALID'
            ? 400
            : code === 'STAFF_DETAIL_SETUP_UNAVAILABLE'
              ? 503
              : 403,
      )
      .json({
        error:
          code === 'STAFF_DETAIL_SETUP_FORBIDDEN'
            ? 'Only Reception, Christel and JP can edit staff sign-in details. Sign in again if your session has expired.'
            : code === 'STAFF_DETAIL_SETUP_STALE'
              ? 'These details changed. Reload before saving.'
              : code === 'STAFF_DETAIL_SETUP_INVALID'
                ? 'Check the name, surname, date of birth and recorded mobile.'
                : 'Could not save sign-in details.',
      });
  });
  return router;
}
module.exports = { createStaffDetailAuthRouter };
