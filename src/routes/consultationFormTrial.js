const path = require('path');
const express = require('express');
const logger = require('../lib/logger');
const { TRIAL_FLAG, trialConfig, createConsultationFormTrialService } = require('../services/consultationFormTrial');
const { renderTrialForm, renderTrialLanding, renderTrialCompleted } = require('../presentation/consultationFormTrialUx');
const { renderUnavailablePage } = require('../presentation/clientConsultationFormUx');

function sameTrialOrigin(req, env) {
  try {
    const allowed = new URL(env.CONSULTATION_FORM_TRIAL_ORIGIN || 'https://app.shilohmtc.co.za');
    const localTest = env.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(allowed.hostname);
    if (allowed.protocol !== 'https:' && !localTest) return false;
    return req.get('origin') === allowed.origin && req.get('sec-fetch-site') !== 'cross-site';
  } catch (_error) { return false; }
}

function createConsultationFormTrialRouter({ env = process.env, service = createConsultationFormTrialService({ env }), log = logger } = {}) {
  const router = express.Router();
  const enabled = String(env[TRIAL_FLAG] || '').toLowerCase() === 'true';
  let ready = Promise.resolve(false);
  if (enabled) {
    ready = service.verifyStorage().then(() => {
      log.info({ event: 'consultation_form_trial_ready', encryptedDatabaseRoundTrip: true, smokeTransactionRolledBack: true, realClientRecordsCreated: 0, appointmentsCreated: 0, whatsappSending: false }, 'Private consultation form trial ready');
      return true;
    }).catch(() => {
      log.warn({ event: 'consultation_form_trial_not_ready' }, 'Private consultation form trial remains unavailable');
      return false;
    });
    const cleanup = () => service.purgeExpired().catch(() => log.warn({ event: 'consultation_form_trial_cleanup_failed' }, 'Trial cleanup will retry'));
    cleanup();
    const timer = setInterval(cleanup, 60 * 60 * 1000);
    timer.unref();
  }
  let windowStart = Date.now();
  let requests = 0;
  router.use(async (req, res, next) => {
    if (!enabled) return res.sendStatus(404);
    // This deliberately serves one tester only; the bound does not affect any other route.
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 120) return res.status(429).set('Retry-After', '60').send('Please wait a minute and try again.');
    try { trialConfig(env); } catch (error) {
      const status = [404, 410, 503].includes(error.httpStatus) ? error.httpStatus : 503;
      return res.status(status).type('html').send(renderUnavailablePage({ message: 'This private test link is unavailable or has expired.' }));
    }
    if (!await ready) return res.status(503).type('html').send(renderUnavailablePage({ message: 'The test form is temporarily unavailable.' }));
    return next();
  });

  router.get('/', (_req, res) => res.type('html').send(renderTrialLanding()));
  router.get('/assets/:name', (req, res) => {
    if (!['client-consultation.js', 'consultation-trial-entry.js'].includes(req.params.name)) return res.sendStatus(404);
    return res.sendFile(path.join(__dirname, '..', '..', 'public', 'assets', 'forms', req.params.name), { cacheControl: false }, error => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  function guardPost(req, res, next) {
    if (!sameTrialOrigin(req, env)) return res.sendStatus(403);
    if (!req.is('application/x-www-form-urlencoded')) return res.sendStatus(415);
    return next();
  }
  const parse = express.urlencoded({ extended: false, limit: '96kb', parameterLimit: 250 });
  function unavailable(res, error) {
    const status = [404, 410, 503].includes(Number(error?.httpStatus)) ? Number(error.httpStatus) : 503;
    return res.status(status).type('html').send(renderUnavailablePage({ message: 'This private test link is unavailable or has expired.' }));
  }

  router.post('/open', guardPost, parse, async (req, res) => {
    try {
      if (Object.keys(req.body || {}).some(key => key !== 'access_token')) return res.sendStatus(400);
      const token = req.body?.access_token;
      const model = await service.openTrial(token);
      return res.type('html').send(model.completed ? renderTrialCompleted() : renderTrialForm(model, token));
    } catch (error) { return unavailable(res, error); }
  });

  router.post('/submit', guardPost, parse, async (req, res) => {
    const { access_token: token, ...answers } = req.body || {};
    try {
      const result = await service.submitTrial(token, answers);
      if (result.storageVerified) log.info({ event: 'consultation_form_trial_submitted', encryptedDatabaseRoundTrip: true }, 'Test consultation form received');
      return res.type('html').send(renderTrialCompleted());
    } catch (error) {
      if (error.httpStatus === 422) {
        try {
          const model = await service.openTrial(token);
          if (model.completed) return res.type('html').send(renderTrialCompleted());
          return res.status(422).type('html').send(renderTrialForm({ ...model, values: error.values || {}, fieldErrors: error.fieldErrors || {}, formError: error.message }, token));
        } catch (_reloadError) { return unavailable(res); }
      }
      return unavailable(res, error);
    }
  });
  router.use((_req, res) => res.sendStatus(404));
  router.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status = error?.type === 'entity.too.large' || error?.type === 'parameters.too.many' ? 413 : 400;
    return res.status(status).type('html').send(renderUnavailablePage({ message: 'Please check the test form and try again.' }));
  });
  return router;
}

module.exports = { sameTrialOrigin, createConsultationFormTrialRouter };
