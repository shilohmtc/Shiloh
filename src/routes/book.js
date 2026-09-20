const path = require('path');
const express = require('express');
const { resolveWhatsAppNumber } = require('../services/publicWhatsApp');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { renderBookingPage } = require('../services/publicBookingPageEditorial');

const router = express.Router();

router.use('/assets/booking', express.static(path.join(__dirname, '..', '..', 'public', 'assets', 'booking'), {
  maxAge: '30d',
  immutable: true,
}));

router.get('/book', async (req, res) => {
  const [number, catalogue] = await Promise.all([
    resolveWhatsAppNumber(),
    getPublicServiceCatalogue(),
  ]);
  const ready = Boolean(number && catalogue);
  return res
    .status(ready ? 200 : 503)
    .type('html')
    .send(renderBookingPage(number, catalogue || [], req.query.service));
});

router.get('/book/health', async (req, res) => {
  const [number, catalogue] = await Promise.all([
    resolveWhatsAppNumber(),
    getPublicServiceCatalogue(),
  ]);
  const ready = Boolean(number && catalogue);
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    whatsappConfigured: Boolean(number),
    catalogueAvailable: Boolean(catalogue),
    activeServiceCount: catalogue?.length || 0,
  });
});

module.exports = router;
