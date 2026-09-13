const express = require('express');
const { pool } = require('../db/pool');
const { createStaffBrowserSessionService } = require('../services/staffBrowserSession');
const { createStaffCalendarHandoffService } = require('../services/staffCalendarHandoff');
const { createProviderIndependentStaffAuthService } = require('../services/providerIndependentStaffAuth');
const {
  renderProviderIndependentStaffAuthPage,
  providerIndependentStaffAuthClientScript,
} = require('../presentation/providerIndependentStaffAuthUx');
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
  providerIndependentAuthService = createProviderIndependentStaffAuthService({ db: pool, env }),
} = {}) {
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });
  const requireSession = requireStaffSession({ service, env, allowRecoveryRequired: true });
  const requireCsrf = csrfGuard({ service });

  function setNoStore(res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }

  function setManagementSecurityHeaders(res) {
    setNoStore(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  }

  function providerAuthError(res, result, invalidMessage = 'Invalid or inactive staff authentication') {
    setNoStore(res);
    if (result.code === 'STAFF_TOTP_DISABLED') return res.status(404).json({ error: 'Not Found', requestId: res.req?.id });
    if (result.code === 'STAFF_AUTH_RATE_LIMITED') return res.status(429).json({ error: 'Too many authentication attempts', requestId: res.req?.id });
    if (result.code === 'STAFF_RECENT_AUTH_REQUIRED') return res.status(428).json({ error: 'Recent authentication required', requestId: res.req?.id });
    if (result.code === 'STAFF_AUTH_FORBIDDEN' || result.code === 'STAFF_RESET_FORBIDDEN') return res.status(403).json({ error: 'Forbidden', requestId: res.req?.id });
    if (result.code === 'STAFF_TOTP_UNAVAILABLE') return res.status(503).json({ error: 'Staff authentication is temporarily unavailable', requestId: res.req?.id });
    return res.status(401).json({ error: invalidMessage, requestId: res.req?.id });
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
      recoveryRequired: result.recoveryRequired === true,
    });
  }

  router.post('/totp/break-glass/exchange', sameOrigin, async (req, res, next) => {
    try {
      const result = await providerIndependentAuthService.exchangeBreakGlass({
        token: req.body?.token,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return providerAuthError(res, result, 'Invalid or expired controlled recovery handoff');
      return sendAuthenticatedSession(res, result);
    } catch (error) { return next(error); }
  });

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

  router.get('/session', requireSession, async (req, res, next) => {
    try {
      setNoStore(res);
      const providerIndependentAuth = await providerIndependentAuthService.credentialStatus(req.staffBrowserSession.adminId);
      return res.status(200).json({
        authenticated: true,
        viewer: req.staffBrowserSession.viewer || null,
        recoveryRequired: req.staffBrowserSession.recoveryRequired === true,
        providerIndependentAuth,
      });
    } catch (error) { return next(error); }
  });

  router.get('/totp/status', requireSession, async (req, res, next) => {
    try {
      setNoStore(res);
      const result = await providerIndependentAuthService.credentialStatus(req.staffBrowserSession.adminId);
      if (!result.available) return res.status(404).json({ error: 'Not Found', requestId: req.id });
      return res.status(200).json({
        enrolled: result.enrolled,
        enrollmentPending: result.enrollmentPending,
        recoveryRequired: req.staffBrowserSession.recoveryRequired === true || result.recoveryRequired,
        canResetOther: result.canResetOther,
      });
    } catch (error) { return next(error); }
  });

  router.get('/totp/manage', requireSession, async (req, res, next) => {
    try {
      setManagementSecurityHeaders(res);
      const status = await providerIndependentAuthService.credentialStatus(req.staffBrowserSession.adminId);
      if (!status.available) return res.status(404).type('text/plain').send('Not Found');
      return res.status(200).type('html').send(renderProviderIndependentStaffAuthPage());
    } catch (error) { return next(error); }
  });

  router.get('/totp/manage.js', requireSession, async (req, res, next) => {
    try {
      setManagementSecurityHeaders(res);
      const status = await providerIndependentAuthService.credentialStatus(req.staffBrowserSession.adminId);
      if (!status.available) return res.status(404).type('text/plain').send('Not Found');
      return res.status(200).type('application/javascript').send(providerIndependentStaffAuthClientScript());
    } catch (error) { return next(error); }
  });

  router.post('/totp/enrollment/start', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await providerIndependentAuthService.startEnrollment({
        session: req.staffBrowserSession,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return providerAuthError(res, result, 'Enrollment could not be started');
      setNoStore(res);
      return res.status(200).json(result);
    } catch (error) { return next(error); }
  });

  router.post('/totp/enrollment/confirm', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await providerIndependentAuthService.confirmEnrollment({
        session: req.staffBrowserSession,
        code: req.body?.code,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return providerAuthError(res, result, 'Invalid or expired enrollment');
      setNoStore(res);
      return res.status(200).json(result);
    } catch (error) { return next(error); }
  });

  router.post('/totp/enrollment/cancel', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await providerIndependentAuthService.cancelEnrollment({
        session: req.staffBrowserSession,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return providerAuthError(res, result, 'Enrollment could not be cancelled');
      setNoStore(res);
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  router.post('/totp/recovery/regenerate', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await providerIndependentAuthService.regenerateRecoveryCodes({
        session: req.staffBrowserSession,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return providerAuthError(res, result, 'Recovery codes could not be regenerated');
      setNoStore(res);
      return res.status(200).json(result);
    } catch (error) { return next(error); }
  });

  router.post('/totp/admin/reset', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await providerIndependentAuthService.privilegedReset({
        session: req.staffBrowserSession,
        subjectAdminId: req.body?.subjectAdminId,
        reason: req.body?.reason,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return providerAuthError(res, result, 'Reset is not authorized');
      setNoStore(res);
      return res.status(200).json(result);
    } catch (error) { return next(error); }
  });

  router.post('/csrf', sameOrigin, requireSession, async (req, res, next) => {
    try {
      const rotated = await service.rotateCsrfToken(req.staffBrowserSession.sessionId);
      if (!rotated.ok) return res.status(401).json({ error: 'Unauthorized', requestId: req.id });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ csrfToken: rotated.csrfToken });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      await service.revokeSession(req.staffBrowserSession.sessionId, 'logout');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Set-Cookie', serializeExpiredSessionCookie({ env }));
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createStaffBrowserSessionRouter };
