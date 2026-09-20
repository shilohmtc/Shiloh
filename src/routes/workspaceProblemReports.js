'use strict';

const express = require('express');
const problemReports = require('../services/problemReports');
const { ProblemReportError } = require('../services/problemReports');
const { renderProblemReportsPage, problemReportsClientScript } = require('../presentation/workspaceProblemReportsUx');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');
const { dispatchProblemReportNotifications } = require('../services/problemReportNotifications');

function securityHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  next();
}

function sendError(res, error, requestId) {
  const status = error instanceof ProblemReportError ? error.httpStatus : 503;
  return res.status(status).json({ error: status === 503 ? 'Problem reports are temporarily unavailable.' : error.message, requestId });
}

function createWorkspaceProblemReportsRouter({ env = process.env, sessionService, service = problemReports } = {}) {
  if (!sessionService) throw new Error('Problem reports require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env, humanNavigationSigninPath: '/calendar/staff' });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });

  router.use(securityHeaders, requireSession);
  router.get('/client.js', (_req, res) => res.status(200).type('application/javascript').send(problemReportsClientScript()));
  router.get('/', async (req, res, next) => {
    try {
      const access = await service.resolveWorkspaceAccess(req.staffBrowserSession.adminId);
      const selectedStatus = ['open', 'new', 'investigating', 'fixed', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open';
      const inbox = access.canManage
        ? await service.listForManager({ adminId: req.staffBrowserSession.adminId, status: selectedStatus })
        : await service.listForReporter({ reporterType: 'staff', adminId: req.staffBrowserSession.adminId });
      return res.status(200).type('html').send(renderProblemReportsPage({
        model: { ...inbox, ...access },
        selectedStatus,
      }));
    } catch (error) {
      if (error instanceof ProblemReportError) return res.status(error.httpStatus).type('text/plain').send(error.message);
      return next(error);
    }
  });
  router.post('/', sameOrigin, requireCsrf, async (req, res) => {
    try {
      const access = await service.resolveWorkspaceAccess(req.staffBrowserSession.adminId);
      if (!access.canSubmit) throw new ProblemReportError('PROBLEM_REPORT_FORBIDDEN', 'Problem reporting is not available for this Workspace account.', 403);
      const report = await service.createReport({ source: 'workspace', reporterType: 'staff', adminId: req.staffBrowserSession.adminId, payload: req.body, requestId: req.id });
      return res.status(201).json({ report: { reference: report.reference, status: report.status } });
    } catch (error) { return sendError(res, error, req.id); }
  });
  router.post('/:reference/status', sameOrigin, requireCsrf, async (req, res) => {
    try {
      const report = await service.updateStatus({ adminId: req.staffBrowserSession.adminId, reference: req.params.reference, status: req.body?.status, resolutionNote: req.body?.resolutionNote });
      if (report.status === 'fixed') setImmediate(() => dispatchProblemReportNotifications().catch(() => {}));
      return res.status(200).json({ report });
    } catch (error) { return sendError(res, error, req.id); }
  });
  router.get('/:reference/screenshot', async (req, res) => {
    try {
      const screenshot = await service.getScreenshot({ adminId: req.staffBrowserSession.adminId, reference: req.params.reference });
      res.setHeader('Content-Type', screenshot.mimeType);
      res.setHeader('Content-Disposition', 'inline');
      return res.status(200).send(screenshot.bytes);
    } catch (error) {
      if (error instanceof ProblemReportError) return res.status(error.httpStatus).type('text/plain').send(error.message);
      return res.status(503).type('text/plain').send('Screenshot unavailable.');
    }
  });
  return router;
}

module.exports = { createWorkspaceProblemReportsRouter };
