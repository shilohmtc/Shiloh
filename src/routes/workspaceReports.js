const express = require('express');
const workspaceReports = require('../services/workspaceReportsPractitionerScope');
const {
  renderReportsPage,
  renderReportsUnavailablePage,
} = require('../presentation/workspaceReportsUx');
const { requireStaffSession } = require('../middleware/staffBrowserSession');

function isWorkspaceReportsEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function setWorkspaceReportsSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

function safeError(error) {
  const status = Number(error?.httpStatus) || 503;
  if (status === 400) return { status, message: 'The requested report range or filter is invalid.' };
  if (status === 403) return { status, message: 'Your authenticated Shiloh access does not permit this report scope.' };
  return { status: 503, message: 'Canonical operational reports are temporarily unavailable.' };
}

function createWorkspaceReportsHandler({
  env = process.env,
  service = workspaceReports,
  renderPage = renderReportsPage,
  renderUnavailable = renderReportsUnavailablePage,
  staffAccessPath = '/calendar/staff',
} = {}) {
  return async function workspaceReportsHandler(req, res) {
    setWorkspaceReportsSecurityHeaders(res);
    if (!isWorkspaceReportsEnabled(env)) return res.status(404).type('text/plain').send('Not Found');

    try {
      const model = await service.buildReport({
        adminId: req.staffBrowserSession?.adminId,
        preset: req.query?.range,
        from: req.query?.from,
        to: req.query?.to,
        staff: req.query?.staff,
      });
      return res.status(200).type('html').send(renderPage(model, {
        staffAccessScriptPath: `${staffAccessPath}/client.js`,
      }));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({
        code: error?.code,
        message: safe.message,
      }));
    }
  };
}

function createWorkspaceReportsRouter({ sessionService, ...options } = {}) {
  if (!sessionService) throw new Error('Workspace Reports requires the existing staff browser session service');
  const router = express.Router();
  router.use(requireStaffSession({ service: sessionService, env: options.env }));
  router.get('/', createWorkspaceReportsHandler(options));
  return router;
}

module.exports = {
  isWorkspaceReportsEnabled,
  setWorkspaceReportsSecurityHeaders,
  safeError,
  createWorkspaceReportsHandler,
  createWorkspaceReportsRouter,
};
