const assert = require('node:assert/strict');
const test = require('node:test');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');

const catalogue = [
  { category: 'Massage', name: 'Massage A', duration: '60 min', price: 'R500' },
  { category: 'Pedicures & Foot Care', name: 'Pedicure A', duration: '60 min', price: 'R500' },
  { category: 'Facials', name: 'Facial A', duration: '60 min', price: 'R500' },
  { category: 'Permanent Makeup', name: 'PMU A', duration: '60 min', price: 'R500' },
  { category: 'Microneedling', name: 'Needling A', duration: '60 min', price: 'R500' },
];

test('catalogue categories stay together with one closing brand signature', () => {
  const html = renderBookingPage('27823269871', catalogue);
  assert.equal((html.match(/<section class="inside-shiloh-break"/g) || []).length, 1);
  const signature = html.indexOf('<section class="inside-shiloh-break"');
  for (let i = 0; i < catalogue.length; i += 1) {
    const category = html.indexOf(`<section class="category" id="category-${i}">`);
    assert.ok(category >= 0 && category < signature, 'each category precedes the closing signature');
  }
  assert.ok(signature < html.indexOf('<section class="clinic">'));
  assert.doesNotMatch(html, /<span>Shiloh services<\/span>|<div class="eyebrow">Our services<\/div>/);
  assert.match(html, /Personal care\. Thoughtful touch\./);
  assert.doesNotMatch(html, /Clinical care\. Personal touch\. Beautifully you\./);
  assert.doesNotMatch(html, /<section class="clinic-gallery"/);
});

test('unavailable catalogue does not add an empty branding interruption', () => {
  const html = renderBookingPage('27823269871', []);
  assert.doesNotMatch(html, /<section class="inside-shiloh-break"/);
  assert.match(html, /service catalogue is temporarily unavailable/);
});
