'use strict';

const express = require('express');
const { pool } = require('../db/pool');
const bookingPolicyAcceptance = require('../services/bookingPolicyAcceptance');
const { sendCustomerBookingConfirmationForAppointment } = require('../services/customerBookingConfirmation');
const { renderBookingPolicyAcceptancePage } = require('../presentation/bookingPolicyAcceptanceUx');

function setPolicyHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function safeError(error) {
  const status = Number(error?.httpStatus);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return { status, message: String(error.message || 'This terms link is unavailable.') };
  }
  return { status: 503, message: 'Shiloh could not open this terms link right now.' };
}

async function existingDepositStep(db, appointmentId) {
  const result = await db.query(
    `SELECT pr.request_key,pr.amount,pr.provider_payment_url,pr.state
       FROM payment_requests pr
      WHERE pr.deposit_member_appointment_id=$1
        AND pr.purpose='deposit'
        AND pr.state IN ('pending','link_issued')
      ORDER BY pr.id DESC
      LIMIT 1`,
    [Number(appointmentId)],
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    depositRequired: true,
    depositAmount: Number(row.amount).toFixed(2),
    paymentPath: row.provider_payment_url ? `/pay/${row.request_key}` : null,
  };
}

function advancementOutcome(result = {}) {
  if (result.sent === true || result.deliveryStatus === 'sent' || result.reason === 'already_sent') {
    return { state: 'accepted', confirmationState: 'sent', depositRequired: false, paymentPath: null };
  }
  if (result.reason === 'deposit_required' && result.deliveryStatus === 'awaiting_deposit') {
    const request = Array.isArray(result.deposit?.requests) ? result.deposit.requests[0] : null;
    return {
      state: 'accepted',
      confirmationState: 'pending',
      depositRequired: true,
      depositAmount: result.deposit?.amount || request?.amount || null,
      paymentPath: request?.paymentPath || null,
    };
  }
  return { state: 'accepted', confirmationState: 'pending', depositRequired: false, paymentPath: null };
}

function createBookingPolicyAcceptanceRouter({
  db = pool,
  acceptanceService = bookingPolicyAcceptance,
  sender = sendCustomerBookingConfirmationForAppointment,
} = {}) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use((_req, res, next) => {
    setPolicyHeaders(res);
    next();
  });

  router.get('/:requestKey', async (req, res) => {
    try {
      const request = await acceptanceService.loadPublicRequest(req.params.requestKey);
      let outcome = request.accepted ? { state: 'accepted', confirmationState: 'pending' } : null;
      if (request.accepted) {
        const deposit = await existingDepositStep(db, request.appointmentId);
        if (deposit) outcome = { ...outcome, ...deposit };
      }
      return res.status(200).type('html').send(renderBookingPolicyAcceptancePage({ request, outcome }));
    } catch (error) {
      const safe = safeError(error);
      return res.status(safe.status).type('text/plain').send(safe.message);
    }
  });

  router.post('/:requestKey/accept', async (req, res, next) => {
    if (req.body?.accept !== 'yes') {
      return res.status(400).type('text/plain').send('Please acknowledge Shiloh’s Booking Policy & Terms before continuing.');
    }
    try {
      const accepted = await acceptanceService.acceptRequest(req.params.requestKey);
      let delivery;
      try {
        delivery = await sender(accepted.appointmentId);
      } catch (_error) {
        delivery = { sent: false, deliveryStatus: 'retry_pending', reason: 'attempt_unavailable' };
      }
      const request = await acceptanceService.loadPublicRequest(req.params.requestKey);
      let outcome = advancementOutcome(delivery);
      if (outcome.depositRequired && !outcome.paymentPath) {
        const deposit = await existingDepositStep(db, accepted.appointmentId);
        if (deposit) outcome = { ...outcome, ...deposit };
      }
      return res.status(200).type('html').send(renderBookingPolicyAcceptancePage({ request, outcome }));
    } catch (error) {
      if (error?.httpStatus) {
        return res.status(error.httpStatus).type('text/plain').send(error.message);
      }
      return next(error);
    }
  });

  return router;
}

module.exports = {
  setPolicyHeaders,
  safeError,
  existingDepositStep,
  advancementOutcome,
  createBookingPolicyAcceptanceRouter,
};
