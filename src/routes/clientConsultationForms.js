const path = require('path');
const crypto = require('crypto');
const express = require('express');
const clientConsultationForms = require('../services/clientConsultationForms');
const observability = require('../lib/observability');
const { createConsultationFormTrialRouter } = require('./consultationFormTrial');
const { createClinicIpadCheckinService } = require('../services/clinicIpadCheckin');
const { parseCookieValue } = require('../middleware/staffBrowserSession');
const {
  renderClientConsultationFormPage,
  renderCompletedPage,
  renderUnavailablePage,
} = require('../presentation/clientConsultationFormUx');

function setClientFormSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function sameOriginSubmission(req) {
  const origin = String(req.get('origin') || '').trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === String(req.get('host') || '').toLowerCase();
  } catch (_error) {
    return false;
  }
}

// A signed form proof lets browsers with an opaque or rewritten navigation
// origin submit the exact bearer form they opened without relaxing the guard
// for a foreign page that does not possess the rendered form.
function submissionProof(accessToken, env = process.env) {
  const key = clientConsultationForms.parseDataKey(env);
  return crypto.createHmac('sha256', key)
    .update(`client-consultation-submit-v1\n${clientConsultationForms.normalizeAccessToken(accessToken)}`)
    .digest('base64url');
}

function validSubmissionProof(accessToken, submitted, env = process.env) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(submitted || ''))) return false;
  try {
    const actual = Buffer.from(String(submitted), 'base64url');
    const expected = Buffer.from(submissionProof(accessToken, env), 'base64url');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_error) { return false; }
}

function safeError(error) {
  const status = Number(error?.httpStatus);
  if (status === 410) return { status: 410, message: error.message || 'This consultation form link has expired.' };
  if (status === 503) return { status: 503, message: 'This consultation form is temporarily unavailable. Please try again later.' };
  return { status: 404, message: 'This consultation form link is not available.' };
}

function createClientConsultationFormsRouter({
  env = process.env,
  service = clientConsultationForms,
  renderForm = renderClientConsultationFormPage,
  renderCompleted = renderCompletedPage,
  renderUnavailable = renderUnavailablePage,
  trialService,
  trialLog,
  monitor = observability,
  clinicCheckin = createClinicIpadCheckinService(),
} = {}) {
  const router = express.Router();

  router.use((_req, res, next) => {
    setClientFormSecurityHeaders(res);
    return next();
  });
  router.use('/test', createConsultationFormTrialRouter({ env, ...(trialService ? { service: trialService } : {}), ...(trialLog ? { log: trialLog } : {}) }));
  router.use((req, res, next) => {
    if (!service.isClientConsultationFormsEnabled(env)) return res.sendStatus(404);
    try {
      service.parseDataKey(env);
    } catch (_error) {
      return res.status(503).type('html').send(renderUnavailable({ message: 'This consultation form is temporarily unavailable. Please try again later.' }));
    }
    return next();
  });

  router.use('/assets', express.static(path.join(__dirname, '..', '..', 'public', 'assets', 'forms'), {
    maxAge: '1h',
    immutable: false,
    fallthrough: false,
  }));

  async function clinicAccess(req, res) {
    if (String(env.SHILOH_CLINIC_IPAD_CHECKIN_ENABLED).toLowerCase() !== 'true') return { kiosk:false };
    const access = await clinicCheckin.formAccess(
      req.params.accessToken,parseCookieValue(req.headers.cookie,'shiloh_checkin_form'));
    if (access.kiosk && !access.allowed) {
      res.status(410).type('html').send(renderUnavailable({ message:'This iPad session has ended. Please ask reception to start again.' }));
    }
    return access;
  }

  function clinicFormMarkup(markup, access) {
    if (!access.kiosk) return markup;
    return markup.replace(/autocomplete="[^"]*"/g,'autocomplete="off"')
      .replace('data-client-consultation-form novalidate','data-client-consultation-form data-clinic-checkin autocomplete="off" novalidate')
      .replace('</body>', '<script src="/forms/assets/clinic-ipad-reset.js" defer></script></body>');
  }

  async function finishClinicForm(req,res) {
    await clinicCheckin.finishForm(req.params.accessToken,
      parseCookieValue(req.headers.cookie,'shiloh_checkin_form'));
    res.append('Set-Cookie',`shiloh_checkin_form=; Path=/forms; HttpOnly; SameSite=Strict; Max-Age=0${String(env.NODE_ENV).toLowerCase()==='production'?'; Secure':''}`);
    return res.redirect(303,'/check-in/thank-you');
  }

  router.get('/f/:accessToken', async (req, res) => {
    try {
      const access = await clinicAccess(req,res);
      if (access.kiosk && !access.allowed) return;
      const model = await service.openForm(req.params.accessToken);
      if (model.completed) return access.kiosk ? finishClinicForm(req,res) : res.status(200).type('html').send(renderCompleted());
      return res.status(200).type('html').send(clinicFormMarkup(renderForm({
        ...model,
        accessToken: req.params.accessToken,
        submissionProof: submissionProof(req.params.accessToken, env),
      }),access));
    } catch (error) {
      const safe = safeError(error);
      if (safe.status === 503) monitor.captureException(error, { 'error.kind': 'client_form_unavailable', 'error.code': 'FORM_OPEN_UNAVAILABLE', 'http.method': 'GET', 'http.route': '/forms/f/:accessToken' });
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  router.post('/f/:accessToken', express.urlencoded({
    extended: false,
    limit: '96kb',
    parameterLimit: 250,
  }), async (req, res) => {
    let access;
    try { access = await clinicAccess(req,res); }
    catch (error) { return res.status(503).type('html').send(renderUnavailable({ message:'Forms are temporarily unavailable.' })); }
    if (access.kiosk && !access.allowed) return;
    if (!sameOriginSubmission(req) && !validSubmissionProof(req.params.accessToken, req.body?.submission_proof, env)) {
      try {
        const form = await service.openForm(req.params.accessToken);
        if (!form.completed) monitor.captureException(new Error('Active consultation form submission blocked'), { 'error.kind': 'client_form_submission', 'error.code': 'SUBMISSION_PROOF_REJECTED', 'http.method': 'POST', 'http.route': '/forms/f/:accessToken' });
      } catch (_error) { /* Unknown or expired links are not operational incidents. */ }
      return res.status(403).type('html').send(renderUnavailable({ message: 'This consultation form could not be submitted from that page.' }));
    }
    try {
      const { submission_proof: _submissionProof, ...answers } = req.body || {};
      await service.submitForm(req.params.accessToken, answers);
      if (access.kiosk) return finishClinicForm(req,res);
      return res.redirect(303, `/forms/f/${encodeURIComponent(req.params.accessToken)}`);
    } catch (error) {
      if (Number(error?.httpStatus) === 422) {
        try {
          const model = await service.openForm(req.params.accessToken);
          if (model.completed) return res.status(200).type('html').send(renderCompleted());
          return res.status(422).type('html').send(clinicFormMarkup(renderForm({
            ...model,
            accessToken: req.params.accessToken,
            submissionProof: submissionProof(req.params.accessToken, env),
            values: error.values || {},
            fieldErrors: error.fieldErrors || {},
            formError: error.message,
          }),access));
        } catch (_reloadError) {
          return res.status(404).type('html').send(renderUnavailable({ message: 'This consultation form link is not available.' }));
        }
      }
      const safe = safeError(error);
      if (safe.status === 503) monitor.captureException(error, { 'error.kind': 'client_form_unavailable', 'error.code': 'FORM_SUBMIT_UNAVAILABLE', 'http.method': 'POST', 'http.route': '/forms/f/:accessToken' });
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  return router;
}

module.exports = {
  setClientFormSecurityHeaders,
  sameOriginSubmission,
  submissionProof,
  validSubmissionProof,
  safeError,
  createClientConsultationFormsRouter,
};
