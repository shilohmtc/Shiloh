const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/134_expanded_consultation_form_library.sql'), 'utf8');
const clientFormsSource = fs.readFileSync(path.join(root, 'src/services/clientConsultationForms.js'), 'utf8');

const definitions = [...migration.matchAll(/\$json\$([\s\S]*?)\$json\$/g)].map(match => JSON.parse(match[1]));

function definitionWithGroup(groupKey) {
  return definitions.find(definition => (definition.groups || []).some(group => group.key === groupKey));
}

function flattenedLabels(definition) {
  return (definition?.groups || []).flatMap(group => [
    ...(group.fields || []),
    ...(group.questions || []),
  ]).flatMap(item => [item.label, item.follow_up?.label].filter(Boolean));
}

function flattenedKeys(definition) {
  return (definition?.groups || []).flatMap(group => [
    ...(group.fields || []),
    ...(group.questions || []),
  ]).flatMap(item => [item.key, item.follow_up?.key].filter(Boolean));
}

test('expanded consultation library adds six immutable source-backed templates', () => {
  for (const templateKey of [
    'bamboo_sports_massage_consultation',
    'balinese_scalp_massage_consultation',
    'manual_lymphatic_drainage_consultation',
    'reflexology_consultation',
    'back_care_clinic_consultation',
    'remedial_sports_massage_consultation',
  ]) assert.match(migration, new RegExp(`\\('${templateKey}'`));

  for (const sourceName of [
    'Bamboo Sports Massage - Consultation Form.pdf',
    'Balinese Scalp Massage - Consultation Form.pdf',
    'MLD - Consultation Form.pdf',
    'CLIENT CONSULTATION FORM - REFLEXOLOGY.pdf',
    'BACK CARE CLINIC CLIENT CONSULTATION FORM.pdf',
    'Remedial Sports Massage - Consultation Form.pdf',
  ]) assert.match(migration, new RegExp(sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.equal(definitions.length, 8);
  for (const definition of definitions) assert.equal(definition.schema_version, 1);
});

test('all new form schemas use unique answer keys and supported client form item types', () => {
  const supported = new Set(['text', 'textarea', 'date', 'prefill_text', 'prefill_date', 'yes_no']);
  for (const definition of definitions) {
    const keys = flattenedKeys(definition);
    assert.equal(new Set(keys).size, keys.length);
    for (const group of definition.groups || []) {
      for (const item of [...(group.fields || []), ...(group.questions || [])]) {
        assert.ok(supported.has(item.type), `unsupported form type ${item.type}`);
        if (item.follow_up) assert.ok(['text', 'textarea'].includes(item.follow_up.type));
      }
    }
  }
  assert.match(clientFormsSource, /function flattenFormItems/);
  assert.match(clientFormsSource, /type === 'yes_no'/);
});

test('Bamboo, Balinese, MLD and Back Care preserve their treatment-specific screening', () => {
  const bamboo = flattenedLabels(definitionWithGroup('bamboo_health')).join('\n');
  assert.match(bamboo, /digestive disorders/i);
  assert.match(bamboo, /treated heart disease or high blood pressure/i);
  assert.match(bamboo, /areas you want me to focus on/i);

  const balinese = flattenedLabels(definitionWithGroup('balinese_health')).join('\n');
  assert.match(balinese, /anticoagulants or blood thinners/i);
  assert.match(balinese, /antidepressants/i);
  assert.match(balinese, /hair loss or hair growth issues/i);
  assert.match(balinese, /how frequently/i);

  const mld = flattenedLabels(definitionWithGroup('mld_health')).join('\n');
  for (const expected of ['lymphoma', 'mastectomy', 'thrombosis or DVT', 'lymph nodes removed', 'lymphedema', 'lipedema', 'fluid retention']) {
    assert.match(mld, new RegExp(expected, 'i'));
  }

  const backCare = flattenedLabels(definitionWithGroup('back_care_health')).join('\n');
  assert.match(backCare, /Covid vaccination/i);
  assert.match(backCare, /which one, how many doses/i);
  assert.match(backCare, /symptoms after the vaccination/i);
  assert.match(backCare, /still show any symptoms or side effects/i);
});

test('Reflexology keeps the broad source screening and its distinct indemnity', () => {
  const reflexology = flattenedLabels(definitionWithGroup('reflexology_health')).join('\n');
  for (const expected of [
    'hypothyroidism or hyperthyroidism',
    'organ transplant',
    'kidney stones',
    'tinnitus',
    'endometriosis or cystitis',
    'lymphedema, lipedema, oedema or fluid retention',
    'multiple sclerosis',
    'fibromyalgia',
    'bipolar disorder, ADHD or ADD',
    'osteoporosis',
    'emphysema',
    'Reflexology treatment',
  ]) assert.match(reflexology, new RegExp(expected, 'i'));

  assert.match(migration, /I concede to receiving touch from the signed practitioner by my choice for my body\./);
});

test('Remedial Sports keeps client history client-facing but practitioner assessment and treatment records separate', () => {
  const remedial = definitionWithGroup('remedial_health');
  const labels = flattenedLabels(remedial).join('\n');
  for (const expected of [
    'auto-immune disease or disorder',
    'Occupation: what physical stresses are involved',
    'sporting activities or previous sports injuries',
    'Where are you currently experiencing pain or concern',
    'goals for the treatment',
  ]) assert.match(labels, new RegExp(expected, 'i'));

  assert.doesNotMatch(labels, /Postural Analysis|Muscle State|Remedial Techniques Performed|Reasons for performing the Technique|Lifestyle Recommendations|Practitioner.?s Notes/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_practitioner_records/);
  assert.match(migration, /payload_ciphertext TEXT NOT NULL/);
  assert.match(migration, /payload_iv TEXT NOT NULL/);
  assert.match(migration, /payload_auth_tag TEXT NOT NULL/);
  assert.match(migration, /public consultation-form route must never read this table/i);
  assert.match(migration, /"practitioner_record_type":"remedial_sports_v1"/);
});

test('expanded forms retain typed signature requirements and source consent wording', () => {
  const signatureSettings = migration.match(/"signature_required":true/g) || [];
  assert.equal(signatureSettings.length, 6);
  assert.match(migration, /strictly confidential between the therapist and me/);
  assert.match(migration, /non-sexual service/);
  assert.match(migration, /not a substitute for medical intervention or treatment/);
  assert.match(migration, /strictly confidential between me and the practitioner/);
});

test('auto-mapping is exact-id based, fail-closed and leaves absent catalogue treatments unmapped', () => {
  for (const externalId of [
    '6a0c9c5e-d7e7-4a82-8795-e8281a0bd526',
    '90baece3-1520-4368-b772-eaba08e1a511',
    '9f2f6452-f1ce-4525-88f2-3dc57f74caa6',
    'b5c96105-f534-406d-89ec-68e78c65cf8b',
    'b39dcaf1-7894-40e0-8a51-c7ab4eba553a',
    '46043512-d1df-4169-92b4-132160fca809',
    '2d5b6147-ee9f-4a97-8e27-6270751c2673',
  ]) assert.match(migration, new RegExp(externalId));

  assert.match(migration, /expected 7 active canonical Goldie services/);
  assert.match(migration, /external_source='goldie'/);
  assert.match(migration, /Balinese Scalp Massage and Reflexology remain available in the Forms library but[\s\S]*deliberately unmapped/);

  const mappingBlock = migration.slice(migration.lastIndexOf('WITH mapping(external_id, template_key)'));
  assert.doesNotMatch(mappingBlock, /balinese_scalp_massage_consultation|reflexology_consultation/);
});
