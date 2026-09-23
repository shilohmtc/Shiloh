'use strict';

const { createBookingPaymentService } = require('./bookingPayments');

let singleton = null;

function paymentService() {
  if (!singleton) singleton = createBookingPaymentService();
  return singleton;
}

async function ensureBookingDeposit(appointmentId) {
  return paymentService().ensureDepositRequest({ appointmentId });
}

module.exports = { ensureBookingDeposit };
