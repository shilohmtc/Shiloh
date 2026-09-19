'use strict';

const path = require('path');
const express = require('express');
const { pool } = require('../db/pool');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { resolveWhatsAppNumber } = require('../services/publicWhatsApp');
const { createClientBrowserSessionService, SESSION_TTL_MS, CHALLENGE_TTL_MS } = require('../services/clientBrowserSession');
const { createMyShilohExperienceOrchestrator } = require('../services/myShilohExperienceOrchestrator');
const { createMyShilohAssistantService, MyShilohAssistantError } = require('../services/myShilohAssistant');
const { renderMyShilohPage } = require('../presentation/myShilohPwa');
const {
  sameOriginGuard,
  requestFingerprintHash,
  serializeClientSessionCookie,
  serializeExpiredClientSessionCookie,
  serializeClientAuthCookie,
  serializeExpiredClientAuthCookie,
  clientAuthTokenFromRequest,
  requireClientSession,
  optionalClientSession,
  clientCsrfGuard,
} = require('../middleware/clientBrowserSession');

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

function setNoStoreJson(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

function defaultAuthUrlBuilder(number, token) {
  const digits = String(number || '').replace(/[^0-9]/g, '');
  if (!digits || !/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return null;
  const message = `MY SHILOH SIGN IN ${token}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function createMyShilohRouter({
  env = process.env,
  sessionService = createClientBrowserSessionService({ db: pool }),
  whatsappResolver = resolveWhatsAppNumber,
  catalogueProvider = getPublicServiceCatalogue,
  authUrlBuilder = defaultAuthUrlBuilder,
  experienceService = createMyShilohExperienceOrchestrator(),
  assistantService = createMyShilohAssistantService(),
} = {}) {
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });
  const requireSession = requireClientSession({ service: sessionService, env });
  const optionalSession = optionalClientSession({ service: sessionService, env });
  const requireCsrf = clientCsrfGuard({ service: sessionService });

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

  router.post('/my-shiloh/auth/start', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const number = await whatsappResolver();
      if (!number) return res.status(503).json({ error: 'WhatsApp sign-in is temporarily unavailable', requestId: req.id });
      const challenge = await sessionService.beginChallenge({
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!challenge.ok && challenge.code === 'CLIENT_AUTH_RATE_LIMITED') {
        return res.status(429).json({ error: 'Please wait a moment before trying again', requestId: req.id });
      }
      if (!challenge.ok) return res.status(503).json({ error: 'Secure sign-in is temporarily unavailable', requestId: req.id });
      const whatsappUrl = authUrlBuilder(number, challenge.whatsappToken);
      if (!whatsappUrl) return res.status(503).json({ error: 'WhatsApp sign-in is temporarily unavailable', requestId: req.id });
      res.setHeader('Set-Cookie', serializeClientAuthCookie(challenge.browserToken, {
        env,
        maxAgeSeconds: Math.max(1, Math.floor(CHALLENGE_TTL_MS / 1000)),
      }));
      return res.status(201).json({
        status: 'waiting_for_whatsapp',
        whatsappUrl,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/my-shiloh/auth/complete', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const browserToken = clientAuthTokenFromRequest(req, env);
      if (!browserToken) return res.status(401).json({ error: 'Start sign-in from this My Shiloh first', requestId: req.id });
      const result = await sessionService.completeChallenge({
        browserToken,
        completionCode: req.body?.code,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        if (['CLIENT_AUTH_EXPIRED', 'CLIENT_AUTH_INVALID_CHALLENGE'].includes(result.code)) {
          res.setHeader('Set-Cookie', serializeExpiredClientAuthCookie({ env }));
        }
        const status = result.code === 'CLIENT_AUTH_NOT_VERIFIED' ? 409 : 401;
        return res.status(status).json({
          error: result.code === 'CLIENT_AUTH_NOT_VERIFIED'
            ? 'Verify this sign-in in WhatsApp first'
            : 'That one-time sign-in code is not valid',
          requestId: req.id,
        });
      }
      const sessionSeconds = Math.max(
        1,
        Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000),
      );
      res.setHeader('Set-Cookie', [
        serializeClientSessionCookie(result.sessionToken, {
          env,
          maxAgeSeconds: Math.min(sessionSeconds, Math.floor(SESSION_TTL_MS / 1000)),
        }),
        serializeExpiredClientAuthCookie({ env }),
      ]);
      return res.status(200).json({
        authenticated: true,
        client: { firstName: result.client.firstName },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/my-shiloh/auth/session', requireSession, (req, res) => {
    setNoStoreJson(res);
    return res.status(200).json({
      authenticated: true,
      client: {
        name: req.myShilohClientSession.client.name,
        firstName: req.myShilohClientSession.client.firstName,
      },
    });
  });

  router.post('/my-shiloh/auth/csrf', sameOrigin, requireSession, async (req, res, next) => {
    try {
      const rotated = await sessionService.rotateCsrfToken(req.myShilohClientSession.sessionId);
      setNoStoreJson(res);
      if (!rotated.ok) return res.status(401).json({ error: 'Unauthorized', requestId: req.id });
      return res.status(200).json({ csrfToken: rotated.csrfToken });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/my-shiloh/auth/logout', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      await sessionService.revokeSession(req.myShilohClientSession.sessionId, 'logout');
      await assistantService.clearConversation({
        sessionId: req.myShilohClientSession.sessionId,
      });
      setNoStoreJson(res);
      res.setHeader('Set-Cookie', [
        serializeExpiredClientSessionCookie({ env }),
        serializeExpiredClientAuthCookie({ env }),
      ]);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/my-shiloh/api/experience', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const experience = await experienceService.getExperience({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      });
      if (!experience) {
        return res.status(404).json({ error: 'Client profile unavailable', requestId: req.id });
      }
      return res.status(200).json(experience);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/my-shiloh/api/shiloh/message', sameOrigin, requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const extraFields = Object.keys(req.body && typeof req.body === 'object' ? req.body : {})
        .filter((key) => key !== 'message');
      if (extraFields.length) {
        return res.status(422).json({ error: 'Please reload My Shiloh and try again', requestId: req.id });
      }
      const result = await assistantService.reply({
        sessionId: req.myShilohClientSession.sessionId,
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        message: req.body?.message,
      });
      return res.status(200).json({
        reply: result.reply,
        contextVersion: result.contextVersion,
      });
    } catch (error) {
      if (error instanceof MyShilohAssistantError) {
        return res.status(error.httpStatus || 400).json({
          error: error.message,
          code: error.code,
          requestId: req.id,
        });
      }
      return next(error);
    }
  });

  router.get('/my-shiloh/health', async (_req, res) => {
    const [number, catalogue] = await Promise.all([
      whatsappResolver(),
      catalogueProvider(),
    ]);
    const ready = Boolean(number && catalogue);
    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      whatsappConfigured: Boolean(number),
      catalogueAvailable: Boolean(catalogue),
      activeServiceCount: catalogue?.length || 0,
      clientSessionEnabled: true,
    });
  });

  router.get(['/my-shiloh', '/my-shiloh/'], optionalSession, async (req, res) => {
    setMyShilohPageHeaders(res);
    const [whatsappNumber, catalogue] = await Promise.all([
      whatsappResolver(),
      catalogueProvider(),
    ]);
    return res.status(200).type('html').send(renderMyShilohPage({
      whatsappNumber,
      catalogue: catalogue || [],
      client: req.myShilohClientSession?.client || null,
    }));
  });

  return router;
}

const router = createMyShilohRouter();

module.exports = {
  router,
  createMyShilohRouter,
  setMyShilohPageHeaders,
  setNoStoreJson,
  defaultAuthUrlBuilder,
};
