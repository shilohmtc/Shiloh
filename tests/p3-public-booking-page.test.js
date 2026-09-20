const test = require('node:test');
const assert = require('node:assert/strict');
const { BOOKING_MESSAGE, buildWhatsAppBookingUrl, renderBookingPage } = require('../src/services/publicBookingPage');

test('public booking page builds an official WhatsApp booking intent', () => {
  const url = buildWhatsAppBookingUrl('+27 66 239 9138');
  assert.equal(url, `https://wa.me/27662399138?text=${encodeURIComponent(BOOKING_MESSAGE)}`);
  assert.match(url, /^https:\/\/wa\.me\/27662399138\?text=/);
});

test('public booking page is a real landing page and does not auto-redirect to WhatsApp', () => {
  const html = renderBookingPage('27662399138');
  assert.match(html, /<title>Book with Shiloh/);
  assert.match(html, /Your appointment starts with Shiloh/);
  assert.match(html, /Continue with Shiloh on WhatsApp/);
  assert.match(html, /https:\/\/wa\.me\/27662399138/);
  assert.doesNotMatch(html, /http-equiv=["']refresh/i);
  assert.doesNotMatch(html, /window\.location|location\.href/i);
});

test('public booking page fails closed with warm help when WhatsApp is unavailable', () => {
  assert.equal(buildWhatsAppBookingUrl(''), null);
  const html = renderBookingPage(
    null,
    [{ id: 7, name: 'Full Body Swedish', category: 'Massage', duration: '60 min', price: 'R590' }],
    7,
  );
  assert.match(html, /WhatsApp is taking a short pause/);
  assert.match(html, /Your choice is safe here/);
  assert.match(html, /mailto:info@shilohmtc\.co\.za\?subject=Help%20with%20Full%20Body%20Swedish/);
  assert.match(html, /email Shiloh for help/);
  assert.doesNotMatch(html, /https:\/\/wa\.me\//);
});
