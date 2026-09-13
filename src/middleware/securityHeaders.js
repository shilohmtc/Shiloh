'use strict';

const DEFAULT_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
});

function requestIsHttps(req) {
  if (req?.secure === true) return true;
  const forwardedProtocol = String(
    req?.get?.('x-forwarded-proto') || req?.headers?.['x-forwarded-proto'] || '',
  )
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwardedProtocol === 'https';
}

function setHeaderIfAbsent(res, name, value) {
  if (res.getHeader(name) == null) res.setHeader(name, value);
}

function securityHeaders(req, res, next) {
  for (const [name, value] of Object.entries(DEFAULT_HEADERS)) {
    setHeaderIfAbsent(res, name, value);
  }

  if (requestIsHttps(req)) {
    setHeaderIfAbsent(res, 'Strict-Transport-Security', 'max-age=15552000');
  }

  return next();
}

module.exports = {
  DEFAULT_HEADERS,
  requestIsHttps,
  securityHeaders,
  setHeaderIfAbsent,
};
