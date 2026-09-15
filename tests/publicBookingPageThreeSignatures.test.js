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

test('renders exactly three Inside Shiloh signatures at catalogue boundaries', () => {
  const html = renderBookingPage('27823269871', catalogue);
  const signatures = html.match(/<section class="inside-shiloh-break"/g) || [];
  assert.equal(signatures.length, 3);

  const firstSignature = html.indexOf('<section class="inside-shiloh-break"');
  const massage = html.indexOf('<section class="category" id="category-0">');
  assert.ok(firstSignature < massage, 'first signature should appear above Massage');

  const middleCategory = html.indexOf('<section class="category" id="category-2">');
  const secondSignature = html.indexOf('<section class="inside-shiloh-break"', firstSignature + 1);
  assert.ok(secondSignature < middleCategory, 'middle signature should appear before the midpoint category');

  const thirdSignature = html.lastIndexOf('<section class="inside-shiloh-break"');
  const confidence = html.indexOf('<section class="clinic">');
  assert.ok(thirdSignature < confidence, 'final signature should appear before the confidence section');

  assert.match(html, /Personal care\. Thoughtful touch\./);
  assert.doesNotMatch(html, /Clinical care\. Personal touch\. Beautifully you\./);
  assert.doesNotMatch(html, /<section class="clinic-gallery"/);
});
