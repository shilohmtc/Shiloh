const express = require('express');
const { pool } = require('../db/pool');
const { renderPaymentStatusPage } = require('../presentation/paymentStatusUx');
const { renderPaymentPolicyPage } = require('../presentation/paymentPolicyUx');
const {
  BOOKING_POLICY_VERSION,
  BOOKING_POLICY_UPDATED,
  BOOKING_POLICY_TEXT,
} = require('../config/bookingPolicyAuthority');
const { ensurePolicySchema } = require('../services/bookingPolicy');

function safePaymentRequestKey(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(key) ? key : null;
}

function paymentUnavailable(res, status, message) {
  return res.status(status).type('text/plain').send(message);
}

function paymentRequestQuery() {
  return `SELECT pr.provider,pr.state,pr.provider_payment_url,pr.expires_at,pr.gift_voucher_order_id,
                  pr.amount,pr.payer_name,pr.payer_mobile,
                  COALESCE(pr.deposit_member_appointment_id,bpa.appointment_id) AS appointment_id,
                  payment_appointment.status AS appointment_status
             FROM payment_requests pr
             LEFT JOIN booking_payment_accounts bpa ON bpa.id=pr.payment_account_id
             LEFT JOIN appointments payment_appointment
               ON payment_appointment.id=COALESCE(pr.deposit_member_appointment_id,bpa.appointment_id)
            WHERE pr.request_key=$1
            LIMIT 1`;
}

function cancelledBookingPaymentLink(request) {
  return String(request?.appointment_status || '').toLowerCase() === 'cancelled';
}

function validateOzowTarget(request) {
  if (!request.provider_payment_url || request.provider !== 'ozow') return null;
  const target = new URL(String(request.provider_payment_url));
  if (target.protocol !== 'https:' || !/(^|\.)ozow\.com$/i.test(target.hostname)) return null;
  return target;
}

function createPaymentLinkRouter({ db = pool, policySchema = ensurePolicySchema } = {}) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

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

  router.post('/:requestKey/accept', async (req, res, next) => {
    const requestKey = safePaymentRequestKey(req.params.requestKey);
    if (!requestKey) return paymentUnavailable(res, 404, 'Payment link not found.');
    if (req.body?.accept !== 'yes') return paymentUnavailable(res, 400, 'Please acknowledge Shiloh’s Booking Policy & Terms before continuing.');
    try {
      const result = await db.query(paymentRequestQuery(), [requestKey]);
      const request = result.rows[0];
      if (!request) return paymentUnavailable(res, 404, 'Payment link not found.');
      if (cancelledBookingPaymentLink(request)) return paymentUnavailable(res, 410, 'This booking was cancelled. This payment link can no longer be used.');
      if (request.gift_voucher_order_id) return res.redirect(303, `/gift-vouchers/${requestKey}`);
      if (!request.payer_mobile) return paymentUnavailable(res, 409, 'This payment link has no verified payer contact.');
      if (['paid', 'failed', 'cancelled', 'expired', 'refunded'].includes(String(request.state))) {
        return paymentUnavailable(res, 410, 'This payment request is no longer available.');
      }
      if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
        return paymentUnavailable(res, 410, 'This payment link has expired.');
      }
      const target = validateOzowTarget(request);
      if (!target) return paymentUnavailable(res, 502, 'This payment link is unavailable.');

      await policySchema();
      await db.query(
        `INSERT INTO booking_policy_acceptances
          (phone,policy_version,accepted_at,channel,service_text)
         VALUES ($1,$2,NOW(),'payment_link',$3)`,
        [String(request.payer_mobile), BOOKING_POLICY_VERSION, request.appointment_id ? `Booking #${request.appointment_id}` : 'Shiloh payment'],
      );

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

  router.get('/:requestKey', async (req, res, next) => {
    const requestKey = safePaymentRequestKey(req.params.requestKey);
    if (!requestKey) return paymentUnavailable(res, 404, 'Payment link not found.');

    try {
      const result = await db.query(paymentRequestQuery(), [requestKey]);
      const request = result.rows[0];
      if (!request) return paymentUnavailable(res, 404, 'Payment link not found.');
      if (cancelledBookingPaymentLink(request)) return paymentUnavailable(res, 410, 'This booking was cancelled. This payment link can no longer be used.');
      if (request.state === 'paid' && request.gift_voucher_order_id) {
        return res.redirect(303, `/gift-vouchers/${requestKey}`);
      }
      if (['paid', 'failed', 'cancelled', 'expired', 'refunded'].includes(String(request.state))) {
        return paymentUnavailable(res, 410, 'This payment request is no longer available.');
      }
      if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
        return paymentUnavailable(res, 410, 'This payment link has expired.');
      }
      if (request.gift_voucher_order_id) return res.redirect(303, `/gift-vouchers/${requestKey}`);
      if (!validateOzowTarget(request)) return paymentUnavailable(res, 409, 'This payment link is not ready yet.');

      return res.status(200).type('html').set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      }).send(renderPaymentPolicyPage({
        requestKey,
        request,
        policyText: BOOKING_POLICY_TEXT,
        policyVersion: BOOKING_POLICY_VERSION,
        policyUpdated: BOOKING_POLICY_UPDATED,
      }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPaymentLinkRouter, safePaymentRequestKey, paymentRequestQuery, cancelledBookingPaymentLink };
