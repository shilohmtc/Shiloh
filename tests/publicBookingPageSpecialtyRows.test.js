const test = require('node:test');
const assert = require('node:assert/strict');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');

const catalogue = [
  { category: 'Massage', name: 'Massage', duration: '60 min', price: 'R500' },
  { category: 'Profosma Jet Plasma', name: 'Profosma Jet Plasma', duration: '90 min', price: 'R5500-R12500' },
  { category: 'Plasma Fibroblast Consultation', name: 'Plasma Fibroblast', duration: '30 min', price: 'R400' },
  { category: 'Plasma Fibroblast Prices', name: 'Plasma Price', duration: '30 min', price: 'R500' },
  { category: 'Ozone & Far Infrared', name: 'Ozone', duration: '30 min', price: 'R500' },
  { category: '1. SQT BioMicroneedling', name: 'SQT 1', duration: '60 min', price: 'R1000' },
  { category: '2. SQT BioMicroneedling', name: 'SQT 2', duration: '60 min', price: 'R1000' },
  { category: 'HIFU', name: 'HIFU', duration: '60 min', price: 'R1000' },
  { category: 'Neo Pelvic Therapy', name: 'Neo Pelvic Therapy', duration: '30 min', price: 'R650' },
  { category: 'Vaginal Tightening & Rejuvenation', name: 'Vaginal Tightening & Rejuvenation', duration: '45 min', price: 'R2500' },
];

test('specialty administrative categories become two clear public families', () => {
  const html = renderBookingPage('+27823269871', catalogue);
  assert.equal((html.match(/<h2>Advanced Aesthetics<\/h2>/g) || []).length, 1);
  assert.equal((html.match(/<h2>Body &amp; Wellness<\/h2>/g) || []).length, 1);
  assert.doesNotMatch(html, /<h2>(?:\d+\. SQT|Plasma Fibroblast Prices|Profosma Jet Plasma)<\/h2>/);
  assert.match(html, /<h2>Advanced Aesthetics<\/h2>[\s\S]*Profosma Jet Plasma[\s\S]*SQT 1[\s\S]*SQT 2/);
  assert.match(html, /<h2>Body &amp; Wellness<\/h2>[\s\S]*Ozone[\s\S]*Neo Pelvic Session/);
});
