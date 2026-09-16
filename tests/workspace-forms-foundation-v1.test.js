const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = source('migrations/131_workspace_consultation_forms_foundation.sql');
const formsServiceSource = source('src/services/workspaceForms.js');
const formsRouteSource = source('src/routes/workspaceForms.js');
const calendarRouteSource = source('src/routes/calendar.js');
const navigationSource = source('src/services/workspaceNavigation.js');
const iconSource = source('src/presentation/workspaceIconClient.js');
const lucideSource = source('src/presentation/lucideIcons.js');
const {
  evaluateFormsReadAuthority,
  normalizeStatusCounts,
} = require('../src/services/workspaceForms');
const { renderFormsPage } = require('../src/presentation/workspaceFormsUx');

function principal(overrides = {}) {
  return {
    id: 9,
    staff_id: null,
    display_name: 'Clinic admin',
    permissions: { 'forms:view': true },
    business_role: 'owner',
    calendar_scope: 'all_business',
    admin_active: true,
    staff_status: null,
    ...overrides,
  };
}

test('Forms foundation is versioned, treatment-mapped and keeps practitioner notes separate', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_sections/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_section_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_templates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_template_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_template_sections/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_service_mappings/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_assignments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_practitioner_notes/);
  assert.match(migration, /UNIQUE \(template_id, version_number\)/);
  assert.match(migration, /UNIQUE \(section_id, version_number\)/);
  assert.match(migration, /Practitioner notes are intentionally separate from the client questionnaire/);
});

test('assignment status contract is exact and secure links persist only a hash plus expiry', () => {
  assert.match(migration, /status IN \('not_sent', 'sent', 'opened', 'completed', 'needs_review'\)/);
  assert.match(migration, /access_token_hash TEXT/);
  assert.match(migration, /access_token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /access_token_hash IS NULL AND access_expires_at IS NULL/);
  assert.doesNotMatch(migration, /\baccess_token\s+TEXT\b/);
  assert.doesNotMatch(migration, /INSERT INTO consultation_form_assignments/i);
});

test('the first two digital forms preserve uploaded Swedish and Hot Stone source coverage', () => {
  for (const expected of [
    'Core Massage Consultation',
    'Swedish Massage Screening',
    'Hot Stone Massage Screening',
    'skin disease, disorder or condition',
    'digestive disorder or condition',
    'recent stroke within the last year',
    'recent stroke within the last 6 months to 2 years',
    'anticoagulants or blood thinners',
    'kidney or liver disease',
    'hair loss or hair growth issues',
    'Doctor name',
    'Doctor number',
    'What would you like to achieve from the treatment?',
  ]) assert.match(migration, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.match(migration, /CLIENT CONSULTATION FORM- SWEDISH MASSAGE\.pdf/);
  assert.match(migration, /Hot Stone Massage - Consultation Form\.pdf/);
  assert.match(migration, /"signature_required":true/);
});

test('service mapping resolves names only during controlled migration and runtime remains canonical-id based', () => {
  assert.match(migration, /SELECT id INTO STRICT v_swedish_service_id[\s\S]*name='Full Body Swedish'/);
  assert.match(migration, /SELECT id INTO STRICT v_hot_stone_service_id[\s\S]*name='Hot Stone Massage'/);
  assert.match(migration, /consultation_form_service_mappings\(service_id, template_version_id, required\)/);
  assert.doesNotMatch(formsServiceSource, /Full Body Swedish|Hot Stone Massage/);
});

test('initial Forms authority is explicit and narrow while future own-staff scope fails closed without linkage', () => {
  assert.equal(evaluateFormsReadAuthority([principal()]).formScope, 'all_business');
  assert.equal(evaluateFormsReadAuthority([principal({ permissions: {} })]), null);
  assert.equal(evaluateFormsReadAuthority([principal({ admin_active: false })]), null);
  assert.equal(evaluateFormsReadAuthority([principal({ business_role: 'employee_practitioner', calendar_scope: 'own_appointments', staff_id: null })]), null);
  const own = evaluateFormsReadAuthority([principal({
    business_role: 'employee_practitioner',
    calendar_scope: 'own_appointments',
    staff_id: 4,
    staff_status: 'active',
  })]);
  assert.equal(own.formScope, 'own_staff');
  assert.equal(own.linkedStaffId, 4);
  assert.match(migration, /business_role IN \('owner','business_admin','booking_operator'\)/);
});

test('Forms activity uses the five human statuses without inventing extra state', () => {
  assert.deepEqual(normalizeStatusCounts([
    { status: 'sent', count: 2 },
    { status: 'completed', count: 4 },
    { status: 'unknown', count: 99 },
  ]), {
    not_sent: 0,
    sent: 2,
    opened: 0,
    completed: 4,
    needs_review: 0,
  });
});

test('Workspace Forms page is a protected read-only control centre and exposes no client answers', () => {
  const html = renderFormsPage({
    authority: { displayName: 'Christel' },
    activity: { not_sent: 1, sent: 2, opened: 3, completed: 4, needs_review: 5 },
    templates: [{
      templateKey: 'hot_stone_massage_consultation',
      title: 'Hot Stone Massage Consultation',
      version: 1,
      itemCount: 20,
      services: [{ id: 30, name: 'Hot Stone Massage' }],
      sections: [
        { title: 'Core Massage Consultation', itemCount: 14 },
        { title: 'Hot Stone Massage Screening', itemCount: 6 },
      ],
    }],
  });
  assert.match(html, /<h1>Forms<\/h1>/);
  assert.match(html, /Hot Stone Massage Consultation/);
  assert.match(html, /Version 1/);
  assert.match(html, /Not sent/);
  assert.match(html, /Needs review/);
  assert.match(html, /Client answers and practitioner notes are kept separate/);
  assert.doesNotMatch(html, /anticoagulants|blood thinners|cancer|pregnant|signature data/i);
  assert.doesNotMatch(html, /answers\s*:/i);
});

test('Forms is mounted only inside authenticated Workspace and automatic delivery remains off', () => {
  assert.match(calendarRouteSource, /createWorkspaceFormsRouter/);
  assert.match(calendarRouteSource, /router\.use\('\/forms', createWorkspaceFormsRouter\(\{ sessionService: staffBrowserSessionService \}\)\)/);
  assert.match(formsRouteSource, /requireStaffSession/);
  assert.match(formsRouteSource, /Cache-Control', 'private, no-store/);
  assert.match(formsRouteSource, /router\.get\('\/access'/);
  assert.match(formsRouteSource, /router\.get\('\/'/);
  assert.doesNotMatch(formsRouteSource, /router\.(?:post|put|patch|delete)\(/i);
  assert.doesNotMatch(`${formsRouteSource}\n${formsServiceSource}`, /sendWhatsApp|shiloh_consultation_form_v1|message_templates/);
  assert.doesNotMatch(calendarRouteSource, /router\.(?:get|post)\('\/forms\/f/);
});

test('capability-driven Workspace navigation gains Forms with the shared Lucide treatment', () => {
  assert.match(navigationSource, /forms: '\/calendar\/forms'/);
  assert.match(navigationSource, /formsAccessService = workspaceForms/);
  assert.match(navigationSource, /forms: allowedDestination/);
  assert.match(iconSource, /forms: renderLucideIcon\('forms'/);
  assert.match(iconSource, /dataset\.workspaceDestination='forms'/);
  assert.match(iconSource, /textContent='Forms'/);
  assert.match(lucideSource, /FileText/);
  assert.match(lucideSource, /forms: FileText/);
});
