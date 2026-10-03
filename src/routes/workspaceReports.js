const express = require('express');
const workspaceReports = require('../services/workspaceReportsProfileView');
const workspaceWelcomeVoucherCampaign = require('../services/workspaceWelcomeVoucherCampaign');
const staffEarnings = require('../services/workspaceStaffEarnings');
const {
  renderReportsPage,
  renderReportsUnavailablePage,
  commissionClientScript,
} = require('../presentation/workspaceReportsUx');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');

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
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

function safeError(error) {
  const status = Number(error?.httpStatus) || 503;
  if (status === 400) return { status, message: 'Please check the selected dates or team member and try again.' };
  if (status === 403) return { status, message: 'You do not have access to this report.' };
  return { status: 503, message: 'Clinic reports are temporarily unavailable. Please try again shortly.' };
}

function createWorkspaceReportsHandler({
  env = process.env,
  service = workspaceReports,
  welcomeVoucherCampaignService = service === workspaceReports
    ? workspaceWelcomeVoucherCampaign
    : { async buildCampaign() { return null; } },
  earningsService = service === workspaceReports ? staffEarnings : { async requireOwner() { throw Object.assign(new Error('Forbidden'), { httpStatus: 403 }); } },
  sessionService,
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
      try {
        model.welcomeVoucherCampaign = await welcomeVoucherCampaignService.buildCampaign({
          adminId: req.staffBrowserSession?.adminId,
          recentLimit: 12,
        });
      } catch (_error) {
        model.welcomeVoucherCampaign = null;
      }
      if (await earningsService.requireOwner(req.staffBrowserSession?.adminId).then(() => true, error => {
        if (error?.httpStatus === 403) return false;
        throw error;
      })) {
        model.staffEarnings = await earningsService.build({
          adminId: req.staffBrowserSession.adminId,
          period: model.period,
          selectedStaffId: model.selectedStaffId,
        });
      }
      const rotated = model.staffEarnings
        ? await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId)
        : null;
      if (model.staffEarnings && !rotated?.ok) return res.status(401).type('text/plain').send('Unauthorized');
      return res.status(200).type('html').send(renderPage(model, {
        staffAccessScriptPath: `${staffAccessPath}/client.js`,
        csrfToken: rotated?.csrfToken || '',
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
  const earningsService = options.earningsService || staffEarnings;
  router.use((req, res, next) => {
    setWorkspaceReportsSecurityHeaders(res);
    if (!isWorkspaceReportsEnabled(options.env || process.env)) return res.sendStatus(404);
    return next();
  });
  router.use(requireStaffSession({ service: sessionService, env: options.env }));
  router.get('/commission.js', async (req, res) => {
    try {
      await earningsService.requireOwner(req.staffBrowserSession?.adminId);
      return res.type('application/javascript').send(commissionClientScript());
    } catch (_error) { return res.sendStatus(403); }
  });
  router.post('/commission-rules', sameOriginGuard({ env: options.env }), csrfGuard({ service: sessionService }), express.json({ limit: '4kb' }), async (req, res) => {
    try {
      const saved = await earningsService.addRule({ ...req.body, adminId: req.staffBrowserSession?.adminId });
      return res.status(201).json(saved);
    } catch (error) {
      const status = [400, 403, 409].includes(error?.httpStatus) ? error.httpStatus : 503;
      return res.status(status).json({ error: status === 503 ? 'Commission rules are unavailable.' : error.message });
    }
  });
  router.get('/', createWorkspaceReportsHandler({ ...options, earningsService, sessionService }));
  return router;
}

module.exports = {
  isWorkspaceReportsEnabled,
  setWorkspaceReportsSecurityHeaders,
  safeError,
  createWorkspaceReportsHandler,
  createWorkspaceReportsRouter,
};
