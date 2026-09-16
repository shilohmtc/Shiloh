const express = require('express');
const { renderPaymentReturnPage } = require('../presentation/paymentReturnUx');

function createPaymentReturnRouter({ renderPage = renderPaymentReturnPage } = {}) {
  const router = express.Router();
  const serve = (status) => (_req, res) => res.status(200).type('html').set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }).send(renderPage({ status }));

  router.get('/return/success', serve('success'));
  router.get('/return/cancelled', serve('cancelled'));
  router.get('/return/error', serve('error'));
  return router;
}

module.exports = { createPaymentReturnRouter };
