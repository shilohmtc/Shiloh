const { createWebsiteContentService } = require('../services/websiteContent');
const { postPath } = require('../presentation/websiteEditorial');
const { WebsiteContentError } = require('../domain/websiteContent');
const express = require('express');
const { getPublicServiceCatalogue } = require('../services/publicServiceCatalogue');
const { getShilohGoogleReviews, searchGooglePlaces } = require('../services/googlePlaces');
const {
  renderHome,
  renderEditorialListing,
  renderEditorialArticle,
  renderTreatments,
  renderAbout,
  renderContact,
  renderVisit,
  renderPrivacy,
} = require('../services/publicWebsite');

const { PUBLIC_SITE_ORIGIN } = require('../config/publicOrigins');

function createPublicWebsiteRouter({ contentService = createWebsiteContentService() } = {}) {
const router = express.Router();
const INDEXABLE_PATHS = ['/', '/treatments', '/about', '/contact', '/visit', '/privacy', '/book', '/discover', '/offers'];

// Public discovery only: no client/profile, staff, form, payment or query URLs.
router.get('/robots.txt', (req, res) => res.type('text/plain').send(
  `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_SITE_ORIGIN}/sitemap.xml\n`,
));
router.get('/sitemap.xml', async (_req,res) => {
  const posts = await contentService.publicPosts();
  const paths = [...INDEXABLE_PATHS,...posts.map(postPath)];
  res.set('Cache-Control','no-store');
  return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${PUBLIC_SITE_ORIGIN}${path}</loc></url>`).join('')}</urlset>`);
});
for (const [prefix,kind] of [['discover','episode'],['offers','offer']]) {
  router.get(`/${prefix}`,async(_req,res)=>res.set('Cache-Control','no-store').type('html').send(renderEditorialListing(kind,await contentService.publicPosts({kind}))));
  router.get(`/${prefix}/:slug`,async(req,res)=>{
    const post=await contentService.publicPost(kind,req.params.slug);
    return post ? res.set('Cache-Control','no-store').type('html').send(renderEditorialArticle(post)) : res.status(404).type('text/plain').send('This page is not currently available.');
  });
}
router.get('/website-media/:id',async(req,res)=>{
  let media;
  try { media=await contentService.media({id:req.params.id}); } catch(error) { if(error instanceof WebsiteContentError && error.httpStatus===404)return res.sendStatus(404);throw error; }
  if(!media)return res.sendStatus(404);
  return res.set({'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).type(media.mime_type).send(media.bytes);
});

router.get('/', async (req, res) => {
  const [catalogue,publications] = await Promise.all([
    getPublicServiceCatalogue(), contentService.publicPosts().catch(error=>{ require('../lib/logger').warn({err:error},'Website publications unavailable'); return []; }),
  ]);
  return res
    .status(200)
    .type('html')
    .send(renderHome(catalogue || [],{publications}));
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

return router;
}
module.exports = createPublicWebsiteRouter();
module.exports.createPublicWebsiteRouter = createPublicWebsiteRouter;
