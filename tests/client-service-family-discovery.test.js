const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const familyPath = path.join(__dirname, '..', 'src', 'services', 'clientServiceFamilyDiscovery.js');
const webhookPath = path.join(__dirname, '..', 'src', 'controllers', 'webhookController.js');
const appPath = path.join(__dirname, '..', 'app.js');
const familySource = fs.readFileSync(familyPath, 'utf8');
const webhookSource = fs.readFileSync(webhookPath, 'utf8');
const appSource = fs.readFileSync(appPath, 'utf8');
const { CLIENT_FAMILY_COPY } = require('../src/config/clientFamilyCopy');
const { presentClientFamilyResult } = require('../src/presentation/clientFamilyPresentation');
const {
  FAMILY_RULES,
  familyFilterSql,
  familyServicesInteractive,
  massagePractitionersInteractive,
} = require(familyPath);

test('service-family ownership is explicit and client-facing', () => {
  assert.deepEqual(FAMILY_RULES, {
    beauty: { title: 'Beauty & Aesthetics', practitioner: null },
    massage: { title: 'Massage', practitioner: null },
    lymphatic: { title: 'Lymphatic Drainage', practitioner: 'Abigail' },
    pedicure: { title: 'Elim MediHeel Pedicures', practitioner: 'Christel' },
  });
});

test('family treatment prompt is client-friendly at the presentation boundary', () => {
  assert.equal(CLIENT_FAMILY_COPY.treatmentPrompt, 'Choose the treatment you’d like to book. 🌿');
  const raw = familyServicesInteractive('beauty', [{ id: 1, name: 'Facial', duration_minutes: 60, price: 500 }], 1);
  const view = presentClientFamilyResult({ handled: true, interactive: raw }).interactive;
  assert.match(view.body, /Beauty & Aesthetics/);
  assert.match(view.body, /Choose the treatment you’d like to book\. 🌿/);
  assert.doesNotMatch(view.body, /CRM|eligible|active treatment/i);
  assert.match(appSource, /presentClientFamilyResult/);
  assert.match(appSource, /processClientServiceFamilyMessage/);
});

test('family queries remain CRM-backed, active-only and client-bookable', () => {
  assert.match(familySource, /JOIN staff_services ss ON ss\.service_id = s\.id/);
  assert.match(familySource, /s\.status = 'active'/);
  assert.match(familySource, /st\.status = 'active'/);
  assert.match(familySource, /st\.client_bookable = TRUE/);
});

test('beauty is tenant-scoped and excludes massage lymphatic and pedicure rows', () => {
  const sql = familyFilterSql('beauty');
  assert.match(sql, /st\.business_role = 'tenant_practitioner'/);
  assert.match(sql, /<> 'massage'/);
  assert.match(sql, /NOT LIKE '%lymphatic%'/);
  assert.match(sql, /NOT LIKE '%pedicur%'/);
  assert.match(sql, /NOT LIKE '%mediheel%'/);
  assert.match(sql, /NOT LIKE '%elim%'/);
});

test('massage permits only Christel or Abigail and excludes lymphatic treatments', () => {
  const sql = familyFilterSql('massage');
  assert.match(sql, /= 'massage'/);
  assert.match(sql, /IN \('christel', 'abigail'\)/);
  assert.match(sql, /NOT LIKE '%lymphatic%'/);
});

test('lymphatic is Abigail-only even if stale CRM mappings exist for another practitioner', () => {
  const sql = familyFilterSql('lymphatic');
  assert.match(sql, /LIKE '%lymphatic%'/);
  assert.match(sql, /LOWER\(st\.display_name\) = 'abigail'/);
  assert.match(familySource, /family === 'lymphatic' \? \['abigail'\]/);
});

test('Elim MediHeel Pedicures is Christel-only and limited to MediHeel/Elim service names', () => {
  const sql = familyFilterSql('pedicure');
  assert.match(sql, /LOWER\(st\.display_name\) = 'christel'/);
  assert.match(sql, /medi-heel/);
  assert.match(sql, /mediheel/);
  assert.match(sql, /elim/);
  assert.doesNotMatch(sql, /LOWER\(s\.name\) LIKE '%pedicur%'/);
  assert.match(familySource, /family === 'beauty' \? "st\.business_role = 'tenant_practitioner'"/);
});

test('family service lists use stable IDs and stay inside Meta row limits', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Treatment ${index + 1}`, duration_minutes: 60, price: 500 }));
  const view = familyServicesInteractive('massage', rows, 1);
  assert.equal(view.type, 'list');
  assert.ok(view.rows.length <= 10);
  assert.equal(view.rows[0].id, 'client_family_massage_service_1');
  assert.equal(view.rows.at(-1).id, 'client_family_massage_page_2');
});

test('massage practitioner chooser exposes Any available plus only supplied eligible staff', () => {
  const view = massagePractitionersInteractive({ id: 1, name: 'Swedish Massage' }, [
    { id: 10, display_name: 'Christel' },
    { id: 11, display_name: 'Abigail' },
  ]);
  assert.deepEqual(view.rows.map((row) => row.id), ['client_practitioner_any', 'client_practitioner_10', 'client_practitioner_11']);
  assert.doesNotMatch(JSON.stringify(view), /tenant_practitioner/);
});

test('family router gets first chance before generic client discovery and booking fallthrough', () => {
  const family = webhookSource.indexOf('processClientServiceFamilyMessage(from,text)');
  const discovery = webhookSource.indexOf('processClientDiscoveryMessage(from,text)');
  const booking = webhookSource.lastIndexOf('processBookingMessage(from,text)');
  assert.ok(family >= 0 && discovery >= 0 && booking >= 0);
  assert.ok(family < discovery);
  assert.ok(discovery < booking);
});
