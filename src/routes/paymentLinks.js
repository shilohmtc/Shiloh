const express = require('express');
const { pool } = require('../db/pool');
const { renderPaymentStatusPage } = require('../presentation/paymentStatusUx');

function safePaymentRequestKey(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(key) ? key : null;
}

function paymentUnavailable(res, status, message) {
  return res.status(status).type('text/plain').send(message);
}

function createPaymentLinkRouter({ db = pool } = {}) {
  const router = express.Router();

  router.get('/status/:requestKey', async (req, res, next) => {
    const requestKey = safePaymentRequestKey(req.params.requestKey);
    if (!requestKey) return paymentUnavailable(res, 404, 'Payment status not found.');
    try {
      const result = await db.query(
        `SELECT amount,state
           FROM payment_requests
          WHERE request_key=$1
          LIMIT 1`,
        [requestKey],
      );
      const request = result.rows[0];
      if (!request) return paymentUnavailable(res, 404, 'Payment status not found.');
      return res.status(200).type('html').set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      }).send(renderPaymentStatusPage({ requestKey, request }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:requestKey', async (req, res, next) => {
    const requestKey = safePaymentRequestKey(req.params.requestKey);
    if (!requestKey) return paymentUnavailable(res, 404, 'Payment link not found.');

    try {
      const result = await db.query(
        `SELECT provider,state,provider_payment_url,expires_at
           FROM payment_requests
          WHERE request_key=$1
          LIMIT 1`,
        [requestKey],
      );
      const request = result.rows[0];
      if (!request) return paymentUnavailable(res, 404, 'Payment link not found.');
      if (!request.provider_payment_url || request.provider !== 'ozow') {
        return paymentUnavailable(res, 409, 'This payment link is not ready yet.');
      }
      if (['paid', 'failed', 'cancelled', 'expired', 'refunded'].includes(String(request.state))) {
        return paymentUnavailable(res, 410, 'This payment request is no longer available.');
      }
      if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
        return paymentUnavailable(res, 410, 'This payment link has expired.');
      }

      const target = new URL(String(request.provider_payment_url));
      if (target.protocol !== 'https:' || !/(^|\.)ozow\.com$/i.test(target.hostname)) {
        return paymentUnavailable(res, 502, 'This payment link is unavailable.');
      }

      res.set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.redirect(303, target.toString());
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPaymentLinkRouter, safePaymentRequestKey };
