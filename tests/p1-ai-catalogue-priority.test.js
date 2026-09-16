const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("AI receives authoritative CRM catalogue and practitioner mapping ahead of clinic FAQ and retrieved legacy knowledge", () => {
  const ai = source("src/services/ai.js");
  assert.match(ai, /getActiveCatalogueKnowledge/);
  assert.match(ai, /getPractitionerKnowledge/);
  assert.match(ai, /clinicFaqKnowledge/);
  assert.match(ai, /\[activeCatalogue, practitionerKnowledge, clinicFaqKnowledge, heidelbergGuideKnowledge, \.\.\.knowledge\]\.filter\(Boolean\)/);
});

test("active catalogue knowledge is read-only and active-only", () => {
  const catalogue = source("src/services/activeCatalogueKnowledge.js");
  assert.match(catalogue, /FROM services s/);
  assert.match(catalogue, /s\.status = 'active'/);
  assert.doesNotMatch(catalogue, /\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
});

test("prompt makes CRM catalogue authoritative over Goldie for current service facts", () => {
  const orchestrator = source("src/services/orchestrator.js");
  assert.match(orchestrator, /Shiloh CRM active catalogue/);
  assert.match(orchestrator, /overrides Goldie/);
  assert.match(orchestrator, /Never use a Goldie-only service/);
});
