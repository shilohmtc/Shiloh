'use strict';

const path = require('path');
const express = require('express');
const { pool } = require('../db/pool');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { resolveWhatsAppNumber } = require('../services/publicWhatsApp');
const { createClientBrowserSessionService, SESSION_TTL_MS, CHALLENGE_TTL_MS } = require('../services/clientBrowserSession');
const { createMyShilohExperienceOrchestrator } = require('../services/myShilohExperienceOrchestrator');
const { createMyShilohAssistantService, MyShilohAssistantError } = require('../services/myShilohAssistant');
const { createMyShilohClientActionService } = require('../services/myShilohClientActions');
const { createMyShilohConsultationFormActionService } = require('../services/myShilohConsultationFormActions');
const clientConsultationForms = require('../services/clientConsultationForms');
const {
  renderClientConsultationFormPage,
  renderCompletedPage,
  renderUnavailablePage,
} = require('../presentation/clientConsultationFormUx');
const { renderMyShilohPage } = require('../presentation/myShilohPwa');
const { renderMyShilohWelcomeVoucherBooking } = require('../presentation/myShilohWelcomeVoucherBooking');
const { createGiftVoucherService, GiftVoucherError } = require('../services/giftVouchers');
const { renderClientVoucherPage, renderPublicVoucherPage } = require('../presentation/giftVoucherUx');
const { createShilohRewardsService, ShilohRewardsError } = require('../services/shilohRewards');
const { renderClientRewardsPage, clientRewardsScript } = require('../presentation/shilohRewardsUx');
const { createMyShilohProfileService, MyShilohProfileError } = require('../services/myShilohProfile');
const { createMyShilohWelcomeVoucherService, MyShilohWelcomeVoucherError } = require('../services/myShilohWelcomeVoucher');
const { createProblemReportService, ProblemReportError } = require('../services/problemReports');
const { defaultPushService } = require('../services/myShilohPush');
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

function setMyShilohPageHeaders(res, { allowInlineStyles = false } = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; style-src 'self'${allowInlineStyles ? " 'unsafe-inline'" : ''}; script-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
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
  const encoded = encodeURIComponent(message);
  return {
    appUrl: `whatsapp://send?phone=${digits}&text=${encoded}`,
    fallbackUrl: `https://wa.me/${digits}?text=${encoded}`,
  };
}

function normalizeAuthHandoff(value) {
  if (typeof value === 'string' && value) {
    return { appUrl: value, fallbackUrl: value };
  }
  if (!value || typeof value !== 'object') return null;
  const appUrl = String(value.appUrl || '').trim();
  const fallbackUrl = String(value.fallbackUrl || '').trim();
  if (!appUrl || !fallbackUrl) return null;
  return { appUrl, fallbackUrl };
}

function createMyShilohRouter({
  env = process.env,
  sessionService = createClientBrowserSessionService({ db: pool }),
  whatsappResolver = resolveWhatsAppNumber,
  catalogueProvider = getPublicServiceCatalogue,
  authUrlBuilder = defaultAuthUrlBuilder,
  experienceService = createMyShilohExperienceOrchestrator(),
  assistantService = createMyShilohAssistantService(),
  actionService = createMyShilohClientActionService(),
  formActionService = createMyShilohConsultationFormActionService(),
  formService = clientConsultationForms,
  voucherService = createGiftVoucherService({ db: pool }),
  rewardsService = createShilohRewardsService({ db: pool }),
  profileService = createMyShilohProfileService({ db: pool }),
  welcomeVoucherService = createMyShilohWelcomeVoucherService({ db: pool }),
  problemReportService = createProblemReportService({ db: pool }),
  pushService = defaultPushService,
} = {}) {
  const router = express.Router();
  const sameOrigin = sameOriginGuard({ env });
  const requireSession = requireClientSession({ service: sessionService, env });
  const optionalSession = optionalClientSession({ service: sessionService, env });
  const requireCsrf = clientCsrfGuard({ service: sessionService });

  function sendAuthenticatedClient(res, result) {
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
  }

  router.use('/my-shiloh/assets', express.static(path.join(ROOT, 'assets'), {
    maxAge: '1h',
    immutable: false,
    fallthrough: false,
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (['app.css', 'app.js'].includes(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    },
  }));

  router.use('/gift-vouchers/assets', express.static(path.join(__dirname, '..', '..', 'public', 'gift-vouchers'), {
    maxAge: '30d', immutable: true, fallthrough: false,
    setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); },
  }));

  router.get('/gift-vouchers/:requestKey', async (req, res, next) => {
    try {
      const voucher = await voucherService.getPublicVoucher({ requestKey: req.params.requestKey });
      if (!voucher) return res.status(404).type('text/plain').send('Voucher not found.');
      setMyShilohPageHeaders(res, { allowInlineStyles: true });
      return res.status(200).type('html').send(renderPublicVoucherPage({ voucher }));
    } catch (error) { return next(error); }
  });

  router.get('/my-shiloh/gift-vouchers/client.js', requireSession, (_req, res) => res.status(200).type('application/javascript').sendFile(path.join(ROOT, 'assets', 'gift-vouchers.js')));
  router.get('/my-shiloh/gift-vouchers', requireSession, async (req, res, next) => {
    try {
      const [model, rotated] = await Promise.all([
        voucherService.getClientModel({ crmV2ClientId: req.myShilohClientSession.crmV2ClientId }),
        sessionService.rotateCsrfToken(req.myShilohClientSession.sessionId),
      ]);
      if (!rotated.ok) return res.status(401).type('text/plain').send('Unauthorized');
      setMyShilohPageHeaders(res, { allowInlineStyles: true });
      return res.status(200).type('html').send(renderClientVoucherPage({ model, csrfToken: rotated.csrfToken }));
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/api/gift-vouchers', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const allowed = new Set(['recipientName','recipientMobile','fromName','personalMessage','language','deliveryRecipient','amount']);
      if (Object.keys(req.body || {}).some((key) => !allowed.has(key))) return res.status(422).json({ error:'Please reload My Shiloh and try again', requestId:req.id });
      const result = await voucherService.createOrder({ crmV2ClientId:req.myShilohClientSession.crmV2ClientId, ...req.body });
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof GiftVoucherError) return res.status(error.httpStatus).json({ error:error.message, code:error.code, requestId:req.id });
      return next(error);
    }
  });

  router.get('/my-shiloh/rewards/client.js', requireSession, (_req, res) => res.status(200).type('application/javascript').send(clientRewardsScript()));
  router.get('/my-shiloh/rewards', requireSession, async (req, res, next) => {
    try {
      const [model, rotated] = await Promise.all([
        rewardsService.getClientModel({ crmV2ClientId:req.myShilohClientSession.crmV2ClientId }),
        sessionService.rotateCsrfToken(req.myShilohClientSession.sessionId),
      ]);
      if (!rotated.ok) return res.status(401).type('text/plain').send('Unauthorized');
      setMyShilohPageHeaders(res, { allowInlineStyles:true });
      return res.status(200).type('html').send(renderClientRewardsPage({ model, csrfToken:rotated.csrfToken }));
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/api/rewards/redeem', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const allowed=new Set(['appointmentId','amount','operationId']);
      if(Object.keys(req.body||{}).some(key=>!allowed.has(key)))return res.status(422).json({error:'Please reload My Shiloh and try again',requestId:req.id});
      return res.status(200).json(await rewardsService.applyCredit({crmV2ClientId:req.myShilohClientSession.crmV2ClientId,clientSessionId:req.myShilohClientSession.sessionId,...req.body}));
    } catch(error){if(error instanceof ShilohRewardsError)return res.status(error.httpStatus).json({error:error.message,code:error.code,requestId:req.id});return next(error);}
  });

  router.get('/my-shiloh/api/push/config', requireSession, (_req, res) => {
    setNoStoreJson(res);
    return res.status(200).json(pushService.config());
  });

  router.post('/my-shiloh/api/push/subscribe', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const subscription = req.body?.subscription || {};
      const keys = subscription.keys || {};
      const result = await pushService.subscribe({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: req.get('user-agent'),
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/my-shiloh/api/push/unsubscribe', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await pushService.unsubscribe({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        endpoint: req.body?.endpoint,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/my-shiloh/api/push/pending', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await pushService.pending({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        endpoint: req.body?.endpoint,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

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

  router.get('/my-shiloh/book', requireSession, async (req, res, next) => {
    try {
      const [number, catalogue, welcomeVoucher, eligibleServiceIds] = await Promise.all([
        whatsappResolver(),
        catalogueProvider(),
        welcomeVoucherService.getClientModel({
          crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        }),
        welcomeVoucherService.listEligibleServiceIds(),
      ]);
      const voucher = welcomeVoucher?.voucher;
      if (voucher?.state !== 'available') return res.redirect(303, '/my-shiloh/#welcome-voucher');
      setMyShilohPageHeaders(res, { allowInlineStyles: true });
      return res.status(200).type('html').send(renderMyShilohWelcomeVoucherBooking({
        number,
        catalogue: catalogue || [],
        minimumBookingValue: voucher.minimumBookingValue,
        eligibleServiceIds,
      }));
    } catch (error) {
      if (error instanceof MyShilohWelcomeVoucherError) {
        return res.redirect(303, '/my-shiloh/#welcome-voucher');
      }
      return next(error);
    }
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
      const whatsappHandoff = normalizeAuthHandoff(authUrlBuilder(number, challenge.whatsappToken));
      if (!whatsappHandoff) return res.status(503).json({ error: 'WhatsApp sign-in is temporarily unavailable', requestId: req.id });
      res.setHeader('Set-Cookie', serializeClientAuthCookie(challenge.browserToken, {
        env,
        maxAgeSeconds: Math.max(1, Math.floor(CHALLENGE_TTL_MS / 1000)),
      }));
      return res.status(201).json({
        status: 'waiting_for_whatsapp',
        whatsappUrl: whatsappHandoff.appUrl,
        whatsappAppUrl: whatsappHandoff.appUrl,
        whatsappFallbackUrl: whatsappHandoff.fallbackUrl,
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
      try {
        await voucherService.syncRecipientLinks({ crmV2ClientId: result.client.id });
      } catch (_) {
        // Authentication remains authoritative; the voucher page retries recipient linking.
      }
      return sendAuthenticatedClient(res, result);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/my-shiloh/auth/status', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const browserToken = clientAuthTokenFromRequest(req, env);
      if (!browserToken) return res.status(204).send();
      const result = await sessionService.completeVerifiedChallenge({
        browserToken,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (result.ok) {
        try {
          await voucherService.syncRecipientLinks({ crmV2ClientId: result.client.id });
        } catch (_) {
          // Authentication remains authoritative; the voucher page retries recipient linking.
        }
        return sendAuthenticatedClient(res, result);
      }
      if (result.code === 'CLIENT_AUTH_NOT_VERIFIED') {
        return res.status(202).json({ status: 'waiting_for_whatsapp' });
      }
      if (['CLIENT_AUTH_EXPIRED', 'CLIENT_AUTH_INVALID_CHALLENGE'].includes(result.code)) {
        res.setHeader('Set-Cookie', serializeExpiredClientAuthCookie({ env }));
        return res.status(410).json({
          status: 'expired',
          error: 'This sign-in has expired. Please start again.',
          requestId: req.id,
        });
      }
      return res.status(409).json({
        status: 'unavailable',
        error: 'Your My Shiloh profile is not available yet.',
        requestId: req.id,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/my-shiloh/auth/session', requireSession, async (req, res) => {
    try {
      await voucherService.syncRecipientLinks({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      });
    } catch (_) {
      // Existing sessions stay available; the Gift vouchers page retries linking.
    }
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
      try {
        await actionService.revokeSessionActions({
          sessionId: req.myShilohClientSession.sessionId,
          crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        });
      } catch (_) {
        // Session revocation remains authoritative even if proposal cleanup is unavailable.
      }
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

  router.get('/my-shiloh/api/profile', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const profile = await profileService.loadProfile({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      });
      if (!profile) return res.status(404).json({ error: 'Your profile is unavailable', requestId: req.id });
      return res.status(200).json({ profile });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/my-shiloh/api/welcome-voucher', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      return res.status(200).json(await welcomeVoucherService.getClientModel({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      }));
    } catch (error) {
      if (error instanceof MyShilohWelcomeVoucherError) {
        return res.status(error.httpStatus).json({ error:error.message, code:error.code, resolution:error.resolution, requestId:req.id });
      }
      return next(error);
    }
  });

  router.post('/my-shiloh/api/welcome-voucher/redeem', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const allowed = new Set(['appointmentId', 'operationId']);
      if (Object.keys(payload).some((key) => !allowed.has(key))) {
        return res.status(422).json({ error:'Please reload My Shiloh and try again', resolution:['Reload My Shiloh.', 'Choose the booking again.'], requestId:req.id });
      }
      return res.status(200).json(await welcomeVoucherService.applyToBooking({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        sessionId: req.myShilohClientSession.sessionId,
        appointmentId: payload.appointmentId,
        operationId: payload.operationId,
      }));
    } catch (error) {
      if (error instanceof MyShilohWelcomeVoucherError) {
        return res.status(error.httpStatus).json({ error:error.message, code:error.code, resolution:error.resolution, requestId:req.id });
      }
      return next(error);
    }
  });

  router.post('/my-shiloh/api/profile/update', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const allowed = new Set(['expectedRevision', 'name', 'dateOfBirth', 'gender']);
      if (Object.keys(req.body && typeof req.body === 'object' ? req.body : {}).some((key) => !allowed.has(key))) {
        return res.status(422).json({ error: 'Please reload My Shiloh and try again', requestId: req.id });
      }
      const result = await profileService.updateProfile({
        sessionId: req.myShilohClientSession.sessionId,
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        expectedRevision: req.body?.expectedRevision,
        name: req.body?.name,
        dateOfBirth: req.body?.dateOfBirth,
        gender: req.body?.gender,
      });
      const welcomeVoucher = await welcomeVoucherService.getClientModel({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      });
      return res.status(200).json({ ...result, welcomeVoucher });
    } catch (error) {
      if (error instanceof MyShilohProfileError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code, requestId: req.id });
      }
      return next(error);
    }
  });

  router.post('/my-shiloh/api/problem-reports', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const report = await problemReportService.createReport({
        source: 'my_shiloh',
        reporterType: 'client',
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        payload: req.body,
        requestId: req.id,
      });
      return res.status(201).json({ report: { reference: report.reference, status: report.status } });
    } catch (error) {
      if (error instanceof ProblemReportError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code, requestId: req.id });
      }
      return next(error);
    }
  });

  router.get('/my-shiloh/api/problem-reports', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await problemReportService.listForReporter({
        reporterType: 'client',
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      });
      return res.status(200).json({ reports: result.reports });
    } catch (error) {
      if (error instanceof ProblemReportError) return res.status(error.httpStatus).json({ error: error.message, code: error.code, requestId: req.id });
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
        action: result.action || null,
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

  router.post('/my-shiloh/api/actions/confirm', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const keys = Object.keys(req.body && typeof req.body === 'object' ? req.body : {});
      if (keys.some((key) => key !== 'actionToken')) {
        return res.status(422).json({ error: 'Please reload My Shiloh and try again', requestId: req.id });
      }
      const result = await actionService.confirmAction({
        sessionId: req.myShilohClientSession.sessionId,
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        actionToken: req.body?.actionToken,
      });
      if (result.ok && result.status === 'cancelled') {
        return res.status(200).json({
          status: 'cancelled',
          appointment: result.appointment,
        });
      }
      if (result.ok && result.status === 'pending_approval') {
        return res.status(200).json({
          status: 'pending_approval',
          appointment: result.appointment,
          message: result.reply || 'Your reschedule request was sent for practitioner approval.',
        });
      }
      const status = result.status === 'appointment_started' ? 409
        : result.status === 'already_cancelled' ? 409
          : ['appointment_changed','ownership_changed','complex_booking','slot_unavailable','approval_request_failed',
             'clinic_hours','staff_schedule','crm_conflict','reschedule_hold_conflict',
             'booking_proposal_hold_conflict','notification_failed','already_pending'].includes(String(result.status || '')) ? 409
            : 401;
      const error = result.status === 'appointment_started'
        ? 'This appointment has already started and cannot be changed here.'
        : result.status === 'already_cancelled'
          ? 'This appointment is already cancelled.'
          : result.status === 'appointment_changed'
            ? 'This appointment changed after the confirmation was prepared. Please ask Shiloh to check it again.'
            : result.status === 'ownership_changed'
              ? 'The appointment ownership changed. Nothing was changed.'
              : result.status === 'complex_booking'
                ? 'This linked or complex booking needs help from the clinic team. Nothing was changed.'
                : ['slot_unavailable','clinic_hours','staff_schedule','crm_conflict','reschedule_hold_conflict','booking_proposal_hold_conflict'].includes(String(result.status || ''))
                  ? 'That replacement time is no longer safely available. Your current appointment is unchanged.'
                  : result.status === 'already_pending'
                    ? 'A reschedule request is already awaiting practitioner approval for this appointment.'
                    : result.status === 'notification_failed' || result.status === 'approval_request_failed'
                      ? 'The reschedule approval request could not be sent safely. Your current appointment is unchanged.'
                      : 'That confirmation is no longer valid.';
      return res.status(status).json({ error, status: result.status || 'invalid', requestId: req.id });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/my-shiloh/api/actions/decline', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const keys = Object.keys(req.body && typeof req.body === 'object' ? req.body : {});
      if (keys.some((key) => key !== 'actionToken')) {
        return res.status(422).json({ error: 'Please reload My Shiloh and try again', requestId: req.id });
      }
      await actionService.declineAction({
        sessionId: req.myShilohClientSession.sessionId,
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
        actionToken: req.body?.actionToken,
      });
      return res.status(200).json({ status: 'unchanged' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/my-shiloh/forms/complete', requireSession, async (req, res) => {
    const unavailable = (status, message) => res.status(status).type('html').send(renderUnavailable({ message }));
    try {
      if (!formService.isClientConsultationFormsEnabled(env)) {
        return unavailable(404, 'Consultation forms are not available in My Shiloh right now.');
      }
      formService.parseDataKey(env);
      const opened = await formActionService.openForSession({
        sessionId: req.myShilohClientSession.sessionId,
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      });
      if (!opened.ok) {
        const message = opened.code === 'CLIENT_FORM_MULTIPLE_PENDING'
          ? 'More than one consultation form is waiting. Please ask the clinic team to open the correct form.'
          : opened.code === 'CLIENT_FORM_SESSION_INVALID'
            ? 'Your secure My Shiloh session has expired. Please sign in again.'
            : 'There is no consultation form available for your secure client profile right now.';
        return unavailable(opened.code === 'CLIENT_FORM_SESSION_INVALID' ? 401 : 404, message);
      }
      if (opened.model.completed) return res.status(200).type('html').send(renderCompletedPage());
      return res.status(200).type('html').send(renderClientConsultationFormPage({
        ...opened.model,
        accessToken: opened.accessToken,
      }));
    } catch (error) {
      const status = Number(error?.httpStatus) === 410 ? 410
        : Number(error?.httpStatus) === 409 ? 409
          : Number(error?.httpStatus) === 503 ? 503 : 404;
      return unavailable(status, error?.message || 'This consultation form is not available.');
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
  normalizeAuthHandoff,
};
