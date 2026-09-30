const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  clientFacingPractitionerLabel,
  clientFacingPractitionerRole,
} = require('../src/services/clientBookingStaffGuard');

test('client practitioner directory uses approved professional role descriptions within WhatsApp limits', () => {
  const cases = [
    ['Christel', 'Christel · Massage', 'Massage Practitioner'],
    ['Abigail', 'Abigail · Massage', 'Massage Practitioner'],
  ];

  for (const [name, label, role] of cases) {
    assert.equal(clientFacingPractitionerLabel(name), label);
    assert.equal(clientFacingPractitionerRole(name), role);
    assert.ok(label.length <= 24, `${label} must fit the WhatsApp list-row title limit`);
    assert.ok(role.length <= 72, `${role} must fit the WhatsApp list-row description limit`);
  }
});

test('general practitioner directory no longer exposes internal client-bookable wording', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/clientDiscoveryMenu.js'),
    'utf8'
  );
  const start = source.indexOf('async function practitionersInteractive()');
  const end = source.indexOf('async function findClientBookableService', start);
  const directorySource = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'practitioner directory function must remain present');
  assert.doesNotMatch(directorySource, /Client-bookable Shiloh practitioner/);
  assert.match(directorySource, /row\.client_role/);
});
