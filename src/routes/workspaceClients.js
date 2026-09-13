const express = require('express');
const workspaceClients = require('../services/workspaceClientsPractitionerScope');
const workspaceClientNotifications = require('../services/workspaceClientNotifications');
const workspaceClientMutations = require('../services/workspaceClientMutationsPractitionerScope');
const {
  renderClientListPage,
  renderClientsUnavailablePage,
} = require('../presentation/workspaceClientsUx');
const { renderClientDetailPageWithCommunications } = require('../presentation/workspaceCommunicationEvidenceUx');
const {
  injectClientListManagement,
  injectClientDetailManagement,
  workspaceClientsManageClientScript,
} = require('../presentation/workspaceClientsManageUx');
const { requireStaffSession } = require('../middleware/staffBrowserSession');

function isWorkspaceClientsEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function setWorkspaceClientsSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function safeError(error) {
  const status = Number(error?.httpStatus) || 503;
  if (status === 400) return { status, message: 'The requested Clients view is invalid.' };
  if (status === 403) return { status, message: 'Your authenticated Shiloh access does not permit client lookup.' };
  if (status === 404) return { status, message: 'That canonical client was not found.' };
  return { status: 503, message: 'Canonical client reads are temporarily unavailable.' };
}

function pageOptions(req, staffAccessPath, extras = {}) {
  return {
    staffAccessScriptPath: `${staffAccessPath}/client.js`,
    calendarNavigationAllowed: Boolean(req.staffBrowserSession?.viewer),
    ...extras,
  };
}

function createWorkspaceClientListHandler({
  env = process.env,
  service = workspaceClients,
  renderPage = renderClientListPage,
  renderUnavailable = renderClientsUnavailablePage,
  injectManagement = injectClientListManagement,
  staffAccessPath = '/calendar/staff',
} = {}) {
  return async function workspaceClientListHandler(req, res) {
    setWorkspaceClientsSecurityHeaders(res);
    if (!isWorkspaceClientsEnabled(env)) return res.status(404).type('text/plain').send('Not Found');
    try {
      const model = await service.listClients({
        adminId: req.staffBrowserSession?.adminId,
        q: req.query?.q,
        status: req.query?.status,
        offset: req.query?.offset,
      });
      const html = injectManagement(renderPage(model, pageOptions(req, staffAccessPath)), model);
      return res.status(200).type('html').send(html);
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ code: error?.code, message: safe.message }));
    }
  };
}

function createWorkspaceClientDetailHandler({
  env = process.env,
  service = workspaceClients,
  notificationService = workspaceClientNotifications,
  renderPage = renderClientDetailPageWithCommunications,
  renderUnavailable = renderClientsUnavailablePage,
  injectManagement = injectClientDetailManagement,
  staffAccessPath = '/calendar/staff',
} = {}) {
  return async function workspaceClientDetailHandler(req, res) {
    setWorkspaceClientsSecurityHeaders(res);
    if (!isWorkspaceClientsEnabled(env)) return res.status(404).type('text/plain').send('Not Found');
    try {
      const model = await service.getClientDetail({
        adminId: req.staffBrowserSession?.adminId,
        clientId: req.params?.id,
        historyOffset: req.query?.historyOffset,
      });
      let notificationActionAllowed = false;
      try {
        notificationActionAllowed = Boolean(await notificationService.resolveAccess(req.staffBrowserSession?.adminId));
      } catch (_error) {
        notificationActionAllowed = false;
      }
      const html = renderPage(model, pageOptions(req, staffAccessPath, { notificationActionAllowed }));
      return res.status(200).type('html').send(injectManagement(html, model));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ code: error?.code, message: safe.message }));
    }
  };
}

function createWorkspaceClientsRouter({ sessionService, ...options } = {}) {
  if (!sessionService) throw new Error('Workspace Clients requires the existing staff browser session service');
  const service = options.service || workspaceClients;
  const mutationService = options.mutationService || workspaceClientMutations;
  const router = express.Router();
  router.use(requireStaffSession({ service: sessionService, env: options.env }));
  router.get('/manage.js', async (req, res) => {
    setWorkspaceClientsSecurityHeaders(res);
    if (!isWorkspaceClientsEnabled(options.env || process.env)) return res.sendStatus(404);
    try {
      if (!(await mutationService.resolveManageAccess(req.staffBrowserSession?.adminId))) return res.sendStatus(403);
      return res.status(200).type('application/javascript').send(workspaceClientsManageClientScript());
    } catch (_error) {
      return res.sendStatus(403);
    }
  });
  router.get('/', createWorkspaceClientListHandler({ ...options, service }));
  router.get('/:id', createWorkspaceClientDetailHandler({ ...options, service }));
  return router;
}

module.exports = {
  isWorkspaceClientsEnabled,
  setWorkspaceClientsSecurityHeaders,
  safeError,
  pageOptions,
  createWorkspaceClientListHandler,
  createWorkspaceClientDetailHandler,
  createWorkspaceClientsRouter,
};
