const test = require('node:test');
const assert = require('node:assert/strict');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');

test('booking page keeps its service catalogue without the repeated Inside Shiloh panel', () => {
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
  assert.equal(signatures.length, 0);
  assert.equal(artwork.length, 0);
  assert.doesNotMatch(html, /Inside Shiloh/);
  assert.doesNotMatch(html, /Personal care\. Thoughtful touch\./);
  assert.match(html, /Shiloh Massage &amp; Aesthetic Clinic/);
  assert.doesNotMatch(html, /Clinical care\. Personal touch\. Beautifully you\./);
  assert.doesNotMatch(html, /inside-shiloh-signature\.png/);
  assert.doesNotMatch(html, /clinic-collage-bg\.jpg/);
  assert.doesNotMatch(html, /filter:blur\(5px\)/);
  assert.doesNotMatch(html, /class="collage-atmosphere"/);
  assert.doesNotMatch(html, /<section class="clinic-gallery"/);
  assert.match(html, /id="category-0"/);
  assert.match(html, /class="clinic"/);
});

test('a catalogue without Massage also omits the repeated brand panel', () => {
  const catalogue = [{ category: 'Facials', name: 'Facial', duration: '60 min', price: 'R500' }];
  const html = renderBookingPage('+27823269871', catalogue);
  assert.equal((html.match(/class="inside-shiloh-break"/g) || []).length, 0);
});

test('footer cleanup preserves booking guidance and unavailable catalogue semantics', () => {
  const html = renderBookingPage('+27823269871', []);
  assert.match(html, /Choose what suits you, then Shiloh will help you find an eligible practitioner and an available time/);
  assert.match(html, /service catalogue is temporarily unavailable/);
  assert.doesNotMatch(html, /Availability is confirmed when Shiloh completes your booking/);
  assert.doesNotMatch(html, /available today|available now/i);
});
