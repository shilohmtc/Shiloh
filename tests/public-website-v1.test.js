const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  renderHome,
  renderTreatments,
  renderAbout,
  renderContact,
  renderVisit,
  renderPrivacy,
} = require('../src/services/publicWebsite');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');
const {
  PUBLIC_BRAND_ASSET_VERSION,
  renderSiteHeader,
} = require('../src/services/publicSiteChrome');

const catalogue = [
  {
    id: 101,
    name: 'Deep Tissue Massage',
    category: 'Massage',
    duration: '60 min',
    price: 'R850',
    description: 'Focused therapeutic massage.',
    bookingNote: '',
  },
  {
    id: 202,
    name: 'Signature Pedicure',
    category: 'Pedicures & Foot Care',
    duration: '75 min',
    price: 'R620',
    description: 'Foot care with a polished finish.',
    bookingNote: '',
  },
];

test('public Services renders canonical timing, price and approved description fields without creating booking authority', () => {
  const html = renderTreatments(catalogue);
  assert.match(html, /Deep Tissue Massage/);
  assert.match(html, /60 min/);
  assert.match(html, /R850/);
  assert.match(html, /Pedicures &amp; Foot Care/);
  assert.match(html, /Focused therapeutic massage/);
  assert.match(html, /Foot care with a polished finish/);
  assert.doesNotMatch(html, /wa\.me/);
  assert.doesNotMatch(html, /availability=/);
  assert.match(html, /data-public-treatment-catalogue/);
  assert.match(html, /href="\/book\?service=101#service-101"/);
  assert.match(html, /href="\/book\?service=202#service-202"/);
});

test('Home discovers live categories while Services preserves canonical service IDs into booking', () => {
  const home = renderHome(catalogue);
  const services = renderTreatments(catalogue);

  assert.match(home, /data-public-service-discovery/);
  assert.match(home, /data-public-service-category="Massage"/);
  assert.match(home, /data-public-service-category="Pedicures &amp; Foot Care"/);
  assert.match(home, /Deep Tissue Massage/);
  assert.match(home, /Signature Pedicure/);
  assert.match(home, /href="\/treatments#category-massage"/);
  assert.match(home, /href="\/book#choose-with-shiloh">Not sure\? Ask Shiloh<\/a>/);
  assert.doesNotMatch(home, /href="\/book\?service=101#service-101"/);

  assert.match(services, /data-service-id="101"/);
  assert.match(services, /href="\/book\?service=101#service-101"/);
  assert.match(services, /data-public-category-navigation/);
  assert.match(services, /href="#category-massage"/);
  assert.match(services, /id="category-pedicures-and-foot-care"/);
});

test('service discovery is catalogue-derived and does not create a second availability authority', () => {
  const html = renderHome([
    ...catalogue,
    { id: 303, name: 'Hydrating Facial', category: 'Aesthetic Care', duration: '60 min', price: 'R720' },
    { id: 404, name: 'Brow Shape', category: 'Aesthetic Care', duration: '30 min', price: 'R280' },
  ]);

  assert.match(html, /data-public-service-category="Facials &amp; Skin"/);
  assert.match(html, /2 services/);
  assert.match(html, /Hydrating Facial/);
  assert.match(html, /Brow Shape/);
  assert.doesNotMatch(html, /available today|guaranteed|recommended practitioner/i);
  assert.doesNotMatch(html, /wa\.me/);
});

test('all public pages and booking share complete navigation and accessible landmarks', () => {
  const pages = [
    renderHome(catalogue),
    renderTreatments(catalogue),
    renderAbout(),
    renderContact(),
    renderVisit(),
    renderBookingPage('27836835433', catalogue),
  ];
  for (const html of pages) {
    assert.match(html, /href="\/"[^>]*>Home<\/a>/);
    assert.match(html, /href="\/treatments"[^>]*>Services<\/a>/);
    assert.match(html, /href="\/about"/);
    assert.match(html, /href="\/contact"/);
    assert.match(html, /href="\/my-shiloh\/"[^>]*>My Shiloh<\/a>|href="\/my-shiloh\/"[^>]*><span>My Shiloh<\/span>/);
    assert.match(html, /href="\/book"/);
    assert.match(html, /id="main-content"/);
    assert.match(html, /Skip to content/);
    assert.match(html, /name="viewport"/);
  }
});


test('public navigation gives returning clients a distinct My Shiloh entry without weakening Book', () => {
  const html = renderSiteHeader('/');
  const clientAt = html.indexOf('href="/my-shiloh/"');
  const bookAt = html.indexOf('href="/book"');
  assert.ok(clientAt >= 0);
  assert.ok(bookAt > clientAt);
  assert.match(html, /class="site-client"[^>]*>My Shiloh<\/a>/);
  assert.match(html, /class="site-book"[^>]*>Book<\/a>/);
  assert.match(html, /class="mobile-client"[^>]*><span>My Shiloh<\/span><small>My bookings &amp; profile<\/small><\/a>/);
});

test('home includes an understated returning-client My Shiloh entry point', () => {
  const html = renderHome(catalogue);
  assert.match(html, /class="client-portal"/);
  assert.match(html, /Already part of Shiloh\?/);
  assert.match(html, /href="\/my-shiloh\/"[^>]*>Open My Shiloh<\/a>/);
  assert.match(html, /No app-store download required/);
  assert.match(html, /appointment, form and payment views will live here as the client experience grows/i);
});

test('home includes a resilient, accessible Google review carousel without exposing credentials', () => {
  const html = renderHome(catalogue, {
    reviewPreview: {
      place: { rating: 4.9, ratingCount: 87, mapsUrl: 'https://maps.google.com/example' },
      reviews: [{
        authorName: 'Test reviewer',
        rating: 5,
        text: 'A calm and caring visit.',
        reviewUrl: 'https://maps.google.com/example/review',
      }],
    },
  });
  assert.match(html, /data-google-reviews/);
  assert.match(html, /Loved in Heidelberg/);
  assert.match(html, /4\.9<\/strong> from 87 Google reviews/);
  assert.match(html, /A calm and caring visit/);
  assert.match(html, /data-reviews-previous aria-label="Previous review"/);
  assert.match(html, /data-reviews-next aria-label="Next review"/);
  assert.match(html, /data-reviews-rail tabindex="0" aria-label="Google client reviews"/);
  assert.match(html, /fetch\('\/reviews\/google'/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /translate="no">Google Maps<\/span> · Reviews are shown in Google Maps relevance order/);
  assert.match(html, /View review on Google Maps/);
  assert.match(html, /cache:'no-store'/);
  assert.doesNotMatch(html, /GOOGLE_PLACES_API_KEY/);
});

test('home and Contact share the approved Heidelberg town-centre story', () => {
  const home = renderHome(catalogue);
  const contact = renderContact();

  assert.match(home, /data-public-visit-shiloh/);
  assert.match(home, /Come experience the new heart of Heidelberg/);
  assert.match(home, /Great neighbours make life more beautiful|Businesses near Shiloh/);
  assert.match(contact, /data-public-town-centre/);
  assert.match(contact, /Great neighbours make life more beautiful/);

  for (const html of [home, contact]) {
    assert.match(html, /Grill King Family Restaurant/);
    assert.match(html, /Heidelberg Crown Hotel/);
    assert.match(html, /Platō Coffee/);
    assert.doesNotMatch(html, /opening soon/i);
    assert.doesNotMatch(html, /Burger King/i);
    assert.equal((html.match(/aria-label="Open [^"]+ in Google Maps \(opens in a new tab\)"/g) || []).length, 8);
    assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) || []).length >= 8, true);
  }
});

test('home leads with the Heidelberg location and shared brand chrome', () => {
  const html = renderHome(catalogue);
  assert.match(html, /<section class="home-hero">[\s\S]*?<div class="eyebrow">In the heart of Heidelberg<\/div>/);
  assert.match(html, /Massage and aesthetic services at 37 Jacobs Street/);
  assert.match(html, /class="site-brand-mark"/);
  assert.match(html, /class="site-footer-mark"/);
  assert.match(html, /Contact &amp; directions/);
  assert.match(html, new RegExp(`shiloh-mark-192\\.png\\?v=${PUBLIC_BRAND_ASSET_VERSION}`));
});

test('home uses the approved editorial photography without presenting it as the clinic interior', () => {
  const html = renderHome([
    ...catalogue,
    { id: 303, name: 'Hydrating Facial', category: 'Facials & Skin', duration: '60 min', price: 'R720' },
    { id: 404, name: 'Microneedling', category: 'Advanced Aesthetics', duration: '60 min', price: 'R950' },
    { id: 505, name: 'Permanent Makeup Brows', category: 'Permanent Makeup', duration: '120 min', price: 'R1800' },
    { id: 606, name: 'Manicure', category: 'More Services', duration: '45 min', price: 'R380' },
  ]);
  const assets = [
    'shiloh-editorial-hero-v1.webp',
    'shiloh-editorial-massage-v1.webp',
    'shiloh-editorial-foot-care-v1.webp',
    'shiloh-editorial-facials-v1.webp',
    'shiloh-editorial-advanced-aesthetics-v1.webp',
    'shiloh-editorial-permanent-makeup-v1.webp',
    'shiloh-editorial-more-services-v1.webp',
    'shiloh-editorial-welcome-v1.webp',
    'shiloh-location-courtyard-v1.webp',
  ];

  for (const filename of assets) {
    const filePath = path.join(__dirname, '..', 'public', 'assets', 'website', filename);
    assert.equal(fs.existsSync(filePath), true, `${filename} must exist`);
    assert.ok(fs.statSync(filePath).size < 200_000, `${filename} must stay web-sized`);
    assert.match(html, new RegExp(`/assets/website/${filename.replaceAll('.', '\\.')}`));
  }

  assert.match(html, /Editorial wellness arrangement in Shiloh’s colour palette/);
  assert.match(html, /Editorial massage preparation in Shiloh’s colour palette/);
  assert.match(html, /Editorial foot-care preparation in Shiloh’s colour palette/);
  assert.match(html, /Editorial facial and skincare preparation in Shiloh’s colour palette/);
  assert.match(html, /Editorial advanced aesthetics preparation in Shiloh’s colour palette/);
  assert.match(html, /Editorial permanent makeup tools in Shiloh’s colour palette/);
  assert.match(html, /Editorial self-care arrangement in Shiloh’s colour palette/);
  assert.match(html, /Editorial welcome image inspired by Shiloh’s colour palette/);
  assert.match(html, /The Shiloh feeling/);
  assert.match(html, /class="site-location-band"/);
  assert.match(html, /Plan your visit to Shiloh at 37 Jacobs Street, Heidelberg/);
  assert.doesNotMatch(html, /assets\/booking\/(?:treatment-room-side|pedicure-side)\.webp/);
});

test('public website brand assets exactly match the approved installed-app artwork', () => {
  const asset = (...segments) => fs.readFileSync(path.join(__dirname, '..', ...segments));
  const pairs = [
    [['public', 'assets', 'brand', 'shiloh-mark-192.png'], ['public', 'assets', 'pwa', 'shiloh-pwa-192.png']],
    [['public', 'assets', 'brand', 'shiloh-mark-512.png'], ['public', 'assets', 'pwa', 'shiloh-pwa-512.png']],
    [['public', 'assets', 'brand', 'shiloh-mark-maskable-512.png'], ['public', 'assets', 'pwa', 'shiloh-pwa-maskable-512.png']],
    [['public', 'assets', 'brand', 'shiloh-apple-touch-180.png'], ['public', 'assets', 'pwa', 'shiloh-apple-touch-180.png']],
  ];
  for (const [publicAsset, approvedAsset] of pairs) {
    assert.deepEqual(asset(...publicAsset), asset(...approvedAsset), publicAsset.join('/'));
  }
});

test('Visit and the assistant use direct accommodation sources without Hello Heidelberg', () => {
  const visit = renderVisit();
  const guide = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'config', 'heidelbergGuide.js'),
    'utf8',
  );

  assert.match(visit, /Heidelberg Lodge/);
  assert.match(visit, /Suikerbosrand Guesthouse/);
  assert.match(visit, /Picanha Guesthouse/);
  assert.doesNotMatch(visit, /Hello Heidelberg/i);
  assert.doesNotMatch(guide, /Hello Heidelberg/i);
});

test('public pages include search and sharing metadata', () => {
  for (const html of [
    renderHome(catalogue),
    renderTreatments(catalogue),
    renderAbout(),
    renderContact(),
  ]) {
    assert.match(html, /rel="canonical" href="https:\/\/shilohmtc\.co\.za/);
    assert.match(html, /property="og:title"/);
    assert.match(html, /name="description"/);
  }
});

test('public privacy policy is accessible, specific to Shiloh, and linked site-wide', () => {
  const privacy = renderPrivacy();
  assert.match(privacy, /<h1>Your information, handled with care\.<\/h1>/);
  assert.match(privacy, /Meta and WhatsApp/);
  assert.match(privacy, /OpenAI/);
  assert.match(privacy, /outside South Africa/);
  assert.match(privacy, /policies\.google\.com\/terms/);
  assert.match(privacy, /policies\.google\.com\/privacy/);
  assert.match(privacy, /13 September 2026/);
  assert.match(privacy, /rel="canonical" href="https:\/\/shilohmtc\.co\.za\/privacy"/);
  assert.match(renderHome(catalogue), /href="\/privacy">Privacy policy<\/a>/);

  assert.match(renderVisit(), /Suikerbosrand Nature Reserve/);
  assert.match(renderVisit(), /Heidelberg Lodge/);
  assert.match(renderVisit(), /Picanha Guesthouse/);
  assert.match(renderVisit(), /current rates, availability and facilities/i);

  const websiteRoute = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'publicWebsite.js'),
    'utf8',
  );
  assert.match(websiteRoute, /router\.get\('\/privacy'/);
  assert.match(websiteRoute, /router\.get\('\/reviews\/google'/);
});

test('routing reuses canonical catalogue and leaves /book and /health intact', () => {
  const websiteRoute = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'publicWebsite.js'),
    'utf8',
  );
  const bookRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'book.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(websiteRoute, /getPublicServiceCatalogue/);
  assert.match(bookRoute, /router\.get\('\/book'/);
  assert.match(bookRoute, /renderBookingPage\(number, catalogue \|\| \[\], req\.query\.service\)/);
  assert.match(app, /publicWebsiteRoutes/);
  assert.match(app, /app\.get\("\/health"/);
  assert.match(app, /app\.use\("\/assets\/website", express\.static/);
  assert.doesNotMatch(websiteRoute, /INSERT|UPDATE|DELETE|pool\.query/);
});

test('public presentation escapes canonical catalogue text', () => {
  const html = renderTreatments([
    {
      ...catalogue[0],
      name: '<script>alert(1)</script>',
      category: 'Massage & Care',
      description: '<img src=x onerror=alert(2)>',
    },
  ]);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.match(html, /data-service-id="101"/);
  assert.match(html, /<h2>Massage<\/h2>/);
});

test('public surfaces preserve approved descriptions while keeping booking notes private', () => {
  const riskyCatalogue = [
    {
      id: 303,
      name: 'Neo Pelvic Therapy',
      category: 'Massage Treatments',
      duration: '30 min',
      price: 'R500',
      description: 'Clinical therapeutic care for pain recovery.',
      bookingNote: 'Medical review required.',
    },
  ];

  const home = renderHome(riskyCatalogue);
  const services = renderTreatments(riskyCatalogue);
  const booking = renderBookingPage('27836835433', riskyCatalogue);

  assert.doesNotMatch(home, /Clinical therapeutic care for pain recovery/);
  assert.match(services, /Clinical therapeutic care for pain recovery/);
  assert.match(booking, /Clinical therapeutic care for pain recovery/);

  for (const html of [home, services, booking, renderAbout(), renderContact(), renderPrivacy()]) {
    assert.doesNotMatch(html, /Medical review required/i);
    assert.doesNotMatch(html, /inside-shiloh-signature\.png/);
  }

  assert.match(services, /Neo Pelvic Session/);
  assert.match(services, /Body &amp; Wellness/);
  assert.match(booking, /Neo Pelvic Session/);
  assert.match(booking, /Shiloh Massage &amp; Aesthetic Clinic/);
});
