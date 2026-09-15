const express = require('express');
const workspaceClientMutations = require('../services/workspaceClientMutationsPractitionerScope');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');

function isWorkspaceClientsEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function strictBody(body, allowed) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const keys = Object.keys(source);
  const extras = keys.filter((key) => !allowed.includes(key));
  if (extras.length) {
    const error = new workspaceClientMutations.WorkspaceClientMutationError(
      'WORKSPACE_CLIENT_INVALID_PAYLOAD',
      'Unsupported client fields were supplied.',
      400,
    );
    error.details = { fields: extras };
    throw error;
  }
  return source;
}

function mutationStatus(error) {
  const status = Number(error?.httpStatus) || 503;
  return [400, 403, 404, 409].includes(status) ? status : 503;
}

function sendMutationError(error, req, res, next) {
  const status = mutationStatus(error);
  if (status === 503) return next(error);
  return res.status(status).json({
    error: error?.message || 'The client operation failed closed.',
    code: error?.code || 'WORKSPACE_CLIENT_OPERATION_FAILED',
    details: error?.details || undefined,
    requestId: req.id,
  });
}

function createWorkspaceClientMutationRouter({
  env = process.env,
  sessionService,
  service = workspaceClientMutations,
} = {}) {
  if (!sessionService) throw new Error('Workspace Client mutations require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });
  const mutationChain = [sameOrigin, requireSession, requireCsrf];

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!isWorkspaceClientsEnabled(env)) return res.sendStatus(404);
    return next();
  });

  router.post('/create', ...mutationChain, async (req, res, next) => {
    try {
      const body = strictBody(req.body, ['requestId', 'name', 'mobile']);
      const result = await service.createClient({
        adminId: req.staffBrowserSession.adminId,
        requestId: body.requestId,
        name: body.name,
        mobile: body.mobile,
      });
      return res.status(201).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  router.post('/:id/update', ...mutationChain, async (req, res, next) => {
    try {
      const body = strictBody(req.body, ['requestId', 'expectedRevision', 'name', 'mobile', 'dateOfBirth', 'gender']);
      const result = await service.updateClient({
        adminId: req.staffBrowserSession.adminId,
        clientId: req.params?.id,
        requestId: body.requestId,
        expectedRevision: body.expectedRevision,
        name: body.name,
        mobile: body.mobile,
        dateOfBirth: body.dateOfBirth,
        gender: body.gender,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  router.post('/:id/archive', ...mutationChain, async (req, res, next) => {
    try {
      const body = strictBody(req.body, ['requestId', 'expectedRevision']);
      const result = await service.archiveClient({
        adminId: req.staffBrowserSession.adminId,
        clientId: req.params?.id,
        requestId: body.requestId,
        expectedRevision: body.expectedRevision,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  return router;
}

module.exports = {
  isWorkspaceClientsEnabled,
  strictBody,
  mutationStatus,
  sendMutationError,
  createWorkspaceClientMutationRouter,
};
