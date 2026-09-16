const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HEIDELBERG_GUIDE_CONTENT,
  isHeidelbergGuideQuery,
  getHeidelbergGuideKnowledge,
  buildHeidelbergGuideReply,
} = require('../src/config/heidelbergGuide');

test('Heidelberg guide recognises local visitor questions', () => {
  assert.equal(isHeidelbergGuideQuery('What places of interest are near Heidelberg?'), true);
  assert.equal(isHeidelbergGuideQuery('Do you know any guesthouses?'), true);
  assert.equal(isHeidelbergGuideQuery('What is the price of a facial?'), false);
});

test('Heidelberg guide includes source-linked attractions and stays with a live-detail boundary', () => {
  const knowledge = getHeidelbergGuideKnowledge('Where can I stay in Heidelberg?');
  assert.equal(knowledge.source, 'Shiloh Heidelberg visitor guide, source-checked 2026-09-16');
  assert.match(HEIDELBERG_GUIDE_CONTENT, /Suikerbosrand Nature Reserve/);
  assert.match(HEIDELBERG_GUIDE_CONTENT, /Heidelberg Heritage Museum/);
  assert.match(HEIDELBERG_GUIDE_CONTENT, /heidelberglodge\.co\.za/);
  assert.match(HEIDELBERG_GUIDE_CONTENT, /Do not claim a room, price, rating, availability/);
});

test('visitor questions receive useful deterministic local guidance', () => {
  assert.match(buildHeidelbergGuideReply('Can you recommend guesthouses near Shiloh?'), /Heidelberg Lodge/);
  assert.match(buildHeidelbergGuideReply('What places of interest can I visit?'), /Suikerbosrand Nature Reserve/);
  assert.match(buildHeidelbergGuideReply('Where is Shiloh located?'), /37 Jacobs Street/);
});
