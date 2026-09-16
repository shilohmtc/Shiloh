const express = require('express');
const { pool } = require('../db/pool');
const { renderPaymentReturnPage } = require('../presentation/paymentReturnUx');

function safeTransactionReference(value) {
  const reference = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(reference) ? reference : null;
}

async function appointmentPathForReturn(queryable, requestReference) {
  const reference = safeTransactionReference(requestReference);
  if (!reference) return '/';
  try {
    const result = await queryable.query(
      `SELECT COALESCE(bpa.appointment_id,(
                SELECT agm.appointment_id
                  FROM appointment_group_members agm
                 WHERE agm.group_id=bpa.appointment_group_id
                 ORDER BY agm.guest_position,agm.appointment_id
                 LIMIT 1
              )) AS appointment_id
         FROM payment_requests pr
         JOIN booking_payment_accounts bpa ON bpa.id=pr.payment_account_id
        WHERE pr.request_key=$1
        LIMIT 1`,
      [reference]
    );
    const appointmentId = Number(result.rows[0]?.appointment_id);
    return Number.isSafeInteger(appointmentId) && appointmentId > 0
      ? `/pay/status/${reference}`
      : '/';
  } catch (_) {
    return '/';
  }
}

function createPaymentReturnRouter({ db = pool, renderPage = renderPaymentReturnPage } = {}) {
  const router = express.Router();
  const serve = (status) => async (req, res, next) => {
    try {
      const returnPath = await appointmentPathForReturn(db, req.query.TransactionReference || req.query.transactionReference);
      return res.status(200).type('html').set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      }).send(renderPage({ status, returnPath }));
    } catch (error) {
      return next(error);
    }
  };

  router.get('/return/success', serve('success'));
  router.get('/return/cancelled', serve('cancelled'));
  router.get('/return/error', serve('error'));
  return router;
}

module.exports = { appointmentPathForReturn, createPaymentReturnRouter, safeTransactionReference };
