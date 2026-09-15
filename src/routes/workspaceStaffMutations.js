const express = require('express');
const workspaceStaff = require('../services/workspaceStaff');
const workspaceStaffAccess = require('../services/workspaceStaffAccess');
const workspaceStaffAccessCompletion = require('../services/workspaceStaffAccessCompletion');
const workspaceStaffAccessPolicy = require('../services/workspaceStaffAccessPolicy');
const workspaceAccessV2 = require('../services/workspaceAccessV2');
const workspaceStaffAccessProfiles = require('../services/workspaceStaffAccessProfiles');
const { createWorkspaceReceptionDeviceSigninService } = require('../services/workspaceReceptionDeviceSignin');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
  requestFingerprintHash,
} = require('../middleware/staffBrowserSession');

function isWorkspaceStaffEnabled(env = process.env) {
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
    error: error?.message || 'The Staff access operation failed closed.',
    code: error?.code || 'WORKSPACE_STAFF_OPERATION_FAILED',
    requestId: req.id,
  });
}

function deviceSigninStatus(code) {
  if (code === 'STAFF_RECENT_AUTH_REQUIRED') return 428;
  if (code === 'STAFF_RESET_FORBIDDEN') return 403;
  if (code === 'RECEPTION_DEVICE_SIGNIN_NOT_FOUND') return 404;
  if (code === 'RECEPTION_DEVICE_SIGNIN_RATE_LIMITED') return 409;
  return 503;
}

function createWorkspaceStaffMutationRouter({
  env = process.env,
  sessionService,
  service = workspaceStaff,
  accessService = workspaceStaffAccess,
  accessCompletionService = workspaceStaffAccessCompletion,
  accessPolicyService = workspaceStaffAccessPolicy,
  accessV2Service = workspaceAccessV2,
  profileService = workspaceStaffAccessProfiles,
  receptionDeviceSigninService = createWorkspaceReceptionDeviceSigninService({ env }),
} = {}) {
  if (!sessionService) throw new Error('Workspace Staff mutations require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });
  const mutationChain = [sameOrigin, requireSession, requireCsrf];

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!isWorkspaceStaffEnabled(env)) return res.sendStatus(404);
    return next();
  });

  router.post('/create', ...mutationChain, async (req, res, next) => {
    try {
      const result = await service.createStaff({
        adminId: req.staffBrowserSession?.adminId,
        requestId: req.body?.requestId,
        displayName: req.body?.displayName,
        resourceType: req.body?.resourceType,
        schedulingType: req.body?.schedulingType,
        clientBookable: req.body?.clientBookable,
      });
      return res.status(201).json(result);
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/:id/update', ...mutationChain, async (req, res, next) => {
    try {
      const result = await service.updateStaff({
        adminId: req.staffBrowserSession?.adminId,
        staffId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        displayName: req.body?.displayName,
        schedulingType: req.body?.schedulingType,
        clientBookable: req.body?.clientBookable,
      });
      return res.status(200).json(result);
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/:id/status', ...mutationChain, async (req, res, next) => {
    try {
      const result = await service.setStaffStatus({
        adminId: req.staffBrowserSession?.adminId,
        staffId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        status: req.body?.status,
      });
      return res.status(200).json(result);
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/:id/access/enable', ...mutationChain, async (req, res, next) => {
    try {
      const result = await accessService.enableWorkspaceAccess({
        adminId: req.staffBrowserSession?.adminId,
        staffId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        whatsappNumber: req.body?.whatsappNumber,
        identityConfirmed: req.body?.identityConfirmed === true,
      });
      return res.status(200).json(result);
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/:id/access/complete', ...mutationChain, async (req, res, next) => {
    try {
      const result = await accessCompletionService.completeWorkspaceAccess({
        adminId: req.staffBrowserSession?.adminId,
        staffId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        whatsappNumber: req.body?.whatsappNumber,
        identityConfirmed: req.body?.identityConfirmed === true,
      });
      return res.status(200).json(result);
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/:id/access/policy', ...mutationChain, async (req, res, next) => {
    try {
      const result = await accessPolicyService.updatePolicy({
        adminId: req.staffBrowserSession?.adminId,
        staffId: req.params?.id,
        expectedAccessRevision: req.body?.expectedAccessRevision,
        requestId: req.body?.requestId,
        capabilities: req.body?.capabilities,
        ...(req.body && Object.prototype.hasOwnProperty.call(req.body, 'retrospectiveClientIds')
          ? { retrospectiveClientIds: req.body.retrospectiveClientIds }
          : {}),
      });
      return res.status(200).json(result);
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/staff-access/:id/profile', ...mutationChain, async (req, res, next) => {
    try {
      return res.status(200).json(await profileService.applyProfile({
        adminId: req.staffBrowserSession?.adminId,
        principalId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        profile: req.body?.profile,
      }));
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/staff-access/:id/toggle', ...mutationChain, async (req, res, next) => {
    try {
      return res.status(200).json(await profileService.setToggle({
        adminId: req.staffBrowserSession?.adminId,
        principalId: req.params?.id,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        toggle: req.body?.toggle,
        on: req.body?.on,
      }));
    } catch (error) { return sendMutationError(error, req, res, next); }
  });

  router.post('/workspace-access/reception', ...mutationChain, async (req, res, next) => {
    try {
      return res.status(201).json(await accessV2Service.createReception({ adminId: req.staffBrowserSession?.adminId, requestId: req.body?.requestId, whatsappNumber: req.body?.whatsappNumber, identityConfirmed: req.body?.identityConfirmed === true }));
    } catch (error) { return sendMutationError(error, req, res, next); }
  });
  router.post('/workspace-access/:id/preset', ...mutationChain, async (req, res, next) => {
    try {
      return res.status(200).json(await accessV2Service.applyPreset({ adminId: req.staffBrowserSession?.adminId, principalId: req.params?.id, requestId: req.body?.requestId, expectedRevision: req.body?.expectedRevision, preset: req.body?.preset }));
    } catch (error) { return sendMutationError(error, req, res, next); }
  });
  router.post('/workspace-access/:id/copy-preview', ...mutationChain, async (req, res, next) => {
    try {
      return res.status(200).json(await accessV2Service.previewCopy({ adminId: req.staffBrowserSession?.adminId, principalId: req.params?.id, expectedRevision: req.body?.expectedRevision, sourcePrincipalId: req.body?.sourcePrincipalId, expectedSourceRevision: req.body?.expectedSourceRevision }));
    } catch (error) { return sendMutationError(error, req, res, next); }
  });
  router.post('/workspace-access/:id/copy', ...mutationChain, async (req, res, next) => {
    try {
      return res.status(200).json(await accessV2Service.copyAccess({ adminId: req.staffBrowserSession?.adminId, principalId: req.params?.id, requestId: req.body?.requestId, expectedRevision: req.body?.expectedRevision, sourcePrincipalId: req.body?.sourcePrincipalId, expectedSourceRevision: req.body?.expectedSourceRevision }));
    } catch (error) { return sendMutationError(error, req, res, next); }
  });
  router.post('/workspace-access/:id/status', ...mutationChain, async (req, res, next) => {
    try {
      return res.status(200).json(await accessV2Service.setActive({ adminId: req.staffBrowserSession?.adminId, principalId: req.params?.id, requestId: req.body?.requestId, expectedRevision: req.body?.expectedRevision, active: req.body?.active }));
    } catch (error) { return sendMutationError(error, req, res, next); }
  });
  router.post('/workspace-access/:id/device-signin-setup', ...mutationChain, async (req, res, next) => {
    try {
      const result = await receptionDeviceSigninService.issue({
        session: req.staffBrowserSession,
        targetAdminId: req.params?.id,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result?.ok) {
        return res.status(deviceSigninStatus(result?.code)).json({
          error: result?.error || 'Reception device sign-in setup failed closed.',
          code: result?.code || 'RECEPTION_DEVICE_SIGNIN_BOOTSTRAP_UNAVAILABLE',
          requestId: req.id,
        });
      }
      return res.status(201).json({ ok: true, setupUrl: result.setupUrl, expiresAt: result.expiresAt, displayName: result.displayName });
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = {
  isWorkspaceStaffEnabled,
  mutationStatus,
  sendMutationError,
  deviceSigninStatus,
  createWorkspaceStaffMutationRouter,
};
