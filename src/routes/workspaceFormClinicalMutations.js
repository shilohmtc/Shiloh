const express = require('express');
const workspacePractitionerFormRecords = require('../services/workspacePractitionerFormRecords');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');

function isWorkspaceFormClinicalEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function clinicalMutationStatus(error) {
  const status = Number(error?.httpStatus);
  return [403, 404, 409, 422].includes(status) ? status : 503;
}

function createWorkspaceFormClinicalMutationRouter({
  env = process.env,
  sessionService,
  practitionerRecordService = workspacePractitionerFormRecords,
} = {}) {
  if (!sessionService) throw new Error('Workspace form clinical mutations require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!isWorkspaceFormClinicalEnabled(env)) return res.sendStatus(404);
    return next();
  });

  router.post(
    '/submissions/client/:reference/assessment',
    sameOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        const result = await practitionerRecordService.saveRecord({
          adminId: req.staffBrowserSession?.adminId,
          submissionId: req.params.reference,
          body: req.body,
        });
        return res.status(200).json({ ok: true, revision: result.revision });
      } catch (error) {
        const status = clinicalMutationStatus(error);
        if (status === 503) return next(error);
        return res.status(status).json({
          error: error?.message || 'The practitioner assessment could not be saved.',
          code: error?.code || 'WORKSPACE_PRACTITIONER_RECORD_SAVE_FAILED',
          requestId: req.id,
        });
      }
    }
  );

  return router;
}

module.exports = {
  isWorkspaceFormClinicalEnabled,
  clinicalMutationStatus,
  createWorkspaceFormClinicalMutationRouter,
};
