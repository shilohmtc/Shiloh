'use strict';

const express = require('express');
const path = require('path');
const PWA_ICON_ASSET_DIR = path.join(__dirname, '../../public/assets/pwa');
const { createOptionalCalendarSessionMiddleware } = require('../middleware/staffBrowserSession');
const {
  PWA_BASE,
  workspacePwaManifest,
  workspacePwaIconSvg,
  decorateWorkspacePwaHtml,
  augmentWorkspacePwaCsp,
  workspacePwaServiceWorkerScript,
  workspacePwaClientScript,
} = require('../presentation/workspacePwa');

const IOS_APPLE_TOUCH_ICON_HREF = `${PWA_BASE}/apple-touch-icon-180.png?v=ios-optical-v2`;
const LEGACY_APPLE_TOUCH_ICON_PATTERN = /<link rel="apple-touch-icon" sizes="192x192" href="[^"]+">/;

const HTML_PATH_PREFIXES = Object.freeze([
  '/staff',
  '/staff-auth',
  '/workspace',
  '/clients',
  '/messages',
  '/team',
  '/services',
  '/reports',
  '/clinic-hours',
  '/read-only',
  '/book',
  '/operations',
]);

function setPublicAssetHeaders(res, { immutable = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', immutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache, max-age=0, must-revalidate');
}

function sendPwaPng(res, filename) {
  setPublicAssetHeaders(res, { immutable: true });
  res.type('image/png');
  return res.sendFile(path.join(PWA_ICON_ASSET_DIR, filename));
}

function preferIosAppleTouchIcon(html) {
  return String(html || '').replace(
    LEGACY_APPLE_TOUCH_ICON_PATTERN,
    `<link rel="apple-touch-icon" sizes="180x180" href="${IOS_APPLE_TOUCH_ICON_HREF}">`,
  );
}

function shouldDecoratePwaHtmlPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  return HTML_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

function isMobilePwaRequest(req) {
  const userAgent = String(req?.get?.('user-agent') || req?.headers?.['user-agent'] || '');
  const clientHint = String(req?.get?.('sec-ch-ua-mobile') || req?.headers?.['sec-ch-ua-mobile'] || '');
  return clientHint === '?1' || /Android|iPhone|iPad|iPod|Mobile\//i.test(userAgent);
}

function createWorkspacePwaHtmlMiddleware() {
  return function workspacePwaHtmlMiddleware(req, res, next) {
    if (req.method !== 'GET' || !shouldDecoratePwaHtmlPath(req.path || req.url) || !isMobilePwaRequest(req)) return next();
    const originalSend = res.send.bind(res);
    res.send = function pwaAwareSend(body) {
      const type = String(res.getHeader('Content-Type') || '').toLowerCase();
      if (typeof body === 'string' && type.includes('text/html')) {
        body = preferIosAppleTouchIcon(decorateWorkspacePwaHtml(body));
        const csp = res.getHeader('Content-Security-Policy');
        if (csp) res.setHeader('Content-Security-Policy', augmentWorkspacePwaCsp(csp));
      }
      return originalSend(body);
    };
    return next();
  };
}

function pwaLaunchDestination(session) {
  if (!session?.ok) return '/calendar/staff?reason=session';
  if (session.recoveryRequired === true) return '/calendar/staff?reason=session';
  if (!session.viewer) return '/calendar/staff?reason=access';
  return '/calendar/workspace';
}

function createWorkspacePwaRouter({ sessionService, env = process.env } = {}) {
  if (!sessionService) throw new Error('Workspace PWA requires the existing staff browser session service');
  const router = express.Router();
  const optionalSession = createOptionalCalendarSessionMiddleware({ service: sessionService, env });

  router.get('/manifest.webmanifest', (_req, res) => {
    setPublicAssetHeaders(res);
    return res.status(200).type('application/manifest+json').send(JSON.stringify(workspacePwaManifest()));
  });

  router.get('/sw.js', (_req, res) => {
    setPublicAssetHeaders(res);
    res.setHeader('Service-Worker-Allowed', '/calendar/');
    return res.status(200).type('application/javascript').send(workspacePwaServiceWorkerScript());
  });

  router.get('/client.js', (_req, res) => {
    setPublicAssetHeaders(res);
    return res.status(200).type('application/javascript').send(workspacePwaClientScript());
  });

  router.get('/apple-touch-icon-180.png', (_req, res) => sendPwaPng(res, 'shiloh-apple-touch-180.png'));

  router.get('/icon-192.png', (_req, res) => sendPwaPng(res, 'shiloh-pwa-192.png'));

  router.get('/icon-512.png', (_req, res) => sendPwaPng(res, 'shiloh-pwa-512.png'));

  router.get('/icon-maskable-512.png', (_req, res) => sendPwaPng(res, 'shiloh-pwa-maskable-512.png'));

  router.get('/icon-192.svg', (_req, res) => {
    setPublicAssetHeaders(res, { immutable: true });
    return res.status(200).type('image/svg+xml').send(workspacePwaIconSvg(192));
  });

  router.get('/icon-512.svg', (_req, res) => {
    setPublicAssetHeaders(res, { immutable: true });
    return res.status(200).type('image/svg+xml').send(workspacePwaIconSvg(512));
  });

  router.get('/launch', optionalSession, (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, pwaLaunchDestination(req.staffBrowserSession || null));
  });

  return router;
}

module.exports = {
  PWA_BASE,
  IOS_APPLE_TOUCH_ICON_HREF,
  HTML_PATH_PREFIXES,
  setPublicAssetHeaders,
  preferIosAppleTouchIcon,
  shouldDecoratePwaHtmlPath,
  isMobilePwaRequest,
  createWorkspacePwaHtmlMiddleware,
  pwaLaunchDestination,
  createWorkspacePwaRouter,
};
