const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_SERVICE_CATEGORY_ORDER,
  groupPublicCatalogue,
  publicServicePriceFor,
  toPublicService,
} = require('../src/services/publicPresentation');

test('public taxonomy hides administrative labels without rewriting canonical identity', () => {
  const source = {
    id: 42,
    name: '1. SQT Rejuvenation BioMicroneedling',
    category: '1. SQT BioMicroneedling',
    duration: '90 min',
    price: 'R1785',
    description: 'Owner-approved service information.',
    bookingNote: 'Private operational note.',
  };
  const service = toPublicService(source);

  assert.equal(service.id, source.id);
  assert.equal(service.duration, source.duration);
  assert.equal(service.price, 'R1 785');
  assert.equal(service.canonicalPrice, source.price);
  assert.equal(service.canonicalName, source.name);
  assert.equal(service.canonicalCategory, source.category);
  assert.equal(service.canonicalDescription, source.description);
  assert.equal(service.description, source.description);
  assert.equal(service.bookingNote, '');
  assert.equal(service.category, 'Advanced Aesthetics');
  assert.equal(source.category, '1. SQT BioMicroneedling');
});

test('awkward catalogue names become concise public labels while canonical names remain intact', () => {
  const cases = [
    ['Plasma Fybroblast', 'Plasma Fibroblast Consultation'],
    ['Priced according to area', 'Plasma Fibroblast – By Area'],
    [
      '1. SQT Anti-Aging Rejuvenation BioMicroneedling + SQT Revitalizing Beauty BioMicroneedling',
      'SQT Rejuvenation & Revitalising BioMicroneedling',
    ],
    [
      '2. SQT Resurfacing BioMicroneedling + SQT Nourishing Hydrating BioMicroneedling',
      'SQT Resurfacing & Hydrating BioMicroneedling',
    ],
    ['VHC Standard Needling with Vitamins under Local Anesthetic.', 'VHC Vitamin Microneedling'],
    ['GF Needling with Growth Factors under Local Anesthetic', 'Growth Factor Microneedling'],
    ['Quick Relief: Back & Neck (45 min)', 'Quick Relief – Back & Neck'],
  ];

  for (const [canonicalName, publicName] of cases) {
    const service = toPublicService({ name: canonicalName, category: 'Services' });
    assert.equal(service.name, publicName);
    assert.equal(service.canonicalName, canonicalName);
  }
});

test('public prices use consistent rand spacing and range punctuation without changing source values', () => {
  assert.equal(publicServicePriceFor('R1785-R2585'), 'R1 785–R2 585');
  assert.equal(publicServicePriceFor('1900 - 6500'), 'R1 900–R6 500');
  assert.equal(publicServicePriceFor(' R 1950 - R 2200'), 'R1 950–R2 200');
  assert.equal(publicServicePriceFor('R725.50'), 'R725.50');
  assert.equal(publicServicePriceFor('Price on consultation'), 'Price on consultation');

  const service = toPublicService({ name: 'Waxing', category: 'Facial Waxing', price: 'R80-R500' });
  assert.equal(service.price, 'R80–R500');
  assert.equal(service.canonicalPrice, 'R80-R500');
});

test('public families follow one client-friendly order regardless of source order', () => {
  const catalogue = [
    { id: 1, name: 'SQT', category: '2. SQT BioMicroneedling' },
    { id: 2, name: 'Foot Care', category: 'Pedicures & Foot Care' },
    { id: 3, name: 'Swedish Massage', category: 'Massage' },
    { id: 4, name: 'Pelvic Floor Strengthening', category: 'Neo Pelvic Therapy' },
    { id: 5, name: 'Hydrating Facial', category: 'Facials' },
    { id: 6, name: 'Eyeliner', category: 'Permanent Makeup' },
    { id: 7, name: 'Consultation', category: 'Services' },
  ];

  const groups = groupPublicCatalogue(catalogue);
  assert.deepEqual([...groups.keys()], PUBLIC_SERVICE_CATEGORY_ORDER);
  assert.deepEqual([...groups.values()].flat().map((service) => service.id), [3, 2, 5, 1, 6, 4, 7]);
});

test('legacy spelling variants and generic services receive stable public families', () => {
  const groups = groupPublicCatalogue([
    { name: 'Plasma Fybroblast', category: 'Plasma Fybroblast Prices' },
    { name: 'Brow Shape', category: 'Services' },
    { name: 'Couples Massage', category: 'Services' },
  ]);

  assert.deepEqual([...groups.keys()], ['Massage', 'Facials & Skin', 'Advanced Aesthetics']);
});
