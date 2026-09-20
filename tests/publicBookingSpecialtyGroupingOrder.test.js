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

test('public category order stays stable while service wording remains safe', () => {
  const html = renderBookingPage('27823269871', catalogue);

  const massage = html.indexOf('<h2>Massage</h2>');
  const advanced = html.indexOf('<h2>Advanced Aesthetics</h2>');
  const wellness = html.indexOf('<h2>Body &amp; Wellness</h2>');
  assert.ok(massage >= 0 && advanced > massage && wellness > advanced);
  assert.match(html, /Neo Pelvic Session/);
  assert.doesNotMatch(html, /Neo Pelvic Therapy/);
  assert.doesNotMatch(html, /<h2>1\. SQT BioMicroneedling<\/h2>/);
  assert.doesNotMatch(html, /<h2>Plasma Fibroblast Prices<\/h2>/);
});
