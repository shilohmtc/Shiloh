const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildWhatsAppBookingUrl,
  resolveSelectedPublicService,
  renderBookingPage,
  renderCatalogue,
} = require('../src/services/publicBookingPage');

test('service booking handoff preselects the canonical service name', () => {
  const url = buildWhatsAppBookingUrl('+27 82 326 9871', 'Full Body Swedish');
  assert.match(url, /^https:\/\/wa\.me\/27823269871\?text=/);
  assert.match(decodeURIComponent(url), /I'd like to book Full Body Swedish\./);
});

test('catalogue renders approved public service descriptions but not private booking notes', () => {
  const html = renderCatalogue('+27823269871', [{ id: 1, name: 'Full Body Swedish', category: 'Massage', duration: '90 min', price: 'R590', description: 'A relaxing full body massage.', bookingNote: 'Private operational note.' }]);
  assert.match(html, /Massage/);
  assert.match(html, /Full Body Swedish/);
  assert.match(html, /90 min/);
  assert.match(html, /R590/);
  assert.match(html, /Book this service/);
  assert.match(html, /A relaxing full body massage/);
  assert.doesNotMatch(html, /Private operational note/);
});

test('public catalogue query is limited to active services with an active client-bookable practitioner', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/publicServiceCatalogue.js'), 'utf8');
  assert.match(source, /s\.status\s*=\s*'active'/i);
  assert.match(source, /st\.status\s*=\s*'active'/i);
  assert.match(source, /st\.resource_type\s*=\s*'practitioner'/i);
  assert.match(source, /st\.client_bookable\s*=\s*TRUE/i);
  assert.match(source, /s\.customer_description/i);
  assert.doesNotMatch(source, /s\.booking_note/i);
});

test('public page uses only committed Phase 1 image references and does not claim availability early', () => {
  const html = renderBookingPage('+27823269871', []);
  assert.match(html, /\/assets\/booking\/reception\.svg/);
  assert.doesNotMatch(html, /treatment-room\.webp|consultation-room\.webp|pedicure-lounge\.webp|clinic-collage\.webp/);
  assert.match(html, /Availability is confirmed when Shiloh completes your booking/);
  assert.doesNotMatch(html, /available today|available now/i);
});


test('canonical service ID carries the public selection into booking and WhatsApp', () => {
  const catalogue = [
    {
      id: 42,
      name: 'Neo Pelvic Therapy',
      category: 'Massage Treatments',
      duration: '30 min',
      price: 'R500',
    },
  ];
  const selected = resolveSelectedPublicService(catalogue, '42');
  assert.equal(selected.id, 42);
  assert.equal(selected.name, 'Neo Pelvic Session');

  const html = renderBookingPage('+27 82 326 9871', catalogue, '42');
  assert.match(html, /Your choice is saved/);
  assert.match(html, /id="service-42" class="service-card selected"/);
  assert.match(html, /data-selected-service="true"/);
  assert.match(html, /Continue with this service/);
  const selectedUrl = html.match(/class="cta" href="([^"]+)"/)?.[1];
  assert.ok(selectedUrl);
  assert.match(
    decodeURIComponent(selectedUrl.replaceAll('&#039;', "'")),
    /I'd like to book Neo Pelvic Session\./,
  );
  assert.doesNotMatch(html, /\btherapy\b/i);
});

test('unknown or unsafe service IDs never create a selected booking state', () => {
  const catalogue = [
    { id: 42, name: 'Full Body Swedish', category: 'Massage', duration: '60 min', price: 'R590' },
  ];
  assert.equal(resolveSelectedPublicService(catalogue, '<script>'), null);
  assert.equal(resolveSelectedPublicService(catalogue, '999'), null);
  const html = renderBookingPage('+27 82 326 9871', catalogue, '<script>');
  assert.doesNotMatch(html, /Your choice is saved/);
  assert.doesNotMatch(html, /data-selected-service="true"/);
});
