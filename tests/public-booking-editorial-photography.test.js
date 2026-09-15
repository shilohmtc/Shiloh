const test = require('node:test');
const assert = require('node:assert/strict');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');

test('booking page uses the neutral Inside Shiloh signature treatment', () => {
  const catalogue = [
    { category: 'Massage', name: 'Massage 1', duration: '60 min', price: 'R500' },
    { category: 'Pedicures & Foot Care', name: 'Pedicure 1', duration: '60 min', price: 'R500' },
    { category: 'Facials', name: 'Facial 1', duration: '60 min', price: 'R500' },
    { category: 'Permanent Makeup', name: 'PMU 1', duration: '60 min', price: 'R500' },
    { category: 'Microneedling', name: 'Needling 1', duration: '60 min', price: 'R500' },
  ];
  const html = renderBookingPage('+27823269871', catalogue);
  const signatures = html.match(/class="inside-shiloh-break"/g) || [];
  const artwork = html.match(/src="\/assets\/booking\/inside-shiloh-signature\.png"/g) || [];
  assert.equal(signatures.length, 3);
  assert.equal(artwork.length, 0);
  assert.match(html, /Inside Shiloh/);
  assert.match(html, /Personal care\. Thoughtful touch\./);
  assert.match(html, /Shiloh Massage &amp; Aesthetic Clinic/);
  assert.doesNotMatch(html, /Clinical care\. Personal touch\. Beautifully you\./);
  assert.doesNotMatch(html, /inside-shiloh-signature\.png/);
  assert.doesNotMatch(html, /clinic-collage-bg\.jpg/);
  assert.doesNotMatch(html, /filter:blur\(5px\)/);
  assert.doesNotMatch(html, /class="collage-atmosphere"/);
  assert.doesNotMatch(html, /<section class="clinic-gallery"/);
  const firstBreak = html.indexOf('class="inside-shiloh-break"');
  const massage = html.indexOf('id="category-0"');
  assert.ok(firstBreak < massage);
});

test('Inside Shiloh signatures are omitted when Massage is not present', () => {
  const catalogue = [{ category: 'Facials', name: 'Facial', duration: '60 min', price: 'R500' }];
  const html = renderBookingPage('+27823269871', catalogue);
  assert.doesNotMatch(html, /class="inside-shiloh-break"/);
});

test('visual signatures do not change booking availability semantics', () => {
  const html = renderBookingPage('+27823269871', []);
  assert.match(html, /Availability is confirmed when Shiloh completes your booking/);
  assert.doesNotMatch(html, /available today|available now/i);
});
