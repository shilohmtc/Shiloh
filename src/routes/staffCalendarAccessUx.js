const express = require('express');
const {
  renderStaffCalendarAccessPage,
  workspaceWhatsAppSigninPanel,
  staffCalendarAccessClientScript,
} = require('../presentation/staffCalendarAccessUx');
const {
  renderStaffCalendarHandoffPage,
  staffCalendarHandoffClientScript,
} = require('../presentation/staffCalendarHandoffUx');
const { passkeyPolicy } = require('../services/staffPasskeyAuth');
const { staffDetailAuthEnabled } = require('../services/staffDetailIdentity');
const detailUx = require('../presentation/staffDetailSigninUx');
const { signinPanel, signinScript } = require('../presentation/staffPasskeyUx');

function isStaffCalendarAccessUxEnabled(env = process.env) {
  const calendarEnabled = String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true';
  const bridgeEnabled = String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
  return calendarEnabled && bridgeEnabled;
}

function setAccessSecurityHeaders(res, { allowSameOriginImages = false } = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  const imagePolicy = allowSameOriginImages ? "; img-src 'self'" : '';
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" + imagePolicy);
}

function normalizeReason(value) {
  const reason = String(value || '').trim().toLowerCase();
  return ['logout', 'session', 'access'].includes(reason) ? reason : null;
}

function withPasskeyReentry(html) {
  const fallbackMarker = '<section class="section" data-shiloh-whatsapp-handoff-guidance>';
  const panel = `${signinPanel()}<script src="/calendar/staff/passkey-signin.js" defer></script>`;
  if (String(html || '').includes(fallbackMarker)) return String(html).replace(fallbackMarker, `${panel}${fallbackMarker}`);
  return html;
}

// Compatibility seam for #804 callers. #829 deliberately removes the normal-page
// first-device explanatory card; administrator-approved SMS handles recovery.
function withWhatsAppBootstrapGuidance(html) {
  return String(html || '');
}

function retireBrowserWhatsAppGuidance(html) {
  let output = String(html || '');
  output = output.replace(/\s*<section class="section" data-shiloh-whatsapp-handoff-guidance>[\s\S]*?<\/section>\s*/, '\n');
  output = output.replace(/\s*<p class="footer-note">Workspace access and actions remain governed by canonical server-derived staff\/Admin permissions and scope\.<\/p>\s*/, '\n');
  output = output.replace('>Use your saved Shiloh passkey to continue.</div>', '></div>');
  output = output.replace('>Your staff session is missing, expired, or revoked. Sign in again to continue.</div>', '></div>');
  if (!output.includes('[data-shiloh-status]:empty{display:none}')) {
    output = output.replace('<style>', '<style>[data-shiloh-status]:empty{display:none}[data-shiloh-passkey-status]:empty{display:none}');
  }
  return output;
}

function withAccessChangedGuidance(html, reason) {
  if (reason !== 'access') return html;
  return String(html).replace('data-state="ready"></div>', 'data-state="session-ended">Your Shiloh Workspace access changed or no longer permits Workspace. Sign in again, or ask an authorized administrator if access should be restored.</div>');
}

function bootstrapAwareSigninScript(env = process.env) {
  if (!staffDetailAuthEnabled(env)) return signinScript();
  return signinScript().replaceAll('Use existing passkey', 'Use a saved passkey')
    .replace(/var unlinked='[^']*';/, "var unlinked='Use your recorded staff details to open Workspace. Saved passkeys remain available for protected administrator changes.';")
    .replace('This browser is not linked yet. If this phone already has a Shiloh passkey, tap Use a saved passkey. If that does not work, use one fresh private setup link from Shiloh.', 'Use your details above to open Workspace. If you have a saved administrator passkey, you can use it for protected changes.')
    .replace('This browser cannot use Shiloh device sign-in. Open Shiloh in Safari or Chrome. If you are signed in on another device, create a fresh setup link from Workspace → Devices & sign-in.', 'This browser cannot use passkeys. Use your staff details above to open Workspace.')
    .replace('No usable Shiloh passkey was found in this browser. Use one fresh private setup link from Shiloh to link this browser.', 'No usable Shiloh passkey was found. Use your staff details to open Workspace, or ask an authorized administrator to make protected changes.')
    .replace('Device sign-in could not be verified. Try again. If this app was reinstalled, create a fresh setup link from another signed-in device.', 'Passkey sign-in could not be verified. Try again, or use your staff details above.');
}

function createStaffCalendarAccessPageHandler({ env = process.env, renderPage = renderStaffCalendarAccessPage, whatsappAvailable = () => false } = {}) {
  return function staffCalendarAccessPage(req, res) {
    const enabled = isStaffCalendarAccessUxEnabled(env);
    setAccessSecurityHeaders(res, { allowSameOriginImages: enabled });
    if (!enabled) return res.status(404).type('text/plain').send('Not Found');
    const basePath = req.baseUrl || '/calendar/staff';
    const passkeyEnabled = passkeyPolicy(env).operational;
    const reason = normalizeReason(req.query?.reason);
    let html = renderPage({ reason, clientScriptPath: `${basePath}/client.js`, providerIndependentAuthEnabled: false });
    if (passkeyEnabled) html = withPasskeyReentry(html);
    if (staffDetailAuthEnabled(env)) {
      html = html.replace('<main class="card">', `<main class="card">${detailUx.signinPanel()}<script src="/calendar/staff-auth/details/signin.js" defer></script>`);
      html = html.replace('Continue with device sign-in', 'Use a saved passkey').replace('Use existing passkey', 'Use a saved passkey');
    }
    html = retireBrowserWhatsAppGuidance(html);
    html = withAccessChangedGuidance(html, reason);
    // Read the live channel state per request; expiry and failed readiness must
    // not leave a sign-in link pointing to a closed pilot. Never start it here.
    let showWhatsApp = false;
    try { showWhatsApp = whatsappAvailable() === true; } catch (_) { /* Preserve existing sign-in. */ }
    if (showWhatsApp) html = html.replace('<main class="card">', `<main class="card">${workspaceWhatsAppSigninPanel()}`);
    return res.status(200).type('html').send(html);
  };
}

function createStaffCalendarEmergencyPageHandler({ env = process.env } = {}) {
  return function staffCalendarEmergencyPage(req, res) {
    setAccessSecurityHeaders(res);
    if (!isStaffCalendarAccessUxEnabled(env)) {
      return res.status(404).type('text/plain').send('Not Found');
    }
    res.setHeader('Location', '/calendar/staff');
    return res.status(302).type('text/plain').send('Found');
  };
}

function createStaffCalendarAccessClientHandler({ env = process.env, renderClient = staffCalendarAccessClientScript } = {}) {
  return function staffCalendarAccessClient(_req, res) {
    setAccessSecurityHeaders(res);
    if (!isStaffCalendarAccessUxEnabled(env)) return res.status(404).type('text/plain').send('Not Found');
    return res.status(200).type('application/javascript').send(renderClient());
  };
}
function createStaffPasskeySigninClientHandler({ env = process.env } = {}) {
  return function staffPasskeySigninClient(_req, res) {
    setAccessSecurityHeaders(res);
    if (!isStaffCalendarAccessUxEnabled(env) || !passkeyPolicy(env).operational) return res.status(404).type('text/plain').send('Not Found');
    return res.status(200).type('application/javascript').send(bootstrapAwareSigninScript(env));
  };
}
function createStaffCalendarHandoffPageHandler({ env = process.env, renderPage = renderStaffCalendarHandoffPage } = {}) {
  return function staffCalendarHandoffPage(_req, res) {
    setAccessSecurityHeaders(res);
    if (!isStaffCalendarAccessUxEnabled(env)) return res.status(404).type('text/plain').send('Not Found');
    return res.status(200).type('html').send(renderPage());
  };
}
function createStaffCalendarHandoffClientHandler({ env = process.env, renderClient = staffCalendarHandoffClientScript } = {}) {
  return function staffCalendarHandoffClient(_req, res) {
    setAccessSecurityHeaders(res);
    if (!isStaffCalendarAccessUxEnabled(env)) return res.status(404).type('text/plain').send('Not Found');
    return res.status(200).type('application/javascript').send(renderClient());
  };
}
function createStaffCalendarAccessRouter(options = {}) {
  const router = express.Router();
  router.get('/', createStaffCalendarAccessPageHandler(options));
  router.get('/emergency', createStaffCalendarEmergencyPageHandler(options));
  router.get('/client.js', createStaffCalendarAccessClientHandler(options));
  router.get('/passkey-signin.js', createStaffPasskeySigninClientHandler(options));
  router.get('/handoff', createStaffCalendarHandoffPageHandler(options));
  router.get('/handoff.js', createStaffCalendarHandoffClientHandler(options));
  return router;
}
module.exports = createStaffCalendarAccessRouter();
module.exports.createStaffCalendarAccessRouter = createStaffCalendarAccessRouter;
module.exports.createStaffCalendarAccessPageHandler = createStaffCalendarAccessPageHandler;
module.exports.createStaffCalendarEmergencyPageHandler = createStaffCalendarEmergencyPageHandler;
module.exports.createStaffCalendarAccessClientHandler = createStaffCalendarAccessClientHandler;
module.exports.createStaffPasskeySigninClientHandler = createStaffPasskeySigninClientHandler;
module.exports.createStaffCalendarHandoffPageHandler = createStaffCalendarHandoffPageHandler;
module.exports.createStaffCalendarHandoffClientHandler = createStaffCalendarHandoffClientHandler;
module.exports.isStaffCalendarAccessUxEnabled = isStaffCalendarAccessUxEnabled;
module.exports.setAccessSecurityHeaders = setAccessSecurityHeaders;
module.exports.normalizeReason = normalizeReason;
module.exports.withPasskeyReentry = withPasskeyReentry;
module.exports.withWhatsAppBootstrapGuidance = withWhatsAppBootstrapGuidance;
module.exports.bootstrapAwareSigninScript = bootstrapAwareSigninScript;
module.exports.retireBrowserWhatsAppGuidance = retireBrowserWhatsAppGuidance;
module.exports.withAccessChangedGuidance = withAccessChangedGuidance;
