const express = require('express');
const { pool } = require('../db/pool');
const { createStaffBrowserSessionService } = require('../services/staffBrowserSession');
const { createStaffCalendarHandoffService } = require('../services/staffCalendarHandoff');
const {
  sameOriginGuard,
  requestFingerprintHash,
  requireStaffSession,
  csrfGuard,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
} = require('../middleware/staffBrowserSession');

function createStaffBrowserSessionRouter({
  env = process.env,
  service = createStaffBrowserSessionService({ db: pool, challengeDispatcher: null }),
  calendarHandoffService = createStaffCalendarHandoffService({ db: pool }),
} = {}) {
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });
  const requireSession = requireStaffSession({ service, env });
  const requireCsrf = csrfGuard({ service });

  function setNoStore(res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }

  function sendAuthenticatedSession(res, result) {
    setNoStore(res);
    res.setHeader('Set-Cookie', serializeSessionCookie(result.sessionToken, {
      env,
      maxAgeSeconds: Math.max(1, Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000)),
    }));
    return res.status(200).json({
      authenticated: true,
      csrfToken: result.csrfToken,
      viewer: result.viewer || null,
      recoveryRequired: false,
    });
  }

  router.post('/calendar-handoff/exchange', sameOrigin, async (req, res, next) => {
    try {
      const result = await calendarHandoffService.exchange({
        token: req.body?.token,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        setNoStore(res);
        return res.status(401).json({ error: 'Invalid or expired secure Calendar handoff', requestId: req.id });
      }
      return sendAuthenticatedSession(res, result);
    } catch (error) { return next(error); }
  });

  router.get('/session', requireSession, (req, res) => {
    setNoStore(res);
    return res.status(200).json({
      authenticated: true,
      viewer: req.staffBrowserSession.viewer || null,
      recoveryRequired: false,
    });
  });

  router.post('/csrf', sameOrigin, requireSession, async (req, res, next) => {
    try {
      const rotated = await service.rotateCsrfToken(req.staffBrowserSession.sessionId);
      if (!rotated.ok) return res.status(401).json({ error: 'Unauthorized', requestId: req.id });
      setNoStore(res);
      return res.status(200).json({ csrfToken: rotated.csrfToken });
    } catch (error) { return next(error); }
  });

  router.post('/logout', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      await service.revokeSession(req.staffBrowserSession.sessionId, 'logout');
      setNoStore(res);
      res.setHeader('Set-Cookie', serializeExpiredSessionCookie({ env }));
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createStaffBrowserSessionRouter };
