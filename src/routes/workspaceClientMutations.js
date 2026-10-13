const express = require('express');
const { pool } = require('../db/pool');
const { createWorkspaceClientMutationService } = require('../services/workspaceClientMutations');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');

function featureEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function strictBody(body, allowed) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const unexpected = Object.keys(payload).filter(key => !allowed.includes(key));
  if (unexpected.length) {
    const error = new Error('Unexpected client mutation fields.');
    error.code = 'WORKSPACE_CLIENT_INVALID_OPERATION';
    error.httpStatus = 400;
    throw error;
  }
  return payload;
}

function sendMutationError(res, error, requestId) {
  const status = Number(error?.httpStatus);
  if ([400, 403, 404, 409, 422].includes(status)) {
    return res.status(status).json({ error: error.message, code: error.code, requestId });
  }
  return null;
}

function createWorkspaceClientMutationRouter({
  env = process.env,
  sessionService,
  service = createWorkspaceClientMutationService({ db: pool }),
} = {}) {
  if (!sessionService) throw new Error('Workspace client mutations require staff browser sessions');
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });
  const requireSession = requireStaffSession({ service: sessionService, env });
  const requireCsrf = csrfGuard({ service: sessionService });
  const mutationChain = [sameOrigin, requireSession, requireCsrf];

  router.use((req, res, next) => featureEnabled(env) ? next() : res.status(404).json({ error: 'Not Found', requestId: req.id }));

  router.post('/create', ...mutationChain, async (req, res, next) => {
    try {
      const body = strictBody(req.body, ['requestId', 'name', 'mobile']);
      const result = await service.createClient({ adminId: req.staffBrowserSession.adminId, ...body });
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      return sendMutationError(res, error, req.id) || next(error);
    }
  });

  router.post('/:id/update', ...mutationChain, async (req, res, next) => {
    try {
      const body = strictBody(req.body, ['requestId', 'expectedRevision', 'name', 'mobile', 'dateOfBirth', 'gender']);
      const result = await service.updateClient({ adminId: req.staffBrowserSession.adminId, clientId: req.params.id, ...body });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(res, error, req.id) || next(error);
    }
  });

  router.post('/:id/delete', ...mutationChain, async (req, res, next) => {
    try {
      const body = strictBody(req.body, ['requestId', 'expectedRevision', 'confirmation']);
      const result = await service.deleteClient({ adminId: req.staffBrowserSession.adminId, clientId: req.params.id, ...body });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(res, error, req.id) || next(error);
    }
  });

  router.post('/:id/archive', ...mutationChain, async (req, res, next) => {
    try {
      const body = strictBody(req.body, ['requestId', 'expectedRevision']);
      const result = await service.archiveClient({ adminId: req.staffBrowserSession.adminId, clientId: req.params.id, ...body });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(res, error, req.id) || next(error);
    }
  });

  return router;
}

module.exports = { featureEnabled, strictBody, sendMutationError, createWorkspaceClientMutationRouter };
