const express = require('express');
const workspaceClinicHours = require('../services/workspaceClinicHours');
const workspaceClinicHoursHolidayGuard = require('../services/workspaceClinicHoursHolidayGuard');
const {
  renderClinicHoursPage,
  clinicHoursClientScript,
  assistantExceptionClientScript,
  clinicHoursTabsClientScript,
} = require('../presentation/workspaceClinicHoursUx');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');

function isWorkspaceClinicHoursEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function setClinicHoursSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function clinicHoursError(error) {
  const status = [400, 403, 409].includes(Number(error?.httpStatus)) ? Number(error.httpStatus) : 503;
  return {
    status,
    code: String(error?.code || 'WORKSPACE_CLINIC_HOURS_UNAVAILABLE'),
    message: status === 503 ? 'Canonical clinic hours are temporarily unavailable.' : String(error?.message || 'Clinic hours operation failed closed.'),
  };
}

function renderUnavailable(message) {
  const safe = String(message || 'Clinic hours are unavailable.')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clinic hours unavailable — Shiloh Workspace</title></head><body><main><h1>Clinic hours unavailable</h1><p>${safe}</p><p><a href="/calendar/workspace">Return to Workspace</a></p></main></body></html>`;
}

function createWorkspaceClinicHoursRouter({
  env = process.env,
  sessionService,
  service = workspaceClinicHours,
  holidayGuard = workspaceClinicHoursHolidayGuard,
  renderPage = renderClinicHoursPage,
} = {}) {
  if (!sessionService) throw new Error('Workspace Clinic hours routes require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });

  router.use((req, res, next) => {
    setClinicHoursSecurityHeaders(res);
    if (!isWorkspaceClinicHoursEnabled(env)) return res.sendStatus(404);
    return next();
  });
  router.use(requireSession);

  router.get('/client.js', (_req, res) => {
    return res.status(200).type('application/javascript').send(`${clinicHoursTabsClientScript()}\n${clinicHoursClientScript()}\n${assistantExceptionClientScript()}`);
  });

  router.get('/', async (req, res) => {
    try {
      const model = await service.buildModel({ adminId: req.staffBrowserSession?.adminId });
      return res.status(200).type('html').send(renderPage(model));
    } catch (error) {
      const safe = clinicHoursError(error);
      return res.status(safe.status).type('html').send(renderUnavailable(safe.message));
    }
  });

  router.post('/', sameOrigin, requireCsrf, async (req, res, next) => {
    try {
      const result = await service.updateHours({
        adminId: req.staffBrowserSession?.adminId,
        expectedRevision: req.body?.expectedRevision,
        days: req.body?.days,
      });
      return res.status(200).json(result);
    } catch (error) {
      const safe = clinicHoursError(error);
      if (safe.status === 503) return next(error);
      return res.status(safe.status).json({ error: safe.message, code: safe.code, details: error?.details || undefined, requestId: req.id });
    }
  });

  router.post('/assistant', sameOrigin, requireCsrf, async (req, res, next) => {
    try { return res.status(200).json(await service.updateAssistantHours({ adminId: req.staffBrowserSession?.adminId, expectedRevision: req.body?.expectedRevision, days: req.body?.days })); }
    catch (error) { const safe=clinicHoursError(error); if(safe.status===503)return next(error); return res.status(safe.status).json({error:safe.message,code:safe.code,requestId:req.id}); }
  });

  router.post('/exceptions', sameOrigin, requireCsrf, async (req, res, next) => {
    try {
      await holidayGuard.requireLoadedZaPublicHoliday(req.body?.exceptionDate);
      const result = await service.upsertException({
        adminId: req.staffBrowserSession?.adminId,
        exceptionDate: req.body?.exceptionDate,
        exceptionType: req.body?.exceptionType,
        startsLocal: req.body?.startsLocal,
        endsLocal: req.body?.endsLocal,
      });
      return res.status(200).json(result);
    } catch (error) {
      const safe = clinicHoursError(error);
      if (safe.status === 503) return next(error);
      return res.status(safe.status).json({ error: safe.message, code: safe.code, details: error?.details || undefined, requestId: req.id });
    }
  });

  router.post('/assistant-exceptions', sameOrigin, requireCsrf, async (req, res, next) => {
    try { await holidayGuard.requireLoadedZaPublicHoliday(req.body?.exceptionDate); return res.status(200).json(await service.upsertAssistantException({adminId:req.staffBrowserSession?.adminId,exceptionDate:req.body?.exceptionDate,exceptionType:req.body?.exceptionType,startsLocal:req.body?.startsLocal,endsLocal:req.body?.endsLocal})); }
    catch(error){const safe=clinicHoursError(error);if(safe.status===503)return next(error);return res.status(safe.status).json({error:safe.message,code:safe.code,requestId:req.id});}
  });

  return router;
}

module.exports = {
  isWorkspaceClinicHoursEnabled,
  setClinicHoursSecurityHeaders,
  clinicHoursError,
  createWorkspaceClinicHoursRouter,
};
