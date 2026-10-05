const { confirmationClientScript, confirmationStyles } = require('../presentation/workspaceConfirmation');
'use strict';

const path = require('path');
const express = require('express');
const { pool } = require('../db/pool');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { normalizePublicServiceId } = require('../services/publicPresentation');
const { resolveWhatsAppNumber } = require('../services/publicWhatsApp');
const { createClientBrowserSessionService, SESSION_TTL_MS, CHALLENGE_TTL_MS } = require('../services/clientBrowserSession');
const { createClientPasskeyEnrollmentService } = require('../services/clientPasskeyEnrollment');
const { createClientPasskeyAuthenticationService } = require('../services/clientPasskeyAuthentication');
const { createClientPasskeyRecoveryService } = require('../services/clientPasskeyRecovery');
const { createClientSmsAuthService, TTL_MS: SMS_CODE_TTL_MS } = require('../services/clientSmsAuth');
const { createMyShilohExperienceOrchestrator } = require('../services/myShilohExperienceOrchestrator');
const { createMyShilohAssistantService, MyShilohAssistantError } = require('../services/myShilohAssistant');
const { createMyShilohClientActionService } = require('../services/myShilohClientActions');
const { createMyShilohConsultationFormActionService } = require('../services/myShilohConsultationFormActions');
const clientConsultationForms = require('../services/clientConsultationForms');
const { submissionProof } = require('./clientConsultationForms');
const {
  renderClientConsultationFormPage,
  renderCompletedPage,
  renderUnavailablePage,
} = require('../presentation/clientConsultationFormUx');
const { renderMyShilohPage } = require('../presentation/myShilohPwa');
const { renderMyShilohBookingPage } = require('../presentation/myShilohBooking');
const { createWorkspacePackages } = require('../services/workspacePackages');
const { renderClientPackages } = require('../presentation/workspacePackagesUx');
const { renderPlanningRequestPage } = require('../presentation/myShilohPlanningRequest');
const { createGiftVoucherService, GiftVoucherError } = require('../services/giftVouchers');
const { renderClientVoucherPage, renderPublicVoucherPage } = require('../presentation/giftVoucherUx');
const { createShilohRewardsService, ShilohRewardsError } = require('../services/shilohRewards');
const { renderClientRewardsPage, clientRewardsScript } = require('../presentation/shilohRewardsUx');
const { createMyShilohProfileService, MyShilohProfileError } = require('../services/myShilohProfile');
const { createMyShilohWelcomeVoucherService, MyShilohWelcomeVoucherError } = require('../services/myShilohWelcomeVoucher');
const { createProblemReportService, ProblemReportError, REPORT_ACKNOWLEDGEMENT } = require('../services/problemReports');
const { defaultPushService } = require('../services/myShilohPush');
const { queueWorkspaceAlert } = require('../services/workspacePush');
const { createMyShilohBookingService, MyShilohBookingError } = require('../services/myShilohBooking');
const { createMyShilohMultipleBookingService } = require('../services/myShilohMultipleBooking');
const { createClientPlanningRequestService, ClientPlanningRequestError } = require('../services/clientPlanningRequests');
const { createClientWhatsAppContinuationService } = require('../services/clientWhatsAppContinuation');
const bookingProposals = require('../services/clientBookingApproval');
const { BookingDepositPolicyError } = require('../services/bookingDepositPolicy');
const { POLICY_TEXT } = require('../services/bookingPolicy');
const {
  sameOriginGuard,
  requestFingerprintHash,
  serializeClientSessionCookie,
  serializeExpiredClientSessionCookie,
  serializeExpiredClientAuthCookie,
  serializeClientSmsAuthCookie,
  serializeExpiredClientSmsAuthCookie,
  serializeClientPasskeyAuthCookie,
  serializeExpiredClientPasskeyAuthCookie,
  clientSmsAuthTokenFromRequest,
  clientPasskeyAuthTokenFromRequest,
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

function browserUsesPasskeyOrigin(req, expectedOrigin) {
  try { return new URL(req.get?.('origin') || req.headers?.origin).origin === expectedOrigin; }
  catch (_) { return false; }
}

function createMyShilohRouter({
  env = process.env,
  sessionService = createClientBrowserSessionService({ db: pool }),
  passkeyEnrollmentService = createClientPasskeyEnrollmentService({ db: pool, env }),
  passkeyAuthenticationService = createClientPasskeyAuthenticationService({ db: pool, env, sessionService }),
  passkeyRecoveryService = createClientPasskeyRecoveryService({ db: pool, env, sessionService }),
  smsAuthService = createClientSmsAuthService({ db: pool, env, sessionService }),
  whatsappResolver = resolveWhatsAppNumber,
  catalogueProvider = getPublicServiceCatalogue,
  experienceService = createMyShilohExperienceOrchestrator(),
  assistantService = createMyShilohAssistantService({ continuationService:createClientWhatsAppContinuationService({ db:pool }) }),
  actionService = createMyShilohClientActionService(),
  formActionService = createMyShilohConsultationFormActionService(),
  formService = clientConsultationForms,
  voucherService = createGiftVoucherService({ db: pool }),
  rewardsService = createShilohRewardsService({ db: pool }),
  profileService = createMyShilohProfileService({ db: pool }),
  welcomeVoucherService = createMyShilohWelcomeVoucherService({ db: pool }),
  problemReportService = createProblemReportService({ db: pool }),
  pushService = defaultPushService,
  packageService = createWorkspacePackages({ db: pool }),
  bookingService = createMyShilohBookingService({ db: pool, catalogueProvider }),
  multipleBookingService = createMyShilohMultipleBookingService({ db:pool, booking:bookingService }),
  proposalService = bookingProposals,
  planningService = createClientPlanningRequestService({ db: pool }),
  continuationService = createClientWhatsAppContinuationService({ db: pool }),
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
      serializeExpiredClientSmsAuthCookie({ env }),
      serializeExpiredClientPasskeyAuthCookie({ env }),
    ]);
    return res.status(200).json({
      authenticated: true,
      client: { firstName: result.client.firstName },
    });
  }

  router.get('/my-shiloh/assets/confirmation.js', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.type('application/javascript').send(confirmationClientScript({ externalStyles: true }));
  });
  router.get('/my-shiloh/assets/confirmation.css', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.type('text/css').send(confirmationStyles());
  });

  router.use('/my-shiloh/assets', express.static(path.join(ROOT, 'assets'), {
    maxAge: '1h',
    immutable: false,
    fallthrough: false,
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (['app.css', 'app.js', 'booking.js', 'planning-request.js'].includes(path.basename(filePath))) {
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

  router.get('/my-shiloh/api/notifications', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      return res.status(200).json(await pushService.listForClient({
        crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
      }));
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

  router.get('/my-shiloh/packages', optionalSession, (req,res,next) => req.myShilohClientSession ? next() : res.redirect(303,'/my-shiloh/#wallet'), requireSession, async(req,res,next)=>{
    try { setMyShilohPageHeaders(res,{allowInlineStyles:true}); return res.type('html').send(renderClientPackages(await packageService.forClient(req.myShilohClientSession.crmV2ClientId))); }
    catch(e){return next(e);}
  });

  router.get('/my-shiloh/book', optionalSession, (req, res, next) => {
    if (!req.myShilohClientSession) {
      const serviceId = /^[1-9]\d*$/.test(String(req.query?.service || '')) ? String(req.query.service) : '';
      return res.redirect(303, `/my-shiloh/${serviceId ? `?service=${encodeURIComponent(serviceId)}` : ''}#book-online`);
    }
    return next();
  }, requireSession, async (req, res, next) => {
    try {
      const packageServiceId = normalizePublicServiceId(req.query?.packageService);
      const welcomeVoucherMode = !packageServiceId && String(req.query?.welcomeVoucher || '') === '1';
      let voucher = null;
      let eligibleServiceIds = null;
      if (welcomeVoucherMode) {
        const [welcomeVoucher, eligible] = await Promise.all([
          welcomeVoucherService.getClientModel({
            crmV2ClientId: req.myShilohClientSession.crmV2ClientId,
          }),
          welcomeVoucherService.listEligibleServiceIds(),
        ]);
        voucher = welcomeVoucher?.voucher || null;
        eligibleServiceIds = eligible;
        if (voucher?.state !== 'available') return res.redirect(303, '/my-shiloh/#welcome-voucher');
      }
      const [catalogue, rotated, depositPolicy] = await Promise.all([
        packageServiceId ? bookingService.packageCatalogue({ crmV2ClientId:req.myShilohClientSession.crmV2ClientId,serviceId:packageServiceId }) : bookingService.catalogue({
          welcomeVoucherOnly: welcomeVoucherMode,
          minimumBookingValue: voucher?.minimumBookingValue || 450,
          eligibleServiceIds,
        }),
        sessionService.rotateCsrfToken(req.myShilohClientSession.sessionId),
        bookingService.policy(),
      ]);
      if (!rotated.ok) return res.status(401).type('text/plain').send('Unauthorized');
      setMyShilohPageHeaders(res, { allowInlineStyles: true });
      return res.status(200).type('html').send(renderMyShilohBookingPage({
        catalogue,
        clientFirstName: req.myShilohClientSession.client.firstName,
        csrfToken: rotated.csrfToken,
        bookingPolicyText: POLICY_TEXT,
        depositPolicy,
        welcomeVoucherMode,
        prepaidPackageMode: Boolean(packageServiceId),
        minimumBookingValue: voucher?.minimumBookingValue || 450,
        selectedServiceId: packageServiceId || normalizePublicServiceId(req.query?.service),
      }));
    } catch (error) {
      if (error instanceof MyShilohWelcomeVoucherError) return res.redirect(303, '/my-shiloh/#welcome-voucher');
      return next(error);
    }
  });

  router.get('/my-shiloh/request', optionalSession, (req, res, next) => {
    const serviceId = normalizePublicServiceId(req.query?.service);
    if (!req.myShilohClientSession) return res.redirect(303, `/my-shiloh/${serviceId ? `?service=${encodeURIComponent(serviceId)}` : ''}#plan-visit`);
    return next();
  }, requireSession, async (req, res, next) => {
    try {
      const serviceId = normalizePublicServiceId(req.query?.service);
      const [rotated, practitioners, requests, catalogue] = await Promise.all([
        sessionService.rotateCsrfToken(req.myShilohClientSession.sessionId),
        planningService.practitioners(),
        planningService.forClient(req.myShilohClientSession.crmV2ClientId),
        serviceId ? catalogueProvider() : Promise.resolve(null),
      ]);
      if (!rotated.ok) return res.status(401).type('text/plain').send('Unauthorized');
      setMyShilohPageHeaders(res, { allowInlineStyles:true });
      return res.status(200).type('html').send(renderPlanningRequestPage({
        clientFirstName:req.myShilohClientSession.client.firstName,
        csrfToken:rotated.csrfToken,
        practitioners,
        requests,
        serviceDetail: Array.isArray(catalogue) ? String(catalogue.find(item => String(item.id) === serviceId)?.name || '') : '',
        humanWhatsAppNumber:env.SHILOH_HUMAN_WHATSAPP_NUMBER,
      }));
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/api/planning-requests', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const allowed = new Set(['submissionKey','kind','serviceDetail','preferredDate','preferredDaypart',
        'practitionerId','guestCount','specialOccasion','occasionNote','clientNote']);
      if (Object.keys(payload).some(key => !allowed.has(key))) return res.status(422).json({ error:'Please reload My Shiloh and try again.', requestId:req.id });
      const result = await planningService.submit({ ...payload, crmV2ClientId:req.myShilohClientSession.crmV2ClientId });
      if (result.created) void queueWorkspaceAlert(`planning:${result.id}`);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof ClientPlanningRequestError) return res.status(error.httpStatus).json({ error:error.message, code:error.code, requestId:req.id });
      return next(error);
    }
  });

  // Cached clients must not create new handoffs or pause the assistant.
  router.post('/my-shiloh/api/human-handoff', sameOrigin, requireSession, requireCsrf, (_req, res) => {
    setNoStoreJson(res);
    return res.status(410).json({ error:'Message Reception directly using the clinic WhatsApp link.', code:'HUMAN_HANDOFF_RETIRED' });
  });

  router.get('/my-shiloh/api/booking/practitioners', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      return res.status(200).json(await bookingService.practitioners({ serviceId:req.query?.serviceId,
        crmV2ClientId:req.myShilohClientSession.crmV2ClientId }));
    } catch (error) {
      if (error instanceof MyShilohBookingError) return res.status(error.httpStatus).json({ error:error.message, code:error.code, resolution:error.resolution, requestId:req.id });
      return next(error);
    }
  });

  router.get('/my-shiloh/api/booking/availability', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      return res.status(200).json(await bookingService.slots({
        serviceId:req.query?.serviceId,
        staffId:req.query?.staffId,
        date:req.query?.date,
        crmV2ClientId:req.myShilohClientSession.crmV2ClientId,
      }));
    } catch (error) {
      if (error instanceof MyShilohBookingError) return res.status(error.httpStatus).json({ error:error.message, code:error.code, resolution:error.resolution, requestId:req.id });
      return next(error);
    }
  });

  router.post('/my-shiloh/api/booking/confirm', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const allowed = new Set(['serviceId','staffId','startsAt','policyAccepted','specialOccasion','occasionNote']);
      if (Object.keys(payload).some((key) => !allowed.has(key))) {
        return res.status(422).json({ error:'Please reload My Shiloh and try again', requestId:req.id });
      }
      const result = await bookingService.createRequest({
        crmV2ClientId:req.myShilohClientSession.crmV2ClientId,
        serviceId:payload.serviceId,
        staffId:payload.staffId,
        startsAt:payload.startsAt,
        policyAccepted:payload.policyAccepted === true,
        specialOccasion:payload.specialOccasion,
        occasionNote:payload.occasionNote,
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof MyShilohBookingError) return res.status(error.httpStatus).json({ error:error.message, code:error.code, resolution:error.resolution, requestId:req.id });
      return next(error);
    }
  });

  for (const action of ['review', 'confirm']) {
    router.post(`/my-shiloh/api/booking/multiple/${action}`, sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
      try {
        setNoStoreJson(res);
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const allowed = new Set(action === 'review' ? ['treatments']
          : ['treatments','quoteHash','requestId','policyAccepted','specialOccasion','occasionNote']);
        if (Object.keys(payload).some(key => !allowed.has(key))) {
          return res.status(422).json({ error:'Please review your appointments again.', requestId:req.id });
        }
        const input = { ...payload, crmV2ClientId:req.myShilohClientSession.crmV2ClientId };
        const result = await multipleBookingService[action === 'review' ? 'review' : 'createRequest'](input);
        return res.status(action === 'review' ? 200 : 201).json(result);
      } catch (error) {
        if (error instanceof MyShilohBookingError || error instanceof BookingDepositPolicyError) {
          return res.status(error.httpStatus).json({ error:error.message, code:error.code, resolution:error.resolution, requestId:req.id });
        }
        return next(error);
      }
    });
  }

  // Client passkeys use the existing verified client session authority.
  router.post('/my-shiloh/auth/passkeys/registration/options', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const passkeyOrigin = passkeyEnrollmentService.policy().origin;
      if (passkeyOrigin && !browserUsesPasskeyOrigin(req, passkeyOrigin)) {
        return res.status(409).json({ error: 'Open My Shiloh at app.shilohmtc.co.za to save a passkey.', requestId: req.id });
      }
      const result = await passkeyEnrollmentService.begin({
        session: req.myShilohClientSession,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        const status = result.code === 'CLIENT_PASSKEY_DISABLED' ? 404 :
          result.code === 'CLIENT_PASSKEY_UNAVAILABLE' ? 503 :
            result.code === 'CLIENT_RECENT_AUTH_REQUIRED' ? 428 : 403;
        return res.status(status).json({ error: 'Passkey setup is unavailable. Please sign in again and try later.', requestId: req.id });
      }
      return res.status(200).json({ options: result.options, expiresAt: result.expiresAt });
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/passkeys/registration/finish', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await passkeyEnrollmentService.finish({
        session: req.myShilohClientSession,
        response: req.body?.response,
        userAgent: req.headers['user-agent'],
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        const status = result.code === 'CLIENT_PASSKEY_DISABLED' ? 404 :
          result.code === 'CLIENT_PASSKEY_UNAVAILABLE' ? 503 :
            result.code === 'CLIENT_RECENT_AUTH_REQUIRED' ? 428 : 401;
        return res.status(status).json({ error: 'Passkey setup could not be completed. Please try again.', requestId: req.id });
      }
      return res.status(200).json({ registered: true });
    } catch (error) { return next(error); }
  });

  router.get('/my-shiloh/auth/passkeys/devices', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await passkeyEnrollmentService.list({ session: req.myShilohClientSession });
      if (!result.ok) return res.status(503).json({ error: 'Saved passkeys are unavailable.', requestId: req.id });
      return res.status(200).json({ devices: result.devices });
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/passkeys/devices/revoke', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await passkeyEnrollmentService.revoke({
        session: req.myShilohClientSession,
        credentialId: req.body?.credentialId,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        const status = result.code === 'CLIENT_RECENT_AUTH_REQUIRED' ? 428 :
          result.code === 'CLIENT_PASSKEY_INVALID' ? 404 : 503;
        return res.status(status).json({
          error: status === 428 ? 'Sign in again before removing a passkey.' : 'Could not remove this passkey.',
          requestId: req.id,
        });
      }
      return res.status(200).json({ revoked: true });
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/passkeys/sign-in/options', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const passkeyOrigin = passkeyEnrollmentService.policy().origin;
      if (passkeyOrigin && !browserUsesPasskeyOrigin(req, passkeyOrigin)) {
        return res.status(409).json({ error: 'Open My Shiloh at app.shilohmtc.co.za to use your passkey.', requestId: req.id });
      }
      const result = await passkeyAuthenticationService.begin({
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        const status = result.code === 'CLIENT_PASSKEY_DISABLED' ? 404 :
          result.code === 'CLIENT_PASSKEY_RATE_LIMITED' ? 429 : 503;
        return res.status(status).json({ error: 'Passkey sign-in is unavailable. Please request an SMS code.', requestId: req.id });
      }
      res.setHeader('Set-Cookie', serializeClientPasskeyAuthCookie(result.browserToken, {
        env, maxAgeSeconds: Math.max(1, Math.floor(CHALLENGE_TTL_MS / 1000)),
      }));
      return res.status(200).json({ options: result.options, expiresAt: result.expiresAt });
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/passkeys/sign-in/finish', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await passkeyAuthenticationService.finish({
        browserToken: clientPasskeyAuthTokenFromRequest(req, env),
        response: req.body?.response,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        return res.status(result.code === 'CLIENT_PASSKEY_DISABLED' ? 404 : 401).json({
          error: 'We could not verify this passkey. Try again or request an SMS code.', requestId: req.id,
        });
      }
      try { await voucherService.syncRecipientLinks({ crmV2ClientId: result.client.id }); } catch (_) {}
      return sendAuthenticatedClient(res, result);
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/passkeys/recovery/create', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await passkeyRecoveryService.create({
        session: req.myShilohClientSession,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return res.status(result.code === 'CLIENT_RECENT_AUTH_REQUIRED' ? 428 : 403).json({
        error: result.code === 'CLIENT_PASSKEY_REQUIRED' ? 'Save a passkey first.' :
          result.code === 'CLIENT_RECENT_AUTH_REQUIRED' ? 'Sign in again before creating a recovery code.' :
            'Recovery code is unavailable. Please try later.', requestId: req.id,
      });
      return res.status(200).json({ code: result.code });
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/passkeys/recovery/use', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await passkeyRecoveryService.redeem({
        code: req.body?.code, requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return res.status(result.code === 'CLIENT_RECOVERY_RATE_LIMITED' ? 429 : 401).json({
        error: result.code === 'CLIENT_RECOVERY_RATE_LIMITED' ? 'Too many tries. Please wait ten minutes.' :
          'That recovery code could not be used.', requestId: req.id,
      });
      try { await voucherService.syncRecipientLinks({ crmV2ClientId: result.client.id }); } catch (_) {}
      return sendAuthenticatedClient(res, result);
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/sms/start', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await smsAuthService.start({
        mobile: req.body?.mobile, name: req.body?.name,
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) {
        const status = result.code === 'SMS_INVALID_INPUT' ? 400 :
          result.code === 'SMS_RATE_LIMITED' ? 429 : 503;
        return res.status(status).json({ error: status === 400 ? 'Enter your name and a South African mobile number.' :
          status === 429 ? 'Please wait before requesting another code.' :
            'SMS sign-in is temporarily unavailable.', requestId: req.id });
      }
      res.setHeader('Set-Cookie', serializeClientSmsAuthCookie(result.browserToken, {
        env, maxAgeSeconds: Math.floor(SMS_CODE_TTL_MS / 1000),
      }));
      return res.status(201).json({ status: 'code_sent', expiresAt: result.expiresAt.toISOString() });
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/auth/sms/complete', sameOrigin, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const result = await smsAuthService.finish({
        browserToken: clientSmsAuthTokenFromRequest(req, env), code: String(req.body?.code || '').replace(/\s/g, ''),
        requestFingerprintHash: requestFingerprintHash(req),
      });
      if (!result.ok) return res.status(result.code === 'SMS_PROFILE_UNAVAILABLE' ? 409 : 401).json({
        error: result.code === 'SMS_PROFILE_UNAVAILABLE' ?
          'We could not match this number to one Shiloh profile. Please contact Reception.' :
          'This code could not be verified. Request a new code if it has expired.', requestId: req.id,
      });
      try { await voucherService.syncRecipientLinks({ crmV2ClientId: result.client.id }); } catch (_) {}
      return sendAuthenticatedClient(res, result);
    } catch (error) { return next(error); }
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
        serializeExpiredClientPasskeyAuthCookie({ env }),
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

  router.post('/my-shiloh/api/booking-proposals/respond', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    setNoStoreJson(res);
    try {
      const { appointmentId, proposalVersion, action } = req.body || {};
      if (!['accept', 'another'].includes(action)) {
        return res.status(400).json({ error: 'Choose a response to the proposed time.' });
      }
      const input = { appointmentId, proposalVersion, crmV2ClientId: req.myShilohClientSession.crmV2ClientId };
      const result = action === 'accept'
        ? await proposalService.acceptProposedAlternative(input)
        : await proposalService.requestAnotherOption(input);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof bookingProposals.BookingRequestError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code });
      }
      if (error instanceof BookingDepositPolicyError) {
        return res.status(409).json({ error: 'Reception needs to review the price or deposit before this time can be accepted. Your proposal has not been confirmed.', code: error.code });
      }
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
      return res.status(201).json({ acknowledgement: REPORT_ACKNOWLEDGEMENT, report: { reference: report.reference, status: report.status } });
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

  router.get('/my-shiloh/api/shiloh/whatsapp-continuation', requireSession, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const available = await continuationService.available({ crmV2ClientId:req.myShilohClientSession.crmV2ClientId });
      return res.status(200).json({ available });
    } catch (error) { return next(error); }
  });

  router.post('/my-shiloh/api/shiloh/whatsapp-continuation', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      setNoStoreJson(res);
      const exchange = await continuationService.claim({
        crmV2ClientId:req.myShilohClientSession.crmV2ClientId,
        sessionId:req.myShilohClientSession.sessionId,
      });
      if (!exchange) return res.status(404).json({ error:'That recent WhatsApp conversation is no longer available.' });
      return res.status(200).json({ exchange });
    } catch (error) { return next(error); }
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
          message: result.reply || 'Your time-change request was sent to Reception for planning.',
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
                    ? 'A time-change request is already awaiting a decision for this appointment.'
                    : result.status === 'notification_failed' || result.status === 'approval_request_failed'
                      ? 'The time-change request could not be saved safely. Your current appointment is unchanged.'
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
        submissionProof: submissionProof(opened.accessToken, env),
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
      humanWhatsAppNumber: env.SHILOH_HUMAN_WHATSAPP_NUMBER,
      catalogue: catalogue || [],
      selectedServiceId: req.query?.service,
      client: req.myShilohClientSession?.client || null,
      passkeysAvailable: passkeyEnrollmentService.policy().operational,
      smsAvailable: smsAuthService.enabled(),
      signInMethod: req.myShilohClientSession?.authMethod,
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
  browserUsesPasskeyOrigin,
};
