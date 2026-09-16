const express = require('express');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { searchGooglePlaces } = require('../services/googlePlaces');
const {
  renderHome,
  renderTreatments,
  renderAbout,
  renderContact,
  renderVisit,
  renderPrivacy,
} = require('../services/publicWebsite');

const router = express.Router();

router.get('/', async (req, res) => {
  const catalogue = await getPublicServiceCatalogue();
  return res
    .status(200)
    .type('html')
    .send(renderHome(catalogue || []));
});

router.get('/treatments', async (req, res) => {
  const catalogue = await getPublicServiceCatalogue();
  return res
    .status(catalogue ? 200 : 503)
    .type('html')
    .send(renderTreatments(catalogue || []));
});

router.get('/about', (req, res) => res.status(200).type('html').send(renderAbout()));
router.get('/contact', (req, res) => res.status(200).type('html').send(renderContact()));
router.get('/visit', (req, res) => res.status(200).type('html').send(renderVisit()));
router.get('/visit/places', async (req, res) => {
  const result = await searchGooglePlaces(req.query.query || 'guesthouses and hotels');
  return res.status(200).json({ ...result, checkedAt: new Date().toISOString() });
});
router.get('/privacy', (req, res) => res.status(200).type('html').send(renderPrivacy()));

module.exports = router;
