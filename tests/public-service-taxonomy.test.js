const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_SERVICE_CATEGORY_ORDER,
  groupPublicCatalogue,
  toPublicService,
} = require('../src/services/publicPresentation');

test('public taxonomy hides administrative labels without rewriting canonical identity', () => {
  const source = {
    id: 42,
    name: '1. SQT Rejuvenation BioMicroneedling',
    category: '1. SQT BioMicroneedling',
    duration: '90 min',
    price: 'R1785',
  };
  const service = toPublicService(source);

  assert.equal(service.id, source.id);
  assert.equal(service.duration, source.duration);
  assert.equal(service.price, source.price);
  assert.equal(service.canonicalName, source.name);
  assert.equal(service.canonicalCategory, source.category);
  assert.equal(service.category, 'Advanced Aesthetics');
  assert.equal(source.category, '1. SQT BioMicroneedling');
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
