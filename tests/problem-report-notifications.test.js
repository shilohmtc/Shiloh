'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolutionMessage, deliver } = require('../src/services/problemReportNotifications');

test('resolution WhatsApp copy includes reference, update, and exact reopen instruction', () => {
  const message = resolutionMessage({ reference_code: 'SH-260920-AABBCCDD', resolution_note: 'The reminder time now matches the booking.' });
  assert.match(message, /Problem resolved/);
  assert.match(message, /SH-260920-AABBCCDD/);
  assert.match(message, /reminder time now matches/);
  assert.match(message, /Still not working SH-260920-AABBCCDD/);
});

test('delivery records provider evidence after sending', async () => {
  const queries = [];
  const db = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  const sent = [];
  const result = await deliver({ id: 8, recipient: '27821234567', reference_code: 'SH-260920-AABBCCDD', reporter_name_snapshot: 'Client One', resolution_note: 'Fixed.' }, {
    db,
    env: {},
    sendTemplate: async (to, name, parameters) => { sent.push({ to, name, parameters }); return { messages: [{ id: 'wamid.123' }] }; },
  });
  assert.equal(result.sent, true);
  assert.equal(sent[0].to, '27821234567');
  assert.equal(sent[0].name, 'shiloh_problem_report_resolved_v1');
  assert.deepEqual(sent[0].parameters, ['Client One', 'SH-260920-AABBCCDD', 'Fixed.']);
  assert.equal(queries[0].params[1], 'wamid.123');
});

test('resolution message is a current canonical Meta utility contract', () => {
  const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');
  const { getMetaTemplateBindingSpec } = require('../src/services/metaTemplateAdapter');
  const contract = getShilohMessageContract('problem_report_resolved');
  const binding = getMetaTemplateBindingSpec('problem_report_resolved');
  assert.equal(contract.lifecycle, 'current');
  assert.equal(contract.message.category, 'UTILITY');
  assert.equal(binding.templateName, 'shiloh_problem_report_resolved_v1');
  assert.equal(binding.defaultWhenUnset, true);
});
