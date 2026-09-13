const express = require('express');
const workspaceServices = require('../services/workspaceServicesPractitionerScope');
const workspaceServiceCreation = require('../services/workspaceServiceCreation');
const workspaceClients = require('../services/workspaceClients');
const workspaceStaff = require('../services/workspaceStaff');
const {
  renderServicesListPage,
  renderServiceDetailPage,
  renderServicesUnavailablePage,
  workspaceServicesManageClientScript,
} = require('../presentation/workspaceServicesUx');
const {
  renderWorkspaceServiceCreationPage,
  injectWorkspaceServiceCreateAction,
  serviceCreationClientScript,
} = require('../presentation/workspaceServiceCreationUx');
const { requireStaffSession } = require('../middleware/staffBrowserSession');

function isWorkspaceServicesEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function setWorkspaceServicesSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function safeError(error) {
  const status = Number(error?.httpStatus) || 503;
  if (status === 400) return { status, message: 'The requested Services action is invalid.' };
  if (status === 403) return { status, message: 'You do not have access to this Services action.' };
  if (status === 404) return { status, message: 'That service was not found.' };
  if (status === 409) return { status, message: 'Services changed. Reload and retry.' };
  return { status: 503, message: 'Services are temporarily unavailable.' };
}

function navScript() {
  return `(()=>{const el=document.querySelector('[data-workspace-services-link]');if(!el)return;fetch('/calendar/services/access',{cache:'no-store',headers:{Accept:'application/json'}}).then(r=>{if(!r.ok)return;const a=document.createElement('a');a.className='workspace-link';a.href='/calendar/services';a.textContent='Services';el.replaceWith(a);}).catch(()=>{});})();`;
}

async function pageOptions(req, clientAccessService, staffAccessService, staffAccessPath) {
  let clientsNavigationAllowed = false;
  let staffNavigationAllowed = false;
  const adminId = req.staffBrowserSession?.adminId;
  try { clientsNavigationAllowed = Boolean(await clientAccessService.resolveAccess(adminId)); } catch (_error) {}
  try { staffNavigationAllowed = Boolean(await staffAccessService.resolveAccess(adminId)); } catch (_error) {}
  return {
    staffAccessScriptPath: `${staffAccessPath}/client.js`,
    calendarNavigationAllowed: Boolean(req.staffBrowserSession?.viewer),
    clientsNavigationAllowed,
    staffNavigationAllowed,
  };
}

async function detailPageOptions(req, service, clientAccessService, staffAccessService, staffAccessPath, model = null) {
  const options = await pageOptions(req, clientAccessService, staffAccessService, staffAccessPath);
  if (model?.practitionerScoped === true) {
    options.manageAllowed = model.manageUiAllowed === true;
    return options;
  }
  try { options.manageAllowed = Boolean(await service.resolveManageAccess(req.staffBrowserSession?.adminId)); }
  catch (_error) { options.manageAllowed = false; }
  return options;
}

function createWorkspaceServicesListHandler({
  env = process.env,
  service = workspaceServices,
  creationService = workspaceServiceCreation,
  clientAccessService = workspaceClients,
  staffAccessService = workspaceStaff,
  renderPage = renderServicesListPage,
  renderUnavailable = renderServicesUnavailablePage,
  injectCreateAction = injectWorkspaceServiceCreateAction,
  staffAccessPath = '/calendar/staff',
} = {}) {
  return async function workspaceServicesListHandler(req, res) {
    setWorkspaceServicesSecurityHeaders(res);
    if (!isWorkspaceServicesEnabled(env)) return res.status(404).type('text/plain').send('Not Found');
    try {
      const model = await service.listServices({
        adminId: req.staffBrowserSession?.adminId,
        q: req.query?.q,
        status: req.query?.status,
        offset: req.query?.offset,
      });
      const options = await detailPageOptions(req, service, clientAccessService, staffAccessService, staffAccessPath, model);
      let html = renderPage(model, options);
      try { if (await creationService.resolveCreateAccess(req.staffBrowserSession?.adminId)) html = injectCreateAction(html); }
      catch (_error) {}
      return res.status(200).type('html').send(html);
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ code: error?.code, message: safe.message }));
    }
  };
}

function createWorkspaceServiceDetailHandler({
  env = process.env,
  service = workspaceServices,
  clientAccessService = workspaceClients,
  staffAccessService = workspaceStaff,
  renderPage = renderServiceDetailPage,
  renderUnavailable = renderServicesUnavailablePage,
  staffAccessPath = '/calendar/staff',
} = {}) {
  return async function workspaceServiceDetailHandler(req, res) {
    setWorkspaceServicesSecurityHeaders(res);
    if (!isWorkspaceServicesEnabled(env)) return res.status(404).type('text/plain').send('Not Found');
    try {
      const model = await service.getServiceDetail({ adminId: req.staffBrowserSession?.adminId, serviceId: req.params?.id });
      return res.status(200).type('html').send(renderPage(
        model,
        await detailPageOptions(req, service, clientAccessService, staffAccessService, staffAccessPath, model)
      ));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ code: error?.code, message: safe.message }));
    }
  };
}

function createWorkspaceServicesRouter({ sessionService, ...options } = {}) {
  if (!sessionService) throw new Error('Workspace Services requires the existing staff browser session service');
  const service = options.service || workspaceServices;
  const creationService = options.creationService || workspaceServiceCreation;
  const router = express.Router();
  router.get('/nav.js', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).type('application/javascript').send(navScript());
  });
  router.use(requireStaffSession({ service: sessionService, env: options.env }));
  router.get('/access', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (!isWorkspaceServicesEnabled(options.env || process.env)) return res.sendStatus(404);
    try { return (await service.resolveAccess(req.staffBrowserSession?.adminId)) ? res.sendStatus(204) : res.sendStatus(403); }
    catch (_error) { return res.sendStatus(403); }
  });
  router.get('/manage.js', async (req, res) => {
    setWorkspaceServicesSecurityHeaders(res);
    if (!isWorkspaceServicesEnabled(options.env || process.env)) return res.sendStatus(404);
    try {
      if (!(await service.resolveManageAccess(req.staffBrowserSession?.adminId))) return res.sendStatus(403);
      return res.status(200).type('application/javascript').send(workspaceServicesManageClientScript());
    } catch (_error) { return res.sendStatus(403); }
  });
  router.get('/create.js', async (req, res) => {
    setWorkspaceServicesSecurityHeaders(res);
    if (!isWorkspaceServicesEnabled(options.env || process.env)) return res.sendStatus(404);
    try {
      if (!(await creationService.resolveCreateAccess(req.staffBrowserSession?.adminId))) return res.sendStatus(403);
      return res.status(200).type('application/javascript').send(serviceCreationClientScript());
    } catch (_error) { return res.sendStatus(403); }
  });
  router.get('/create-options', async (req, res) => {
    setWorkspaceServicesSecurityHeaders(res);
    if (!isWorkspaceServicesEnabled(options.env || process.env)) return res.sendStatus(404);
    try { return res.status(200).json(await creationService.listCreateOptions(req.staffBrowserSession?.adminId)); }
    catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).json({ error: safe.message, code: error?.code });
    }
  });
  router.get('/new', async (req, res) => {
    setWorkspaceServicesSecurityHeaders(res);
    if (!isWorkspaceServicesEnabled(options.env || process.env)) return res.sendStatus(404);
    try {
      await creationService.requireCreateAccess(req.staffBrowserSession?.adminId);
      return res.status(200).type('html').send(renderWorkspaceServiceCreationPage());
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('text/plain').send(safe.message);
    }
  });
  router.get('/', createWorkspaceServicesListHandler({ ...options, service, creationService }));
  router.get('/:id', createWorkspaceServiceDetailHandler({ ...options, service }));
  return router;
}

module.exports = {
  isWorkspaceServicesEnabled,
  setWorkspaceServicesSecurityHeaders,
  safeError,
  navScript,
  pageOptions,
  detailPageOptions,
  createWorkspaceServicesListHandler,
  createWorkspaceServiceDetailHandler,
  createWorkspaceServicesRouter,
};
