'use strict';

const express = require('express');
const { pool } = require('../db/pool');
const staffWhatsAppPasskeyBootstrap = require('../services/staffWhatsAppPasskeyBootstrap');
const { bootstrapPage, bootstrapScript } = require('../presentation/staffPasskeyBootstrapUx');
const {
  sameOriginGuard,
  requestFingerprintHash,
  serializeSessionCookie,
} = require('../middleware/staffBrowserSession');
const { serializePasskeyHintCookie } = require('./staffPasskeyAuth');

function createStaffPasskeyBootstrapRouter({
  env = process.env,
  bootstrapService = staffWhatsAppPasskeyBootstrap,
} = {}) {
  if (!bootstrapService || typeof bootstrapService.startRegistration !== 'function') throw new Error('staff passkey bootstrap service is required');
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });

  function noStore(res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  function secure(res) {
    noStore(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  }
  function sendError(res, result) {
    noStore(res);
    if (result?.code === 'STAFF_PASSKEY_BOOTSTRAP_DISABLED') return res.status(404).json({ error: 'Not Found', requestId: res.req?.id });
    if (result?.code === 'STAFF_PASSKEY_BOOTSTRAP_UNAVAILABLE') return res.status(503).json({ error: 'Secure setup is temporarily unavailable', requestId: res.req?.id });
    return res.status(401).json({ error: 'This setup link is invalid, expired, already used, or no longer authorized', requestId: res.req?.id });
  }

  router.get('/bootstrap', (req, res) => {
    const policy = bootstrapService.policy();
    if (!policy.enabled) return res.sendStatus(404);
    if (!policy.operational) return res.sendStatus(503);
    secure(res);
    return res.status(200).type('html').send(bootstrapPage());
  });

  router.get('/bootstrap.js', (req, res) => {
    const policy = bootstrapService.policy();
    if (!policy.enabled) return res.sendStatus(404);
    if (!policy.operational) return res.sendStatus(503);
    secure(res);
    return res.status(200).type('application/javascript').send(bootstrapScript());
  });

  router.post('/bootstrap/start', sameOrigin, async (req, res, next) => {
    try {
      const result = await bootstrapService.startRegistration({
        token: req.body?.token,
        mode: req.body?.mode,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return sendError(res, result);
      noStore(res);
      return res.status(200).json({ options: result.options, expiresAt: result.expiresAt, displayName: result.displayName, mode: result.mode });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/bootstrap/finish', sameOrigin, async (req, res, next) => {
    try {
      const result = await bootstrapService.finishRegistration({
        response: req.body?.response,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return sendError(res, result);
      noStore(res);
      const cookies = [
        serializeSessionCookie(result.sessionToken, {
          env,
          maxAgeSeconds: Math.max(1, Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000)),
        }),
        serializePasskeyHintCookie(result.credentialHint, { env }),
      ];
      res.setHeader('Set-Cookie', cookies);
      return res.status(201).json({
        authenticated: true,
        csrfToken: result.csrfToken,
        viewer: result.viewer || null,
        recoveryRequired: false,
        mode: result.mode,
        revokedCredentialCount: result.revokedCredentialCount || 0,
        revokedSessionCount: result.revokedSessionCount || 0,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createStaffPasskeyBootstrapRouter };
