const express = require('express');
const packages = require('../services/workspacePackages');
const creation = require('../services/workspaceServiceCreation');
const clients = require('../services/workspaceClients');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');
function isWorkspaceServicesEnabled(env) {
  return (
    String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED).toLowerCase() === 'true' &&
    String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED).toLowerCase() === 'true'
  );
}
function setWorkspaceServicesSecurityHeaders(res) {
  return require('./workspaceServices').setWorkspaceServicesSecurityHeaders(res);
}
const {
  renderWorkspacePackages,
  packageClientScript,
} = require('../presentation/workspacePackagesUx');
function createWorkspacePackagesRouter({
  sessionService,
  env = process.env,
  service = packages,
  creationService = creation,
  clientService = clients,
} = {}) {
  const r = express.Router();
  r.use(requireStaffSession({ service: sessionService, env }));
  r.use((req, res, next) => {
    setWorkspaceServicesSecurityHeaders(res);
    if (!isWorkspaceServicesEnabled(env)) return res.sendStatus(404);
    next();
  });
  function error(e, res, next) {
    if (e.httpStatus && e.httpStatus < 500)
      return res.status(e.httpStatus).json({ error: e.message, code: e.code });
    next(e);
  }
  r.get('/', async (req, res, next) => {
    try {
      const adminId = req.staffBrowserSession.adminId;
      const authority = await service.requireAccess(adminId);
      let createOptions = null;
      try {
        createOptions = await creationService.listCreateOptions(adminId);
      } catch (e) {
        if (e.httpStatus !== 403) throw e;
      }
      const [offers, purchases] = await Promise.all([
        service.list(adminId),
        service.purchases(adminId),
      ]);
      res
        .type('html')
        .send(
          renderWorkspacePackages({
            packages: offers,
            purchases,
            createOptions,
            authority,
            options: {
              calendarNavigationAllowed: Boolean(req.staffBrowserSession.viewer),
              clientsNavigationAllowed: true,
              staffAccessScriptPath: '/calendar/staff/client.js',
            },
          }),
        );
    } catch (e) {
      error(e, res, next);
    }
  });
  r.get('/client.js', async (req, res, next) => {
    try {
      await service.requireAccess(req.staffBrowserSession.adminId);
      res.type('application/javascript').send(packageClientScript());
    } catch (e) {
      error(e, res, next);
    }
  });
  r.get('/clients', async (req, res, next) => {
    try {
      const adminId = req.staffBrowserSession.adminId;
      await service.requireAccess(adminId);
      const model = await clientService.listClients({ adminId, q: req.query.q, status: 'active' });
      res.json({
        clients: model.clients.map((c) => ({
          id: c.id,
          name: c.name,
          mobile: c.mobile || c.normalized_mobile || '',
        })),
      });
    } catch (e) {
      error(e, res, next);
    }
  });
  const guards = [sameOriginGuard({ env }), csrfGuard({ service: sessionService })];
  r.post('/paid', ...guards, async (req, res, next) => {
    try {
      res
        .status(201)
        .json(await service.recordPaid({ ...req.body, adminId: req.staffBrowserSession.adminId }));
    } catch (e) {
      error(e, res, next);
    }
  });
  for (const action of ['create', 'edit', 'delete', 'restore'])
    r.post(
      action === 'create' ? '/create' : `/:id/${action}`,
      ...guards,
      async (req, res, next) => {
        try {
          res
            .status(action === 'create' ? 201 : 200)
            .json(
              await service.mutate({
                ...req.body,
                adminId: req.staffBrowserSession.adminId,
                id: req.params.id,
                action,
              }),
            );
        } catch (e) {
          error(e, res, next);
        }
      },
    );
  return r;
}
module.exports = { createWorkspacePackagesRouter };
