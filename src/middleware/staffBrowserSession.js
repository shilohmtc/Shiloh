const crypto = require('crypto');
const CALENDAR_VIEWER_CONTEXT = Symbol.for('shiloh.calendar.server.viewer');

function cookieName(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
    ? '__Host-shiloh_staff_session'
    : 'shiloh_staff_session';
}

function cookieSecurity(env = process.env) {
  return {
    httpOnly: true,
    secure: String(env.NODE_ENV || '').toLowerCase() === 'production',
    sameSite: 'Strict',
    path: '/',
  };
}

function serializeSessionCookie(token, { env = process.env, maxAgeSeconds = 8 * 60 * 60 } = {}) {
  const security = cookieSecurity(env);
  const parts = [
    `${cookieName(env)}=${String(token || '')}`,
    `Path=${security.path}`,
    'HttpOnly',
    `SameSite=${security.sameSite}`,
    `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`,
  ];
  if (security.secure) parts.push('Secure');
  return parts.join('; ');
}

function serializeExpiredSessionCookie({ env = process.env } = {}) {
  const security = cookieSecurity(env);
  const parts = [
    `${cookieName(env)}=`,
    `Path=${security.path}`,
    'HttpOnly',
    `SameSite=${security.sameSite}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (security.secure) parts.push('Secure');
  return parts.join('; ');
}

function parseCookieValue(header, name) {
  const matches = [];
  for (const piece of String(header || '').split(';')) {
    const index = piece.indexOf('=');
    if (index < 0) continue;
    const key = piece.slice(0, index).trim();
    if (key === name) matches.push(piece.slice(index + 1).trim());
  }
  return matches.length === 1 ? matches[0] : null;
}

function forwardedValue(req, headerName) {
  const value = req.get?.(headerName) || req.headers?.[headerName.toLowerCase()];
  return String(value || '').split(',')[0].trim();
}

function expectedOrigin(req) {
  const forwardedProto = forwardedValue(req, 'x-forwarded-proto');
  const proto = forwardedProto || req.protocol || 'http';
  const forwardedHost = forwardedValue(req, 'x-forwarded-host');
  const host = forwardedHost || req.get?.('host') || req.headers?.host;
  if (!host) return null;
  return `${proto}://${host}`;
}

function sameOriginGuard({ env = process.env, form = false } = {}) {
  return function staffAuthSameOriginGuard(req, res, next) {
    const origin = String(req.get?.('origin') || req.headers?.origin || '').trim();
    const expected = expectedOrigin(req);
    if (!origin || !expected) return res.status(403).json({ error: 'Forbidden', requestId: req.id });
    let actualOrigin;
    try { actualOrigin = new URL(origin).origin; } catch (_) { return res.status(403).json({ error: 'Forbidden', requestId: req.id }); }
    if (actualOrigin !== expected) return res.status(403).json({ error: 'Forbidden', requestId: req.id });
    if (String(env.NODE_ENV || '').toLowerCase() === 'production' && !expected.startsWith('https://')) {
      return res.status(403).json({ error: 'Forbidden', requestId: req.id });
    }
    const fetchSite = String(req.get?.('sec-fetch-site') || req.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
    if (fetchSite && fetchSite !== 'same-origin') return res.status(403).json({ error: 'Forbidden', requestId: req.id });
    const contentType = String(req.get?.('content-type') || req.headers?.['content-type'] || '').toLowerCase();
    if (form) {
      if (contentType.split(';', 1)[0].trim() !== 'application/x-www-form-urlencoded') return res.sendStatus(415);
      return next();
    }
    if (!contentType.startsWith('application/json')) return res.status(415).json({ error: 'JSON required', requestId: req.id });
    return next();
  };
}

function requestFingerprintHash(req) {
  const userAgent = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '').slice(0, 500);
  const address = String(req.ip || req.socket?.remoteAddress || '').slice(0, 120);
  const language = String(req.get?.('accept-language') || req.headers?.['accept-language'] || '').slice(0, 120);
  if (!userAgent && !address && !language) return null;
  return crypto.createHash('sha256').update(`${userAgent}\n${address}\n${language}`).digest('hex');
}

function isCalendarBridgeEnabled(env = process.env) {
  return String(env.SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function createOptionalCalendarSessionMiddleware({ service, env = process.env } = {}) {
  if (!service) throw new Error('staff browser session service is required');
  return async function optionalCalendarSession(req, res, next) {
    if (!isCalendarBridgeEnabled(env)) return next();
    const token = parseCookieValue(req.headers?.cookie, cookieName(env));
    const session = await service.validateSessionToken(token);
    if (session.ok && session.viewer) {
      req.staffBrowserSession = session;
      req[CALENDAR_VIEWER_CONTEXT] = {
        authenticated: true,
        source: 'server_staff_session',
        viewer: session.viewer,
      };
    }
    return next();
  };
}

function isHumanBrowserNavigation(req) {
  if (String(req?.method || '').toUpperCase() !== 'GET') return false;
  const fetchMode = String(req.get?.('sec-fetch-mode') || req.headers?.['sec-fetch-mode'] || '').trim().toLowerCase();
  if (fetchMode) return fetchMode === 'navigate';
  const fetchDest = String(req.get?.('sec-fetch-dest') || req.headers?.['sec-fetch-dest'] || '').trim().toLowerCase();
  if (fetchDest) return fetchDest === 'document';
  const accept = String(req.get?.('accept') || req.headers?.accept || '').toLowerCase();
  return accept.includes('text/html') && !accept.includes('application/json');
}

function requireStaffSession({ service, env = process.env, allowRecoveryRequired = false, humanNavigationSigninPath = null } = {}) {
  if (!service) throw new Error('staff browser session service is required');
  return async function requireStaffBrowserSession(req, res, next) {
    const token = parseCookieValue(req.headers?.cookie, cookieName(env));
    const session = await service.validateSessionToken(token);
    if (!session.ok || (session.recoveryRequired === true && !allowRecoveryRequired)) {
      if (humanNavigationSigninPath && isHumanBrowserNavigation(req)) {
        const separator = String(humanNavigationSigninPath).includes('?') ? '&' : '?';
        return res.redirect(302, `${humanNavigationSigninPath}${separator}reason=session`);
      }
      return res.status(401).json({ error: 'Unauthorized', requestId: req.id });
    }
    req.staffBrowserSession = session;
    return next();
  };
}

function csrfGuard({ service } = {}) {
  if (!service) throw new Error('staff browser session service is required');
  return function requireStaffCsrf(req, res, next) {
    const supplied = String(req.get?.('x-shiloh-csrf-token') || req.headers?.['x-shiloh-csrf-token'] || '');
    if (!service.validateCsrfToken(req.staffBrowserSession, supplied)) {
      return res.status(403).json({ error: 'Forbidden', requestId: req.id });
    }
    return next();
  };
}

module.exports = {
  cookieName,
  cookieSecurity,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
  parseCookieValue,
  expectedOrigin,
  sameOriginGuard,
  requestFingerprintHash,
  isCalendarBridgeEnabled,
  createOptionalCalendarSessionMiddleware,
  isHumanBrowserNavigation,
  requireStaffSession,
  csrfGuard,
};
