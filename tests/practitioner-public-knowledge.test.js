const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const practitionerPath = path.join(__dirname, '..', 'src', 'services', 'practitionerKnowledge.js');
const aiPath = path.join(__dirname, '..', 'src', 'services', 'ai.js');
const orchestratorPath = path.join(__dirname, '..', 'src', 'services', 'orchestrator.js');
const migrationPath = path.join(__dirname, '..', 'migrations', '044_practitioner_customer_profiles.sql');
const titleMigrationPath = path.join(__dirname, '..', 'migrations', '045_approved_practitioner_titles.sql');
const source = fs.readFileSync(practitionerPath, 'utf8');
const ai = fs.readFileSync(aiPath, 'utf8');
const orchestrator = fs.readFileSync(orchestratorPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');
const titleMigration = fs.readFileSync(titleMigrationPath, 'utf8');
const { formatPractitioner } = require(practitionerPath);

test('public practitioner metadata is stored in a separate approval-gated CRM table', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_customer_profiles/);
  assert.match(migration, /is_approved BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /approval_source TEXT/);
  assert.match(migration, /approved_at TIMESTAMPTZ/);
  assert.match(migration, /approved_specialties JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS staff_customer_profiles/);
});

test('approved client-facing titles cover the three treatment practitioners and update existing Marietjie metadata', () => {
  assert.match(titleMigration, /LOWER\(display_name\) IN \('christel', 'abigail', 'marietjie'\)/);
  assert.match(titleMigration, /WHEN 'marietjie' THEN 'Esthetician'/);
  assert.match(titleMigration, /ELSE 'Massage practitioner'/);
  assert.match(titleMigration, /ON CONFLICT \(staff_id\) DO UPDATE SET/);
  assert.match(titleMigration, /is_approved = TRUE/);
  assert.match(source, /WHEN 'marietjie' THEN 'Esthetician'/);
  assert.match(source, /ELSE 'Massage practitioner'/);
  assert.match(source, /business_direction_2026-08-12_practitioner_titles/);
});

test('AI practitioner knowledge is restricted to active client-bookable practitioners and active services', () => {
  assert.match(source, /st\.status = 'active'/);
  assert.match(source, /st\.resource_type = 'practitioner'/);
  assert.match(source, /st\.client_bookable = TRUE/);
  assert.match(source, /LEFT JOIN services s ON s\.id = ss\.service_id AND s\.status = 'active'/);
  assert.doesNotMatch(source, /Savanna|Pieter/);
});

test('unapproved profile values are never exposed or inferred while mapped services remain visible', () => {
  const rendered = formatPractitioner({
    display_name: 'Unapproved practitioner',
    public_title: 'Invented title',
    short_bio: 'Invented bio',
    approved_specialties: ['Invented specialty'],
    profile_approved: false,
    active_services: [{ id: 1, name: 'Mapped Service' }],
  });
  assert.match(rendered, /Practitioner: Unapproved practitioner/);
  assert.match(rendered, /Public profile status: not approved/);
  assert.match(rendered, /Active CRM-mapped services: Mapped Service/);
  assert.doesNotMatch(rendered, /Invented title|Invented bio|Invented specialty/);
});

test('approved profile fields are exposed exactly without deriving extra credentials', () => {
  const christel = formatPractitioner({
    display_name: 'Christel',
    public_title: 'Massage practitioner',
    short_bio: null,
    approved_specialties: [],
    profile_approved: true,
    active_services: [{ id: 2, name: 'Swedish Massage' }],
  });
  const marietjie = formatPractitioner({
    display_name: 'Marietjie',
    public_title: 'Esthetician',
    short_bio: null,
    approved_specialties: [],
    profile_approved: true,
    active_services: [{ id: 3, name: 'Mapped Aesthetic Service' }],
  });
  assert.match(christel, /Approved public title: Massage practitioner/);
  assert.match(christel, /Active CRM-mapped services: Swedish Massage/);
  assert.match(marietjie, /Approved public title: Esthetician/);
  assert.match(marietjie, /Active CRM-mapped services: Mapped Aesthetic Service/);
  assert.doesNotMatch(`${christel}\n${marietjie}`, /qualified|certified|years|expert/i);
});

test('practitioner CRM knowledge stays ahead of clinic FAQ and legacy retrieval alongside active catalogue', () => {
  assert.match(ai, /getPractitionerKnowledge/);
  assert.match(ai, /getActiveCatalogueKnowledge\(\)/);
  assert.match(ai, /getPractitionerKnowledge\(\)/);
  assert.match(ai, /clinicFaqKnowledge/);
  assert.match(ai, /\[activeCatalogue, practitionerKnowledge, clinicFaqKnowledge, heidelbergGuideKnowledge, \.\.\.knowledge\]\.filter\(Boolean\)/);
});

test('orchestrator makes mappings authoritative but forbids qualification inference', () => {
  assert.match(orchestrator, /Shiloh CRM practitioner mapping/);
  assert.match(orchestrator, /Use the current CRM practitioner\/service mapping/);
  assert.match(orchestrator, /A service mapping proves only that a practitioner is currently mapped to perform that service/);
  assert.match(orchestrator, /Public practitioner titles, bios, qualifications, credentials, experience claims and specialties must come only from explicitly approved public-profile fields/);
  assert.match(orchestrator, /public profile is marked not approved.*do not have approved information/s);
});

test('profile bootstrap only mutates the dedicated customer-profile table', () => {
  assert.doesNotMatch(source, /UPDATE staff\s/i);
  assert.doesNotMatch(source, /INSERT INTO staff\s*\(/i);
  assert.doesNotMatch(source, /UPDATE staff_services/i);
  assert.doesNotMatch(source, /INSERT INTO staff_services/i);
  assert.match(source, /INSERT INTO staff_customer_profiles/);
});
