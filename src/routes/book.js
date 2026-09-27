const path = require('path');
const express = require('express');
const { resolveWhatsAppNumber } = require('../services/publicWhatsApp');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { renderBookingPage } = require('../services/publicBookingPageEditorial');
const { createMyShilohBookingService } = require('../services/myShilohBooking');

const router = express.Router();
const myShilohBooking = createMyShilohBookingService();

router.use('/assets/booking', express.static(path.join(__dirname, '..', '..', 'public', 'assets', 'booking'), {
  maxAge: '30d',
  immutable: true,
}));

router.get('/book', async (req, res) => {
  const [number, catalogue, bookable] = await Promise.all([
    resolveWhatsAppNumber(),
    getPublicServiceCatalogue(),
    myShilohBooking.catalogue(),
  ]);
  const ready = Boolean(catalogue);
  return res
    .status(ready ? 200 : 503)
    .type('html')
    .send(renderBookingPage(number, catalogue || [], req.query.service, {
      bookableIds: new Set(bookable.map((service) => Number(service.id))),
    }));
});

router.get('/book/health', async (req, res) => {
  const [number, catalogue, bookable] = await Promise.all([
    resolveWhatsAppNumber(),
    getPublicServiceCatalogue(),
    myShilohBooking.catalogue(),
  ]);
  const ready = Boolean(catalogue);
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    whatsappConfigured: Boolean(number),
    appBookingAvailable: ready,
    onlineBookableServiceCount: bookable.length,
    catalogueAvailable: Boolean(catalogue),
    activeServiceCount: catalogue?.length || 0,
  });
});

module.exports = router;
