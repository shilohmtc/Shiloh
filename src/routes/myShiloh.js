'use strict';

const path = require('path');
const express = require('express');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { resolveWhatsAppNumber } = require('../services/publicWhatsApp');
const { renderMyShilohPage } = require('../presentation/myShilohPwa');

const router = express.Router();
const ROOT = path.join(__dirname, '..', '..', 'public', 'my-shiloh');

function setMyShilohPageHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

router.use('/my-shiloh/assets', express.static(path.join(ROOT, 'assets'), {
  maxAge: '1h',
  immutable: false,
  fallthrough: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

router.get('/my-shiloh/manifest.webmanifest', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.type('application/manifest+json').sendFile(path.join(ROOT, 'manifest.webmanifest'));
});

router.get('/my-shiloh/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/my-shiloh/');
  return res.type('application/javascript').sendFile(path.join(ROOT, 'sw.js'));
});

router.get('/my-shiloh/offline.html', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).type('html').sendFile(path.join(ROOT, 'offline.html'));
});

router.get('/my-shiloh/health', async (_req, res) => {
  const [number, catalogue] = await Promise.all([
    resolveWhatsAppNumber(),
    getPublicServiceCatalogue(),
  ]);
  const ready = Boolean(number && catalogue);
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    whatsappConfigured: Boolean(number),
    catalogueAvailable: Boolean(catalogue),
    activeServiceCount: catalogue?.length || 0,
    clientSessionEnabled: false,
  });
});

router.get(['/my-shiloh', '/my-shiloh/'], async (_req, res) => {
  setMyShilohPageHeaders(res);
  const [whatsappNumber, catalogue] = await Promise.all([
    resolveWhatsAppNumber(),
    getPublicServiceCatalogue(),
  ]);
  return res.status(200).type('html').send(renderMyShilohPage({
    whatsappNumber,
    catalogue: catalogue || [],
  }));
});

module.exports = {
  router,
  setMyShilohPageHeaders,
};
