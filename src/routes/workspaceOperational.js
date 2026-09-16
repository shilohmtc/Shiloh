'use strict';

const express = require('express');
const workspaceDashboard = require('../services/workspaceDashboard');
const workspaceNavigation = require('../services/workspaceNavigation');
const {
  renderDashboardPage,
  renderDashboardUnavailablePage,
  dashboardClientScript,
} = require('../presentation/workspaceDashboardUx');
const { decorateWorkspaceAppointmentLinks } = require('../presentation/calendarAppointmentDetailLinks');
const { workspaceNavigationClientScript } = require('../presentation/workspaceShell');
const { workspaceIconClientScript } = require('../presentation/workspaceIconClient');
const { calendarDesktopApprovedClientScript } = require('../presentation/calendarDesktopApprovedUx');
const { calendarDesktopFitCanvasClientScript } = require('../presentation/calendarDesktopFitCanvasUx');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');

function isWorkspaceOperationalEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true'
    && String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function isStaffPasskeyAuthEnabled(env = process.env) {
  return String(env.SHILOH_STAFF_PASSKEY_AUTH_ENABLED || '').trim().toLowerCase() === 'true';
}

function isSharedReceptionViewer(viewer = {}) {
  return String(viewer?.role || '') === 'receptionist'
    && String(viewer?.businessRole || '') === 'booking_operator'
    && viewer?.linkedStaffId == null
    && String(viewer?.calendarScope || '') === 'all_business'
    && String(viewer?.serviceScope || '') === 'all_services';
}

function accountNavigationMetadata({ viewer, passkeyEnabled = false } = {}) {
  const sharedReception = isSharedReceptionViewer(viewer);
  return {
    mode: sharedReception ? 'shared_reception' : 'personal',
    lockWorkspace: sharedReception && Boolean(passkeyEnabled),
  };
}

function passkeyNavigationClientScript(env = process.env) {
  if (!isStaffPasskeyAuthEnabled(env)) return '';
  return `(()=>{'use strict';const account=document.querySelector('[data-workspace-account-footer]');if(!account||account.querySelector('[data-workspace-passkey-security]'))return;const link=document.createElement('a');link.className='workspace-account-signout';link.href='/calendar/staff-auth/passkeys/manage';link.dataset.workspacePasskeySecurity='true';link.textContent='Devices & sign-in';const signout=account.querySelector('[data-shiloh-logout]');if(signout)account.insertBefore(link,signout);else account.appendChild(link);})();`;
}

function receptionLockNavigationClientScript(env = process.env) {
  if (!isStaffPasskeyAuthEnabled(env)) return '';
  return `(()=>{'use strict';const button=document.querySelector('[data-shiloh-logout]');if(!button)return;fetch('/calendar/workspace/navigation',{credentials:'same-origin',headers:{Accept:'application/json'}}).then(async(response)=>{if(!response.ok)return null;return response.json();}).then((data)=>{if(!data||!data.account||data.account.lockWorkspace!==true)return;button.textContent='Lock workspace';button.setAttribute('aria-label','Lock Shiloh Workspace');button.dataset.shilohLockWorkspace='true';button.addEventListener('click',()=>{setTimeout(()=>{const status=document.querySelector('[data-shiloh-calendar-access-status]');if(status)status.textContent='Locking workspace…';},0);});}).catch(()=>{});})();`;
}

function setWorkspaceOperationalSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function stabilizeDashboardShell(html) {
  const style = '<style data-dashboard-shell-stability>@media(min-width:901px){.workspace-nav{position:sticky;top:0;height:100vh;align-self:start;overflow-y:auto}}@media(max-width:700px){.booking-request .action-button{min-height:46px!important}}</style>';
  const source = String(html || '');
  return source.includes('</head>') ? source.replace('</head>', `${style}</head>`) : source;
}

function dashboardCalendarHref(model = {}) {
  const dateKey = String(model.operationalDateKey || '').trim();
  return `/calendar/read-only?view=week${dateKey ? `&date=${encodeURIComponent(dateKey)}` : ''}&staff=all`;
}

function dashboardSafeError(error) {
  if (Number(error?.httpStatus) === 403) return { status: 403, message: 'Your authenticated Shiloh access does not permit the operational Dashboard.' };
  return { status: 503, message: 'Canonical operational Dashboard data is temporarily unavailable.' };
}

function dashboardMutationError(error) {
  const status = [400, 403, 409].includes(Number(error?.httpStatus)) ? Number(error.httpStatus) : 503;
  return {
    status,
    code: String(error?.code || 'WORKSPACE_DASHBOARD_UNAVAILABLE'),
    message: status === 503 ? 'Canonical Workspace operation is temporarily unavailable.' : error.message,
  };
}

function createWorkspaceOperationalRouter({
  env = process.env,
  sessionService,
  dashboardService = workspaceDashboard,
  navigationService = workspaceNavigation,
  renderDashboard = renderDashboardPage,
  renderUnavailable = renderDashboardUnavailablePage,
  staffAccessPath = '/calendar/staff',
} = {}) {
  if (!sessionService) throw new Error('Workspace operational routes require the existing staff browser session service');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env, humanNavigationSigninPath: staffAccessPath });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });

  router.get('/nav.js', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).type('application/javascript').send(`${workspaceNavigationClientScript()}\n${passkeyNavigationClientScript(env)}\n${receptionLockNavigationClientScript(env)}\n${workspaceIconClientScript()}\n${calendarDesktopApprovedClientScript()}\n${calendarDesktopFitCanvasClientScript()}`);
  });

  router.use((req, res, next) => {
    setWorkspaceOperationalSecurityHeaders(res);
    if (!isWorkspaceOperationalEnabled(env)) return res.sendStatus(404);
    return next();
  });
  router.use(requireSession);

  router.get('/client.js', (_req, res) => {
    return res.status(200).type('application/javascript').send(dashboardClientScript());
  });

  router.get('/navigation', async (req, res) => {
    try {
      const navigation = await navigationService.resolve({ session: req.staffBrowserSession });
      return res.status(200).json({
        ...navigation,
        account: accountNavigationMetadata({
          viewer: req.staffBrowserSession?.accountPrincipal,
          passkeyEnabled: isStaffPasskeyAuthEnabled(env),
        }),
      });
    } catch (_error) {
      return res.status(403).json({ error: 'Workspace navigation is unavailable.' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const model = await dashboardService.buildModel({
        adminId: req.staffBrowserSession?.adminId,
        viewer: req.staffBrowserSession?.viewer,
        sessionPrincipal: req.staffBrowserSession?.accountPrincipal,
      });
      const dashboardHtml = renderDashboard(model, {
        staffAccessScriptPath: `${staffAccessPath}/client.js`,
        navigation: { calendarHref: dashboardCalendarHref(model) },
      });
      return res.status(200).type('html').send(
        stabilizeDashboardShell(decorateWorkspaceAppointmentLinks(dashboardHtml)),
      );
    } catch (error) {
      const safe = dashboardSafeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  router.post('/appointments/:appointmentId/finalize', sameOrigin, requireCsrf, async (req, res) => {
    try {
      const result = await dashboardService.finalizeVisit({
        adminId: req.staffBrowserSession?.adminId,
        viewer: req.staffBrowserSession?.viewer,
        sessionPrincipal: req.staffBrowserSession?.accountPrincipal,
        appointmentId: req.params.appointmentId,
        expectedRevision: req.body?.expectedRevision,
        outcome: req.body?.outcome,
        operationalDateKey: req.body?.operationalDateKey,
      });
      return res.status(200).json(result);
    } catch (error) {
      const safe = dashboardMutationError(error);
      return res.status(safe.status).json({ error: safe.message, code: safe.code, requestId: req.id });
    }
  });

  async function bookingRequestAction(req, res, action) {
    try {
      const result = await dashboardService.resolveBookingRequest({
        adminId: req.staffBrowserSession?.adminId,
        viewer: req.staffBrowserSession?.viewer,
        sessionPrincipal: req.staffBrowserSession?.accountPrincipal,
        appointmentId: req.params.appointmentId,
        action,
        expectedRevision: req.body?.expectedRevision,
        startsAt: req.body?.startsAt,
        staffId: req.body?.staffId,
        serviceId: req.body?.serviceId,
      });
      return res.status(200).json(result);
    } catch (error) {
      const safe = dashboardMutationError(error);
      return res.status(safe.status).json({ error: safe.message, code: safe.code, requestId: req.id });
    }
  }

  router.post('/booking-requests/:appointmentId/accept', sameOrigin, requireCsrf,
    (req, res) => bookingRequestAction(req, res, 'accept'));
  router.post('/booking-requests/:appointmentId/propose', sameOrigin, requireCsrf,
    (req, res) => bookingRequestAction(req, res, 'propose'));
  router.post('/booking-requests/:appointmentId/cannot_accommodate', sameOrigin, requireCsrf,
    (req, res) => bookingRequestAction(req, res, 'cannot_accommodate'));

  return router;
}

module.exports = {
  isWorkspaceOperationalEnabled,
  isStaffPasskeyAuthEnabled,
  isSharedReceptionViewer,
  accountNavigationMetadata,
  passkeyNavigationClientScript,
  receptionLockNavigationClientScript,
  setWorkspaceOperationalSecurityHeaders,
  stabilizeDashboardShell,
  dashboardCalendarHref,
  dashboardSafeError,
  dashboardMutationError,
  createWorkspaceOperationalRouter,
};