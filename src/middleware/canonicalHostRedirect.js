'use strict';

const { APP_ORIGIN, PUBLIC_SITE_ORIGIN } = require('../config/publicOrigins');

const LEGACY_RENDER_HOST = 'shiloh-whatsapp-bot.onrender.com';
const APP_HOST = 'app.shilohmtc.co.za';
const LEGACY_PASSTHROUGH_PATHS = new Set(['/health', '/webhook']);
const PUBLIC_WEBSITE_PATHS = new Set([
  '/',
  '/about',
  '/book',
  '/contact',
  '/privacy',
  '/treatments',
  '/visit',
]);

function requestHostname(req) {
  const forwarded = String(req.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwarded || String(req.headers?.host || '');
  return host.toLowerCase().replace(/:\d+$/, '');
}

function canonicalHostRedirect(req, res, next) {
  const hostname = requestHostname(req);
  const method = String(req.method || 'GET').toUpperCase();
  const publicPath = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;

  if (hostname === APP_HOST) {
    if (!['GET', 'HEAD'].includes(method)) return next();
    if (!PUBLIC_WEBSITE_PATHS.has(publicPath)) return next();
    return res.redirect(308, `${PUBLIC_SITE_ORIGIN}${req.originalUrl || req.url || '/'}`);
  }

  if (hostname !== LEGACY_RENDER_HOST) return next();
  if (LEGACY_PASSTHROUGH_PATHS.has(req.path)) return next();

  return res.redirect(308, `${PUBLIC_SITE_ORIGIN}${req.originalUrl || req.url || '/'}`);
}

module.exports = {
  APP_HOST,
  APP_ORIGIN,
  LEGACY_RENDER_HOST,
  PUBLIC_SITE_ORIGIN,
  PUBLIC_WEBSITE_PATHS,
  canonicalHostRedirect,
  requestHostname,
};
