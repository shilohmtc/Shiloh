const express = require('express');
const workspaceServices = require('../services/workspaceServicesPractitionerScope');
const workspaceServiceCreation = require('../services/workspaceServiceCreation');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');

function isWorkspaceServicesEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function mutationStatus(error) {
  const status = Number(error?.httpStatus) || 503;
  return [400, 403, 404, 409].includes(status) ? status : 503;
}

function sendMutationError(error, req, res, next) {
  const status = mutationStatus(error);
  if (status === 503) return next(error);
  return res.status(status).json({
    error: error?.message || 'The canonical Services operation failed closed.',
    code: error?.code || 'WORKSPACE_SERVICES_OPERATION_FAILED',
    details: error?.details || undefined,
    requestId: req.id,
  });
}

function createWorkspaceServicesMutationRouter({
  env = process.env,
  sessionService,
  service = workspaceServices,
  creationService = workspaceServiceCreation,
} = {}) {
  if (!sessionService) throw new Error('Workspace Services mutations require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });
  const mutationChain = [sameOrigin, requireSession, requireCsrf];

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!isWorkspaceServicesEnabled(env)) return res.sendStatus(404);
    return next();
  });

  router.get('/create-options', requireSession, async (req, res, next) => {
    try {
      return res.status(200).json(await creationService.listCreateOptions(req.staffBrowserSession?.adminId));
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  router.post('/create', ...mutationChain, async (req, res, next) => {
    try {
      const result = await creationService.createService({
        adminId: req.staffBrowserSession?.adminId,
        requestId: req.body?.requestId,
        name: req.body?.name,
        durationMinutes: req.body?.durationMinutes,
        price: req.body?.price,
        displayPrice: req.body?.displayPrice,
        variablePrice: req.body?.variablePrice,
        staffIds: req.body?.staffIds,
      });
      return res.status(201).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  router.post('/:id/update', ...mutationChain, async (req, res, next) => {
    try {
      const result = await service.updateService({
        adminId: req.staffBrowserSession?.adminId,
        serviceId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        name: req.body?.name,
        durationMinutes: req.body?.durationMinutes,
        processingTimeMinutes: req.body?.processingTimeMinutes,
        extraTimeMinutes: req.body?.extraTimeMinutes,
        price: req.body?.price,
        displayPrice: req.body?.displayPrice,
        variablePrice: req.body?.variablePrice,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  router.post('/:id/status', ...mutationChain, async (req, res, next) => {
    try {
      const result = await service.setServiceStatus({
        adminId: req.staffBrowserSession?.adminId,
        serviceId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        status: req.body?.status,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  router.post('/:id/practitioners/:staffId/assign', ...mutationChain, async (req, res, next) => {
    try {
      const result = await service.assignPractitioner({
        adminId: req.staffBrowserSession?.adminId,
        serviceId: req.params?.id,
        staffId: req.params?.staffId,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  router.post('/:id/practitioners/:staffId/unassign', ...mutationChain, async (req, res, next) => {
    try {
      const result = await service.unassignPractitioner({
        adminId: req.staffBrowserSession?.adminId,
        serviceId: req.params?.id,
        staffId: req.params?.staffId,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(error, req, res, next);
    }
  });

  return router;
}

module.exports = {
  isWorkspaceServicesEnabled,
  mutationStatus,
  sendMutationError,
  createWorkspaceServicesMutationRouter,
};
