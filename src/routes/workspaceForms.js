const express = require('express');
const workspaceForms = require('../services/workspaceForms');
const workspaceFormSubmissions = require('../services/workspaceFormSubmissions');
const {
  renderFormsPage,
  renderFormPreviewPage,
  renderSubmissionPage,
  renderFormsUnavailablePage,
} = require('../presentation/workspaceFormsUx');
const { requireStaffSession } = require('../middleware/staffBrowserSession');

function isWorkspaceFormsEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function setWorkspaceFormsSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function safeError(error) {
  if (Number(error?.httpStatus) === 403) return { status: 403, message: error.message || 'You do not have access to this form information.' };
  if (Number(error?.httpStatus) === 404) return { status: 404, message: error.message || 'That consultation form was not found.' };
  return { status: 503, message: 'Forms are temporarily unavailable.' };
}

function createWorkspaceFormsRouter({
  env = process.env,
  sessionService,
  service = workspaceForms,
  submissionService = workspaceFormSubmissions,
  renderPage = renderFormsPage,
  renderPreview = renderFormPreviewPage,
  renderSubmission = renderSubmissionPage,
  renderUnavailable = renderFormsUnavailablePage,
  staffAccessPath = '/calendar/staff',
} = {}) {
  if (!sessionService) throw new Error('Workspace Forms requires the existing staff browser session service');
  const router = express.Router();

  router.use((req, res, next) => {
    setWorkspaceFormsSecurityHeaders(res);
    if (!isWorkspaceFormsEnabled(env)) return res.sendStatus(404);
    return next();
  });
  router.use(requireStaffSession({
    service: sessionService,
    env,
    humanNavigationSigninPath: staffAccessPath,
  }));

  router.get('/access', async (req, res) => {
    try {
      return (await service.resolveAccess(req.staffBrowserSession?.adminId)) ? res.sendStatus(204) : res.sendStatus(403);
    } catch (_error) {
      return res.sendStatus(403);
    }
  });

  router.get('/', async (req, res) => {
    try {
      const [model, submissions] = await Promise.all([
        service.listForms({ adminId: req.staffBrowserSession?.adminId }),
        submissionService.listSubmissions({ adminId: req.staffBrowserSession?.adminId }),
      ]);
      return res.status(200).type('html').send(renderPage({ ...model, submissions }));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  router.get('/submissions/:kind/:reference', async (req, res) => {
    try {
      const model = await submissionService.getSubmission({
        adminId: req.staffBrowserSession?.adminId,
        kind: req.params.kind,
        reference: req.params.reference,
      });
      return res.status(200).type('html').send(renderSubmission(model));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  router.get('/:templateKey', async (req, res) => {
    try {
      const model = await service.getFormPreview({
        adminId: req.staffBrowserSession?.adminId,
        templateKey: req.params.templateKey,
      });
      return res.status(200).type('html').send(renderPreview(model));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  return router;
}

module.exports = {
  isWorkspaceFormsEnabled,
  setWorkspaceFormsSecurityHeaders,
  safeError,
  createWorkspaceFormsRouter,
};
