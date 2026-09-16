'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CLINIC_FAQ_POLICY,
  FAQ_UNKNOWN_REPLY,
} = require('../src/config/clinicFaqPolicy');
const {
  resolveClinicFaq,
  processClinicFaqMessage,
  getClinicFaqKnowledge,
  isCanonicalAuthorityQuery,
} = require('../src/services/clinicFaq');

const evaluations = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'assistant-faq-v1-evals.json'),
  'utf8'
));

function entryId(result) {
  return result?.resolution?.entry?.id || result?.entry?.id || null;
}

test('#884 clinic-owned FAQ source has explicit authority boundaries and no transactional business truth', () => {
  assert.ok(Array.isArray(CLINIC_FAQ_POLICY));
  assert.ok(CLINIC_FAQ_POLICY.length >= 5);

  const ids = CLINIC_FAQ_POLICY.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'FAQ entry IDs must be unique');

  const serialized = JSON.stringify(CLINIC_FAQ_POLICY).toLowerCase();
  assert.doesNotMatch(serialized, /\br\s?\d{2,}\b/, 'FAQ policy must not carry prices');
  assert.doesNotMatch(serialized, /available slots|appointment id|client id|staff id/, 'FAQ policy must not duplicate transactional state');

  for (const entry of CLINIC_FAQ_POLICY) {
    assert.ok(['confirmed', 'unconfirmed'].includes(entry.status));
    assert.ok(entry.title);
    assert.ok(entry.topics?.length);
    if (entry.status === 'confirmed') {
      assert.ok(entry.answer, `${entry.id} confirmed policy needs an answer`);
      assert.ok(entry.provenance, `${entry.id} confirmed policy needs provenance`);
    } else {
      assert.equal(entry.answer, null, `${entry.id} unconfirmed policy must fail closed`);
    }
  }
});

test('#884 curated evaluation pack covers typo, slang, ambiguity, unsupported-policy and canonical precedence', () => {
  const groups = new Set(evaluations.map(item => item.group));
  for (const required of ['known', 'typo', 'slang', 'ambiguity', 'unsupported-policy', 'canonical-precedence']) {
    assert.ok(groups.has(required), `missing evaluation group ${required}`);
  }

  for (const evaluation of evaluations) {
    const direct = processClinicFaqMessage(evaluation.message);
    const resolved = resolveClinicFaq(evaluation.message);

    if (evaluation.expect === 'defer-canonical') {
      assert.equal(isCanonicalAuthorityQuery(evaluation.message), true, evaluation.id);
      assert.equal(direct.handled, false, evaluation.id);
      assert.equal(direct.reason, 'canonical_authority', evaluation.id);
      assert.equal(resolved.kind, evaluation.faqKind, evaluation.id);
      if (evaluation.entryId) assert.equal(entryId(resolved), evaluation.entryId, evaluation.id);
      continue;
    }

    assert.equal(direct.handled, true, evaluation.id);
    if (evaluation.expect === 'answer') {
      assert.equal(direct.resolution.kind, 'answer', evaluation.id);
      assert.equal(entryId(direct), evaluation.entryId, evaluation.id);
      assert.notEqual(direct.reply, FAQ_UNKNOWN_REPLY, evaluation.id);
    } else if (evaluation.expect === 'unknown') {
      assert.equal(direct.resolution.kind, 'unknown', evaluation.id);
      assert.equal(entryId(direct), evaluation.entryId, evaluation.id);
      assert.equal(direct.reply, FAQ_UNKNOWN_REPLY, evaluation.id);
    } else if (evaluation.expect === 'ambiguous') {
      assert.equal(direct.resolution.kind, 'ambiguous', evaluation.id);
      assert.match(direct.reply, /clarify/i, evaluation.id);
    } else if (evaluation.expect === 'unknown-policy') {
      assert.equal(direct.resolution.kind, 'unknown-policy', evaluation.id);
      assert.equal(direct.reply, FAQ_UNKNOWN_REPLY, evaluation.id);
    } else {
      assert.fail(`Unhandled evaluation expectation: ${evaluation.expect}`);
    }
  }
});

test('#884 mixed canonical questions retain FAQ context without allowing FAQ to answer transactionally', () => {
  const message = 'how much is a massage and do you have snacks?';
  const direct = processClinicFaqMessage(message);
  assert.equal(direct.handled, false);
  assert.equal(direct.reason, 'canonical_authority');

  const knowledge = getClinicFaqKnowledge(message);
  assert.equal(knowledge.source, 'Shiloh clinic-owned FAQ policy');
  assert.match(knowledge.content, /NO MAINTAINED CLINIC POLICY/);
  assert.match(knowledge.content, /Do not infer or invent/);
  assert.doesNotMatch(knowledge.content, /price|cost|rand|availability/i);
});

test('#884 pure confirmed FAQ answers before provider use while canonical questions remain on existing AI path', () => {
  const aiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ai.js'), 'utf8');
  assert.match(aiSource, /processClinicFaqMessage\(message\)/);
  assert.match(aiSource, /if \(directFaq\.handled\) return directFaq\.reply/);
  assert.match(aiSource, /getClinicFaqKnowledge\(message\)/);
  assert.match(aiSource, /\[activeCatalogue, practitionerKnowledge, clinicFaqKnowledge, heidelbergGuideKnowledge, \.\.\.knowledge\]/);

  const faqIndex = aiSource.indexOf('processClinicFaqMessage(message)');
  const providerIndex = aiSource.indexOf('client.responses.create(request)');
  assert.ok(faqIndex >= 0 && providerIndex > faqIndex, 'FAQ fail-closed resolver must execute before provider generation');
});

test('#884 unknown maintained-topic context is explicit enough for LLM composition to fail closed', () => {
  const knowledge = getClinicFaqKnowledge('got champers?');
  assert.equal(knowledge.title, 'Champagne and alcoholic drinks');
  assert.equal(knowledge.similarity, 1);
  assert.match(knowledge.content, /NO MAINTAINED CLINIC POLICY/);
  assert.match(knowledge.content, /ask the client to confirm with the clinic team/i);
});
