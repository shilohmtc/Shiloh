const express = require('express');
const workspaceClientNotifications = require('../services/workspaceClientNotifications');
const {
  renderBookingConfirmationPreviewPage,
  bookingConfirmationClientScript,
  renderClientNotificationUnavailablePage,
} = require('../presentation/workspaceClientNotificationsUx');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');

function isWorkspaceClientNotificationsEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function setWorkspaceClientNotificationSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function safeError(error) {
  const status = Number(error?.httpStatus) || 503;
  if (status === 400) return { status, message: error?.message || 'The requested client notification is invalid.' };
  if (status === 403) return { status, message: 'Your authenticated Shiloh access does not permit client notifications.' };
  if (status === 404) return { status, message: 'That canonical client was not found.' };
  if (status === 409) return { status, message: error?.message || 'The booking confirmation is no longer sendable.' };
  return { status: 503, message: error?.message || 'The booking confirmation was not sent. No successful delivery claim is being made.' };
}

function pageOptions(req, staffAccessPath) {
  return {
    staffAccessScriptPath: `${staffAccessPath}/client.js`,
    calendarNavigationAllowed: Boolean(req.staffBrowserSession?.viewer),
  };
}

function createWorkspaceClientNotificationRouter({
  env = process.env,
  sessionService,
  service = workspaceClientNotifications,
  renderPreview = renderBookingConfirmationPreviewPage,
  renderUnavailable = renderClientNotificationUnavailablePage,
  staffAccessPath = '/calendar/staff',
} = {}) {
  if (!sessionService) throw new Error('Workspace client notifications require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });

  router.use((req, res, next) => {
    setWorkspaceClientNotificationSecurityHeaders(res);
    if (!isWorkspaceClientNotificationsEnabled(env)) return res.sendStatus(404);
    return next();
  });

  router.get('/:clientId/booking-confirmation.js', requireSession, async (req, res) => {
    try {
      const authority = await service.resolveAccess(req.staffBrowserSession?.adminId);
      if (!authority) return res.sendStatus(403);
      return res.status(200).type('application/javascript').send(bookingConfirmationClientScript());
    } catch (_error) {
      return res.sendStatus(403);
    }
  });

  router.get('/:clientId/booking-confirmation', requireSession, async (req, res) => {
    try {
      const preview = await service.getPreview({
        adminId: req.staffBrowserSession?.adminId,
        clientId: req.params?.clientId,
      });
      return res.status(200).type('html').send(renderPreview(preview, pageOptions(req, staffAccessPath)));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  router.post('/:clientId/booking-confirmation/send', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await service.sendBookingConfirmation({
        adminId: req.staffBrowserSession?.adminId,
        clientId: req.params?.clientId,
      });
      return res.status(200).json(result);
    } catch (error) {
      const safe = safeError(error);
      if (safe.status === 503 && !error?.httpStatus) return next(error);
      return res.status(safe.status).json({
        error: safe.message,
        code: error?.code || 'WORKSPACE_CLIENT_NOTIFY_FAILED',
        requestId: req.id,
      });
    }
  });

  return router;
}

module.exports = {
  isWorkspaceClientNotificationsEnabled,
  setWorkspaceClientNotificationSecurityHeaders,
  safeError,
  pageOptions,
  createWorkspaceClientNotificationRouter,
};
