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
const { renderSiteHeader } = require('../src/services/publicSiteChrome');

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

test('public Services renders canonical timing and price fields without creating booking authority', () => {
  const html = renderTreatments(catalogue);
  assert.match(html, /Deep Tissue Massage/);
  assert.match(html, /60 min/);
  assert.match(html, /R850/);
  assert.match(html, /Pedicures &amp; Foot Care/);
  assert.doesNotMatch(html, /Focused therapeutic massage/);
  assert.doesNotMatch(html, /wa\.me/);
  assert.doesNotMatch(html, /availability=/);
  assert.match(html, /data-public-treatment-catalogue/);
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

test('public pages include search and sharing metadata', () => {
  for (const html of [
    renderHome(catalogue),
    renderTreatments(catalogue),
    renderAbout(),
    renderContact(),
  ]) {
    assert.match(html, /rel="canonical" href="https:\/\/app\.shilohmtc\.co\.za/);
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
  assert.match(privacy, /13 September 2026/);
  assert.match(privacy, /rel="canonical" href="https:\/\/app\.shilohmtc\.co\.za\/privacy"/);
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
  assert.match(app, /publicWebsiteRoutes/);
  assert.match(app, /app\.get\("\/health"/);
  assert.doesNotMatch(websiteRoute, /INSERT|UPDATE|DELETE|pool\.query/);
});

test('public presentation escapes canonical catalogue text', () => {
  const html = renderTreatments([
    { ...catalogue[0], name: '<script>alert(1)</script>', category: 'Massage & Care' },
  ]);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Massage &amp; Care/);
});

test('public surfaces neutralize therapeutic branding, labels and claim-heavy descriptions', () => {
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

  const pages = [
    renderHome(riskyCatalogue),
    renderTreatments(riskyCatalogue),
    renderAbout(),
    renderContact(),
    renderPrivacy(),
    renderBookingPage('27836835433', riskyCatalogue),
  ];

  for (const html of pages) {
    assert.doesNotMatch(html, /\btherapy\b/i);
    assert.doesNotMatch(html, /\btherapeutic\b/i);
    assert.doesNotMatch(html, /\bclinical\b/i);
    assert.doesNotMatch(html, /pain recovery/i);
    assert.doesNotMatch(html, /Medical review required/i);
    assert.doesNotMatch(html, /inside-shiloh-signature\.png/);
  }

  assert.match(renderTreatments(riskyCatalogue), /Neo Pelvic Session/);
  assert.match(renderTreatments(riskyCatalogue), /Massage Services/);
  assert.match(renderBookingPage('27836835433', riskyCatalogue), /Neo Pelvic Session/);
  assert.match(renderBookingPage('27836835433', riskyCatalogue), /Shiloh Massage &amp; Aesthetic Clinic/);
});
