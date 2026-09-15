const test = require('node:test');
const assert = require('node:assert/strict');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');

const catalogue = [
  { category: 'Massage', name: 'Massage', duration: '60 min', price: 'R500' },
  { category: 'Profosma Jet Plasma', name: 'Profosma Jet Plasma', duration: '90 min', price: 'R5500-R12500' },
  { category: 'Plasma Fibroblast Consultation', name: 'Plasma Fibroblast', duration: '30 min', price: 'R400' },
  { category: 'Plasma Fibroblast Prices', name: 'Plasma Fibroblast Price', duration: '60 min', price: 'R1000' },
  { category: 'Ozone & Far Infrared', name: 'Ozone', duration: '30 min', price: 'R500' },
  { category: '1. SQT BioMicroneedling', name: 'SQT 1', duration: '60 min', price: 'R1400' },
  { category: '2. SQT BioMicroneedling', name: 'SQT 2', duration: '60 min', price: 'R1800' },
  { category: 'HIFU', name: 'HIFU', duration: '60 min', price: 'R5500' },
  { category: 'Neo Pelvic Therapy', name: 'Neo Pelvic Therapy', duration: '30 min', price: 'R650' },
  { category: 'Vaginal Tightening & Rejuvenation', name: 'Vaginal Tightening', duration: '45 min', price: 'R2500' },
];

test('specialty rows follow the approved horizontal order with public wording', () => {
  const html = renderBookingPage('27823269871', catalogue);

  const profosma = html.indexOf('<h2>Profosma Jet Plasma</h2>');
  const consultation = html.indexOf('<h2>Plasma Fibroblast Consultation</h2>');
  assert.ok(profosma >= 0 && consultation > profosma);

  const prices = html.indexOf('<h2>Plasma Fibroblast Prices</h2>');
  const ozone = html.indexOf('<h2>Ozone &amp; Far Infrared</h2>');
  assert.ok(prices >= 0 && ozone > prices);

  const hifu = html.indexOf('<h2>HIFU</h2>');
  const vaginal = html.indexOf('<h2>Vaginal Tightening &amp; Rejuvenation</h2>');
  const neo = html.indexOf('<h2>Neo Pelvic Session</h2>');
  assert.ok(hifu >= 0 && vaginal > hifu && neo > vaginal);
  assert.doesNotMatch(html, /<h2>Neo Pelvic Therapy<\/h2>/);

  assert.match(html, /specialty-category-row--three/);
});
