const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWhatsAppBookingUrl, renderBookingPage, renderCatalogue } = require('../src/services/publicBookingPage');

test('service booking handoff preselects the canonical service name', () => {
  const url = buildWhatsAppBookingUrl('+27 82 326 9871', 'Full Body Swedish');
  assert.match(url, /^https:\/\/wa\.me\/27823269871\?text=/);
  assert.match(decodeURIComponent(url), /I'd like to book Full Body Swedish\./);
});

test('catalogue renders public service metadata grouped by category', () => {
  const html = renderCatalogue('+27823269871', [{ id: 1, name: 'Full Body Swedish', category: 'Massage', duration: '90 min', price: 'R590', description: 'A relaxing full body massage.', bookingNote: '' }]);
  assert.match(html, /Massage/);
  assert.match(html, /Full Body Swedish/);
  assert.match(html, /90 min/);
  assert.match(html, /R590/);
  assert.match(html, /Book this service/);
  assert.doesNotMatch(html, /A relaxing full body massage/);
});

test('public catalogue query is limited to active services with an active client-bookable practitioner', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/publicServiceCatalogue.js'), 'utf8');
  assert.match(source, /s\.status\s*=\s*'active'/i);
  assert.match(source, /st\.status\s*=\s*'active'/i);
  assert.match(source, /st\.resource_type\s*=\s*'practitioner'/i);
  assert.match(source, /st\.client_bookable\s*=\s*TRUE/i);
});

test('public page uses only committed Phase 1 image references and does not claim availability early', () => {
  const html = renderBookingPage('+27823269871', []);
  assert.match(html, /\/assets\/booking\/reception\.svg/);
  assert.doesNotMatch(html, /treatment-room\.webp|consultation-room\.webp|pedicure-lounge\.webp|clinic-collage\.webp/);
  assert.match(html, /Availability is confirmed when Shiloh completes your booking/);
  assert.doesNotMatch(html, /available today|available now/i);
});
