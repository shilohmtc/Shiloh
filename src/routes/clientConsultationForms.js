const path = require('path');
const express = require('express');
const clientConsultationForms = require('../services/clientConsultationForms');
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
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    setClientFormSecurityHeaders(res);
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

  router.get('/f/:accessToken', async (req, res) => {
    try {
      const model = await service.openForm(req.params.accessToken);
      if (model.completed) return res.status(200).type('html').send(renderCompleted());
      return res.status(200).type('html').send(renderForm({
        ...model,
        accessToken: req.params.accessToken,
      }));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  router.post('/f/:accessToken', express.urlencoded({
    extended: false,
    limit: '96kb',
    parameterLimit: 250,
  }), async (req, res) => {
    if (!sameOriginSubmission(req)) {
      return res.status(403).type('html').send(renderUnavailable({ message: 'This consultation form could not be submitted from that page.' }));
    }
    try {
      await service.submitForm(req.params.accessToken, req.body || {});
      return res.status(200).type('html').send(renderCompleted());
    } catch (error) {
      if (Number(error?.httpStatus) === 422) {
        try {
          const model = await service.openForm(req.params.accessToken);
          if (model.completed) return res.status(200).type('html').send(renderCompleted());
          return res.status(422).type('html').send(renderForm({
            ...model,
            accessToken: req.params.accessToken,
            values: error.values || {},
            fieldErrors: error.fieldErrors || {},
            formError: error.message,
          }));
        } catch (_reloadError) {
          return res.status(404).type('html').send(renderUnavailable({ message: 'This consultation form link is not available.' }));
        }
      }
      const safe = safeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });

  return router;
}

module.exports = {
  setClientFormSecurityHeaders,
  sameOriginSubmission,
  safeError,
  createClientConsultationFormsRouter,
};
