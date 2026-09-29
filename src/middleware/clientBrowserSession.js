'use strict';

const {
  sameOriginGuard,
  requestFingerprintHash,
  parseCookieValue,
} = require('./staffBrowserSession');

function clientSessionCookieName(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
    ? '__Host-shiloh_client_session'
    : 'shiloh_client_session';
}

function clientAuthCookieName(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
    ? '__Host-shiloh_client_auth'
    : 'shiloh_client_auth';
}

function clientPasskeyAuthCookieName(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
    ? '__Host-shiloh_client_passkey_auth'
    : 'shiloh_client_passkey_auth';
}

function clientSmsAuthCookieName(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
    ? '__Host-shiloh_client_sms_auth'
    : 'shiloh_client_sms_auth';
}

function cookieParts(name, value, {
  env = process.env,
  maxAgeSeconds = 0,
  httpOnly = true,
} = {}) {
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const parts = [
    `${name}=${String(value || '')}`,
    'Path=/',
    `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`,
    'SameSite=Strict',
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (production) parts.push('Secure');
  return parts;
}

function serializeClientSessionCookie(token, {
  env = process.env,
  maxAgeSeconds = 7 * 24 * 60 * 60,
} = {}) {
  return cookieParts(clientSessionCookieName(env), token, { env, maxAgeSeconds }).join('; ');
}

function serializeExpiredClientSessionCookie({ env = process.env } = {}) {
  return [...cookieParts(clientSessionCookieName(env), '', { env, maxAgeSeconds: 0 }), 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'].join('; ');
}

function serializeExpiredClientAuthCookie({ env = process.env } = {}) {
  return [...cookieParts(clientAuthCookieName(env), '', { env, maxAgeSeconds: 0 }), 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'].join('; ');
}

function serializeClientSmsAuthCookie(token, { env = process.env, maxAgeSeconds = 10 * 60 } = {}) {
  return cookieParts(clientSmsAuthCookieName(env), token, { env, maxAgeSeconds }).join('; ');
}

function serializeExpiredClientSmsAuthCookie({ env = process.env } = {}) {
  return [...cookieParts(clientSmsAuthCookieName(env), '', { env, maxAgeSeconds: 0 }),
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'].join('; ');
}

function serializeClientPasskeyAuthCookie(token, { env = process.env, maxAgeSeconds = 5 * 60 } = {}) {
  return cookieParts(clientPasskeyAuthCookieName(env), token, { env, maxAgeSeconds }).join('; ');
}

function serializeExpiredClientPasskeyAuthCookie({ env = process.env } = {}) {
  return [...cookieParts(clientPasskeyAuthCookieName(env), '', { env, maxAgeSeconds: 0 }),
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'].join('; ');
}

function clientSessionTokenFromRequest(req, env = process.env) {
  return parseCookieValue(req.headers?.cookie, clientSessionCookieName(env));
}

function clientPasskeyAuthTokenFromRequest(req, env = process.env) {
  return parseCookieValue(req.headers?.cookie, clientPasskeyAuthCookieName(env));
}

function clientSmsAuthTokenFromRequest(req, env = process.env) {
  return parseCookieValue(req.headers?.cookie, clientSmsAuthCookieName(env));
}

function requireClientSession({ service, env = process.env } = {}) {
  if (!service) throw new Error('client browser session service is required');
  return async function requireMyShilohClientSession(req, res, next) {
    const session = await service.validateSessionToken(clientSessionTokenFromRequest(req, env));
    if (!session.ok) return res.status(401).json({ error: 'Unauthorized', requestId: req.id });
    req.myShilohClientSession = session;
    return next();
  };
}

function optionalClientSession({ service, env = process.env } = {}) {
  if (!service) throw new Error('client browser session service is required');
  return async function optionalMyShilohClientSession(req, _res, next) {
    const session = await service.validateSessionToken(clientSessionTokenFromRequest(req, env));
    if (session.ok) req.myShilohClientSession = session;
    return next();
  };
}

function clientCsrfGuard({ service } = {}) {
  if (!service) throw new Error('client browser session service is required');
  return function requireMyShilohClientCsrf(req, res, next) {
    const supplied = String(req.get?.('x-shiloh-csrf-token') || req.headers?.['x-shiloh-csrf-token'] || '');
    if (!service.validateCsrfToken(req.myShilohClientSession, supplied)) {
      return res.status(403).json({ error: 'Forbidden', requestId: req.id });
    }
    return next();
  };
}

module.exports = {
  sameOriginGuard,
  requestFingerprintHash,
  clientSessionCookieName,
  clientAuthCookieName,
  clientPasskeyAuthCookieName,
  clientSmsAuthCookieName,
  serializeClientSessionCookie,
  serializeExpiredClientSessionCookie,
  serializeExpiredClientAuthCookie,
  serializeClientSmsAuthCookie,
  serializeExpiredClientSmsAuthCookie,
  serializeClientPasskeyAuthCookie,
  serializeExpiredClientPasskeyAuthCookie,
  clientSessionTokenFromRequest,
  clientPasskeyAuthTokenFromRequest,
  clientSmsAuthTokenFromRequest,
  requireClientSession,
  optionalClientSession,
  clientCsrfGuard,
};
