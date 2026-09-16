const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/133_remedial_sports_consultation_and_practitioner_record.sql'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'src/services/workspacePractitionerFormRecords.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/routes/workspaceForms.js'), 'utf8');
const uxSource = fs.readFileSync(path.join(root, 'src/presentation/workspaceSportsFormUx.js'), 'utf8');

const records = require('../src/services/workspacePractitionerFormRecords');
const sportsUx = require('../src/presentation/workspaceSportsFormUx');

function authority(overrides = {}) {
  return {
    operatorAdminId: 1,
    businessRole: 'owner',
    formScope: 'all_business',
    linkedStaffId: 40,
    ...overrides,
  };
}

test('Remedial Sports client form reuses Core Massage and adds only sports-specific intake', () => {
  assert.match(migration, /remedial_sports_massage_consultation/);
  assert.match(migration, /remedial_sports_massage_screening/);
  assert.match(migration, /'core_massage_consultation'::text, 1/);
  assert.match(migration, /'remedial_sports_massage_screening'::text, 2/);
  assert.match(migration, /Remedial Sports Massage - Consultation Form\.pdf/);
  assert.match(migration, /occupation_physical_stress/);
  assert.match(migration, /sporting_activities_previous_injuries/);
  assert.match(migration, /recent_stroke_six_months_to_two_years/);
  assert.match(migration, /autoimmune_disease_disorder/);
  assert.match(migration, /nervous_system_disease_disorder/);
  assert.match(migration, /kidney_or_liver_disorder/);
  assert.match(migration, /skin_disease_disorder/);
  assert.doesNotMatch(migration, /"key":"diabetes"/);
  assert.doesNotMatch(migration, /"key":"pregnant"/);
  assert.doesNotMatch(migration, /"key":"antiretroviral_medication"/);
});

test('Sports consultation maps exact canonical massage services including prepaid package sessions', () => {
  assert.match(migration, /'Sports Massage Full Body'/);
  assert.match(migration, /'Full Body Sports Massage'/);
  assert.match(migration, /'Targeted Area-Specific Sports Massage'/);
  assert.match(migration, /'Bamboo Sports Massage - Area Specific'/);
  assert.match(migration, /external_source='shiloh_package'/);
  assert.match(migration, /external_id='sports-massage-monthly-session'/);
  assert.match(migration, /Expected at least three active Sports Massage services/);
});

test('practitioner assessment is a separate encrypted record with distinct edit authority', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_practitioner_records/);
  assert.match(migration, /payload_ciphertext TEXT NOT NULL/);
  assert.match(migration, /payload_iv TEXT NOT NULL/);
  assert.match(migration, /payload_auth_tag TEXT NOT NULL/);
  assert.match(migration, /forms:clinical_manage/);
  assert.match(migration, /business_role IN \('owner','business_admin'\)/);
  assert.match(migration, /business_role IN \('employee_practitioner','tenant_practitioner'\)/);
  assert.match(migration, /calendar_scope='own_appointments'/);
  assert.doesNotMatch(migration, /Christel|Abigail|Marietjie|Jean-Pierre/);
});

test('clinical read scope allows senior clinic staff and own-scope practitioners but not reception', () => {
  assert.equal(records.canReadClinicalRecord(authority()), true);
  assert.equal(records.canReadClinicalRecord(authority({ businessRole: 'business_admin' })), true);
  assert.equal(records.canReadClinicalRecord(authority({ businessRole: 'employee_practitioner', formScope: 'own_staff' })), true);
  assert.equal(records.canReadClinicalRecord(authority({ businessRole: 'tenant_practitioner', formScope: 'own_staff' })), true);
  assert.equal(records.canReadClinicalRecord(authority({ businessRole: 'booking_operator', formScope: 'all_business' })), false);
});

test('practitioner payload is bounded, typed and preserves primary/secondary pain semantics', () => {
  const normalized = records.normalizePractitionerRecordPayload({
    revision: 0,
    posturalAnalysis: [{ area: ' Right shoulder ', muscleState: 'Tight', notes: 'Elevated' }],
    painMap: [
      { area: 'Right shoulder', state: 'primary' },
      { area: 'Upper back', state: 'secondary' },
    ],
    painConcerns: [{ area: 'Right shoulder', description: 'Pain when lifting.' }],
    techniques: [{ technique: 'Soft tissue technique', reason: 'Address local tension.' }],
    lifestyleRecommendations: 'Gentle mobility as discussed.',
    practitionerNotes: 'Review response next session.',
  });
  assert.equal(normalized.revision, 0);
  assert.equal(normalized.record.posturalAnalysis[0].area, 'Right shoulder');
  assert.deepEqual(normalized.record.painMap, [
    { area: 'Right shoulder', state: 'primary' },
    { area: 'Upper back', state: 'secondary' },
  ]);
  assert.equal(normalized.record.schemaVersion, 1);
});

test('practitioner payload fails closed for unknown fields, invalid body map and oversized row sets', () => {
  assert.throws(() => records.normalizePractitionerRecordPayload({ revision: 0, secret: 'no' }), /reload|unexpected/i);
  assert.throws(() => records.normalizePractitionerRecordPayload({
    revision: 0,
    painMap: [{ area: 'Imaginary region', state: 'primary' }],
  }), /body map/i);
  assert.throws(() => records.normalizePractitionerRecordPayload({
    revision: 0,
    techniques: Array.from({ length: 13 }, () => ({ technique: 'x', reason: '' })),
  }), /check the practitioner assessment/i);
  assert.throws(() => records.normalizePractitionerRecordPayload({ revision: -1 }), /out of date/i);
});

test('signed Remedial Sports submission gains an obvious practitioner assessment handoff only', () => {
  const base = '<article><p class="preview-warning">Read-only signed record.</p></article>';
  const decorated = sportsUx.decorateSportsSubmissionHtml(base, {
    kind: 'client',
    reference: '77',
    form: { templateKey: 'remedial_sports_massage_consultation' },
  });
  assert.match(decorated, /Open practitioner assessment/);
  assert.match(decorated, /\/calendar\/forms\/submissions\/client\/77\/assessment/);
  const untouched = sportsUx.decorateSportsSubmissionHtml(base, {
    kind: 'client', reference: '77', form: { templateKey: 'hot_stone_massage_consultation' },
  });
  assert.equal(untouched, base);
});

test('practitioner assessment UI is practical, mobile-friendly and keeps client submission read-only', () => {
  const html = sportsUx.renderPractitionerRecordPage({
    authority: { displayName: 'Practitioner' },
    submissionId: 77,
    clientName: '<Example Client>',
    formTitle: 'Remedial & Sports Massage Consultation',
    appointment: {
      startsAt: '2026-09-18T08:00:00Z',
      services: ['Full Body Sports Massage'],
      practitioners: ['Practitioner'],
    },
    revision: 1,
    canEdit: true,
    bodyRegions: records.BODY_REGIONS,
    record: {
      posturalAnalysis: [{ area: 'Neck', muscleState: 'Tight', notes: '<note>' }],
      painMap: [{ area: 'Neck', state: 'primary' }],
      painConcerns: [{ area: 'Neck', description: 'Primary concern' }],
      techniques: [{ technique: 'Technique', reason: 'Reason' }],
      lifestyleRecommendations: 'Recommendation',
      practitionerNotes: 'Private note',
    },
  });
  assert.match(html, /Postural analysis/);
  assert.match(html, /Body map/);
  assert.match(html, /Primary concern/);
  assert.match(html, /Secondary concern/);
  assert.match(html, /Techniques performed/);
  assert.match(html, /Lifestyle recommendations/);
  assert.match(html, /Practitioner notes/);
  assert.match(html, /Practitioner only · encrypted/);
  assert.match(html, /Save practitioner assessment/);
  assert.match(html, /&lt;Example Client&gt;/);
  assert.match(html, /&lt;note&gt;/);
  assert.doesNotMatch(html, /payload_ciphertext|CONSULTATION_FORM_DATA_KEY/);
});

test('assessment browser client uses staff CSRF boundary and no browser persistence or logging', () => {
  const script = sportsUx.workspaceSportsAssessmentClientScript();
  assert.match(script, /\/calendar\/staff-auth\/csrf/);
  assert.match(script, /x-shiloh-csrf-token/);
  assert.match(script, /credentials:'same-origin'/);
  assert.match(script, /Content-Type':'application\/json'/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|console\./);
  assert.doesNotMatch(script, /signature|health answer|payload_ciphertext/i);
});

test('assessment routes remain staff-session, same-origin and CSRF guarded before clinical mutation', () => {
  assert.match(routeSource, /requireStaffSession/);
  assert.match(routeSource, /router\.get\('\/assessment-client\.js'/);
  assert.match(routeSource, /router\.get\('\/submissions\/client\/:reference\/assessment'/);
  assert.match(routeSource, /router\.post\([\s\S]*?'\/submissions\/client\/:reference\/assessment'/);
  assert.match(routeSource, /sameOriginGuard\(\{ env \}\)/);
  assert.match(routeSource, /csrfGuard\(\{ service: sessionService \}\)/);
  assert.match(routeSource, /practitionerRecordService\.saveRecord/);
  assert.match(routeSource, /decorateSubmission\(html, model\)/);
});

test('clinical record service scopes to exact Sports template, encrypts writes and audits without clinical payload', () => {
  assert.match(serviceSource, /t\.template_key='\$\{SPORTS_TEMPLATE_KEY\}'/);
  assert.match(serviceSource, /encryptSubmissionPayload/);
  assert.match(serviceSource, /decryptSubmissionPayload/);
  assert.match(serviceSource, /consultation_form_practitioner_records/);
  assert.match(serviceSource, /workspace\.form_practitioner_record_viewed/);
  assert.match(serviceSource, /workspace\.form_practitioner_record_saved/);
  assert.match(serviceSource, /revision=revision\+1/);
  const auditBlock = serviceSource.match(/async function audit[\s\S]*?function model/)?.[0] || '';
  assert.doesNotMatch(auditBlock, /painMap|practitionerNotes|lifestyleRecommendations|techniques/);
});

test('sports presentation source keeps the paper complexity on practitioner side rather than client signature flow', () => {
  assert.match(uxSource, /Postural analysis/);
  assert.match(uxSource, /Body map/);
  assert.match(uxSource, /Pain \/ concern details/);
  assert.match(uxSource, /Techniques performed/);
  assert.match(uxSource, /Recommendations & notes/);
  assert.match(uxSource, /client’s signed answers stay unchanged|client’s signed answers stay unchanged/i);
});
