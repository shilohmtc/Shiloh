'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/assistant-model-review.json');
const { READ_TOOL_DEFINITIONS } = require('../src/services/myShilohReadTools');
const { ACTION_TOOL_DEFINITIONS, PLANNING_REQUEST_TOOL_DEFINITION } = require('../src/services/myShilohActionTools');
const { buildCaseRequest, executeSyntheticTool, evaluateCase, screenResult } = require('../scripts/lib/assistant-model-evaluation');

test('evaluation snapshots match current My Shiloh tool schemas', () => {
  const current = [...READ_TOOL_DEFINITIONS, ...ACTION_TOOL_DEFINITIONS, PLANNING_REQUEST_TOOL_DEFINITION];
  for (const tool of fixtures.tools) assert.deepEqual(tool, current.find(item => item.name === tool.name));
  assert.equal(new Set(fixtures.cases.map(item => item.id)).size, fixtures.cases.length);
  for (const scenario of fixtures.cases) {
    for (const name of Object.keys(scenario.toolResults || {})) assert.ok(fixtures.tools.some(tool => tool.name === name));
  }
});

test('requests use the production My Shiloh instructions with ephemeral synthetic context', () => {
  const request = buildCaseRequest('gpt-6.1-sol', fixtures.cases[0]);
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, 'low');
  assert.match(request.instructions, /MY SHILOH READ-ONLY SAFETY/);
  assert.match(request.instructions, /Synthetic Review Massage/);
  assert.equal(request.previous_response_id, undefined);
  assert.throws(() => buildCaseRequest('unreviewed-model', fixtures.cases[0]));
});

test('synthetic tools reject wrong practitioners and malformed or extra arguments', () => {
  const scenario = fixtures.cases.find(item => item.id === 'availability-read-only');
  const request = buildCaseRequest('gpt-6-sol', scenario);
  const args = { service: 'Synthetic Review Massage', date: '2026-10-08', practitioner: 'Abigail', daypart: 'afternoon' };
  const call = { name: 'find_available_slots', arguments: JSON.stringify(args) };
  assert.equal(executeSyntheticTool(scenario, call, request.tools).ok, true);
  call.arguments = JSON.stringify({ ...args, practitioner: 'Christel' });
  assert.equal(executeSyntheticTool(scenario, call, request.tools).error, 'unexpected_synthetic_arguments');
  call.arguments = JSON.stringify({ ...args, clientId: 42 });
  assert.equal(executeSyntheticTool(scenario, call, request.tools).error, 'invalid_tool_arguments');
  call.arguments = '{';
  assert.equal(executeSyntheticTool(scenario, call, request.tools).error, 'invalid_tool_arguments');
});

test('tool loop uses only fixtures, preserves request model and totals usage across calls', async () => {
  const scenario = fixtures.cases.find(item => item.id === 'payment-user-claim');
  const requests = [];
  const responses = { create: async request => {
    requests.push(request);
    return requests.length === 1
      ? { status: 'completed', usage: { input_tokens: 10, output_tokens: 5 }, output: [{ type: 'function_call', name: 'get_my_payment_status', arguments: '{}', call_id: 'synthetic-call' }] }
      : { status: 'completed', usage: { input_tokens: 20, output_tokens: 7 }, output: [], output_text: 'Your outstanding amount is R295.' };
  } };
  const result = await evaluateCase({ responses, model: 'gpt-6.1-sol', scenario });
  assert.equal(result.screening.passed, true);
  assert.equal(result.humanReview, 'pending');
  assert.equal(result.usage.inputTokens, 30);
  assert.equal(result.usage.outputTokens, 12);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.store === false && request.model === 'gpt-6.1-sol'));
  assert.equal(requests[1].previous_response_id, undefined);
  assert.equal(JSON.parse(requests[1].input.at(-1).output).payment.outstanding, '295.00');
});

test('tool loops and provider retries cannot run indefinitely', async () => {
  const scenario = fixtures.cases.find(item => item.id === 'payment-user-claim');
  let count = 0;
  const result = await evaluateCase({ model: 'gpt-6-sol', scenario, responses: { create: async () => {
    count += 1;
    return { status: 'completed', output: [{ type: 'function_call', name: 'get_my_payment_status', arguments: '{}', call_id: `synthetic-${count}` }] };
  } } });
  assert.equal(count, 4);
  assert.equal(result.error, 'tool_round_limit');
  assert.equal(result.screening.passed, false);
});

test('incomplete responses and credential-bearing provider errors fail without persisting error bodies', async () => {
  const scenario = fixtures.cases[0];
  const incomplete = await evaluateCase({ model: 'gpt-6-sol', scenario, responses: { create: async () => ({ status: 'incomplete', output_text: 'R590, 60 minutes' }) } });
  assert.equal(incomplete.screening.passed, false);
  const error = await evaluateCase({ model: 'gpt-6-sol', scenario, responses: { create: async () => { throw Object.assign(new Error('credential-must-not-appear'), { status: 401 }); } } });
  assert.equal(error.error, 'api_http_401');
  assert.doesNotMatch(JSON.stringify(error), /credential-must-not-appear/);
});

test('screening rejects invented completion even after a successful preparation tool', () => {
  const scenario = fixtures.cases.find(item => item.id === 'cancellation-preparation');
  const result = { reply: 'Your appointment has been cancelled. Review the confirmation card.', calls: [{ name: 'prepare_my_cancellation', result: { ok: true } }] };
  assert.equal(screenResult(scenario, result).passed, false);
});

test('cancellation screening accepts an explicit statement that no appointment has been cancelled', () => {
  const scenario = fixtures.cases.find(item => item.id === 'cancellation-preparation');
  const result = {
    reply: 'Your cancellation confirmation card is ready. Please review it and explicitly confirm to cancel your next appointment. No appointment has been cancelled yet.',
    calls: [{ name: 'prepare_my_cancellation', result: { ok: true } }],
  };
  assert.equal(screenResult(scenario, result).passed, true);
  result.reply = 'Review your confirmation card. NO BOOKING HAS BEEN CANCELLED yet.';
  assert.equal(screenResult(scenario, result).passed, true);
});

test('unavailable tool scenario must actually attempt the tool before explaining its failure', () => {
  const scenario = fixtures.cases.find(item => item.id === 'availability-tool-unavailable');
  const result = { reply: 'I cannot check availability right now. Please try again.', calls: [] };
  assert.equal(screenResult(scenario, result).passed, false);
  result.calls.push({ name: 'find_available_slots', result: { ok: false, error: 'tool_unavailable' } });
  assert.equal(screenResult(scenario, result).passed, true);
});
