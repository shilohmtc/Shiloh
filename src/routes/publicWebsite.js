const express = require('express');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { getShilohGoogleReviews, searchGooglePlaces } = require('../services/googlePlaces');
const {
  renderHome,
  renderTreatments,
  renderAbout,
  renderContact,
  renderVisit,
  renderPrivacy,
} = require('../services/publicWebsite');

const { PUBLIC_SITE_ORIGIN } = require('../config/publicOrigins');

const router = express.Router();
const INDEXABLE_PATHS = ['/', '/treatments', '/about', '/contact', '/visit', '/privacy', '/book'];

// Public discovery only: no client/profile, staff, form, payment or query URLs.
router.get('/robots.txt', (req, res) => res.type('text/plain').send(
  `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_SITE_ORIGIN}/sitemap.xml\n`,
));
router.get('/sitemap.xml', (req, res) => res.type('application/xml').send(
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${INDEXABLE_PATHS.map(path => `<url><loc>${PUBLIC_SITE_ORIGIN}${path}</loc></url>`).join('')}</urlset>`,
));

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
router.get('/reviews/google', async (req, res) => {
  const result = await getShilohGoogleReviews();
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ ...result, checkedAt: new Date().toISOString() });
});
router.get('/privacy', (req, res) => res.status(200).type('html').send(renderPrivacy()));

module.exports = router;
