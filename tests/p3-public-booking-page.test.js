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
  assert.match(html, /href="\/my-shiloh\/book"[^>]*>Install or open My Shiloh to book/);
  assert.match(html, /sign in with a passkey or SMS/);
  assert.match(html, /assistant inside My Shiloh/);
  assert.match(html, /Need a person\? <strong>Message Reception<\/strong>/);
  assert.match(html, /https:\/\/wa\.me\/27662399138/);
  assert.doesNotMatch(html, /http-equiv=["']refresh/i);
  assert.doesNotMatch(html, /window\.location|location\.href/i);
});

test('public booking remains available in My Shiloh when WhatsApp help is unavailable', () => {
  assert.equal(buildWhatsAppBookingUrl(''), null);
  const html = renderBookingPage(
    null,
    [{ id: 7, name: 'Full Body Swedish', category: 'Massage', duration: '60 min', price: 'R590' }],
    7,
  );
  assert.match(html, /Continue with this service in My Shiloh/);
  assert.match(html, /Choose it again in My Shiloh if your phone opens a new installation/);
  assert.match(html, /href="\/my-shiloh\/book\?service=7"/);
  assert.doesNotMatch(html, /https:\/\/wa\.me\//);
});

test('website offers signed-in Reception planning independently of WhatsApp', () => {
  for (const number of ['27662399138', null]) {
    const html = renderBookingPage(number);
    assert.match(html, /data-website-planning-entry/);
    assert.match(html, /href="\/my-shiloh\/request">Plan a flexible or group visit in My Shiloh/);
    assert.match(html, /Sign in to send your plans to Reception/);
    assert.match(html, /No appointment is confirmed until Reception arranges it with you/);
  }
});

test('selected public service carries its canonical ID into the Reception planning doorway', () => {
  const catalogue = [{ id: 101, name: 'Deep Tissue Massage', category: 'Massage', duration: '60 min', price: 'R850' }];
  assert.match(renderBookingPage('27662399138', catalogue, '101'), /href="\/my-shiloh\/request\?service=101">Plan a flexible or group visit/);
  assert.match(renderBookingPage('27662399138', catalogue, '999'), /href="\/my-shiloh\/request">Plan a flexible or group visit/);
});
