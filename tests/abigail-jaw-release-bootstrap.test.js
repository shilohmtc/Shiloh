const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'src', 'services', 'abigailJawReleaseMappingBootstrap.js'), 'utf8');
const patch = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'abigailJawReleaseMappingPatch.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('Jaw Release startup bootstrap applies migration 069 with checksum tracking and explicit post-state', () => {
  assert.match(bootstrap, /069_remove_abigail_jaw_release_mapping\.sql/);
  assert.match(bootstrap, /schema_migrations/);
  assert.match(bootstrap, /Migration \$\{MIGRATION_FILENAME\} has changed after being applied/);
  assert.match(bootstrap, /abigailMapped: false/);
  assert.match(bootstrap, /remainingMappings/);
  assert.match(bootstrap, /linkedAppointmentCount/);
});

test('Jaw Release verification stays exact-service and exact-Abigail scoped', () => {
  assert.match(bootstrap, /b5c96105-f534-406d-89ec-68e78c65cf8b/);
  assert.match(bootstrap, /Upper Back, Neck & Jaw Release/);
  assert.match(bootstrap, /LOWER\(display_name\) = 'abigail'/);
  assert.match(bootstrap, /Non-Abigail practitioner mappings/);
  assert.match(bootstrap, /Jaw Release appointment history changed outside the approved correction/);
});

test('startup patch runs the Abigail correction after the established Christel catalogue correction', () => {
  const originalIndex = patch.indexOf('originalEnsureChristelServiceCatalogueCorrection(...args)');
  const correctionIndex = patch.indexOf('ensureAbigailJawReleaseMappingCorrection()');
  assert.ok(originalIndex >= 0);
  assert.ok(correctionIndex > originalIndex);
  assert.match(patch, /Abigail Jaw Release mapping verified/);
});

test('production and dev do not attach the mutating Jaw Release patch to ordinary startup', () => {
  for (const scriptName of ['start', 'dev']) {
    const script = pkg.scripts[scriptName];
    assert.doesNotMatch(script, /adminUxStandardizationPatch/);
    assert.doesNotMatch(script, /abigailJawReleaseMappingPatch/);
    assert.match(script, /scripts\/verify-migrations\.js/);
  }
});
