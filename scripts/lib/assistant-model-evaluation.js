'use strict';

const { buildInstructions } = require('../../src/services/orchestrator');
const fixtures = require('../../tests/fixtures/assistant-model-review.json');

const MODELS = Object.freeze(['gpt-6-sol', 'gpt-6.1-sol']);
const MAX_REQUESTS_PER_CASE = 4;
const MAX_OUTPUT_TOKENS = 1600;

function buildCaseRequest(model, scenario) {
  if (!MODELS.includes(model)) throw new Error('Unsupported evaluation model');
  const tools = fixtures.tools.filter(tool => Object.hasOwn(scenario.toolResults || {}, tool.name));
  return {
    model,
    input: [{ role: 'user', content: scenario.message }],
    instructions: buildInstructions({
      surface: 'my_shiloh',
      knowledge: fixtures.knowledge,
      profile: null,
    }),
    reasoning: { effort: 'low' },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(tools.length ? { tools, parallel_tool_calls: false } : {}),
  };
}

function validArguments(args, schema) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  if ((schema.required || []).some(key => !Object.hasOwn(args, key))) return false;
  return Object.entries(args).every(([key, value]) => {
    const rule = schema.properties[key];
    if (!rule) return false;
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    const type = value === null ? 'null' : typeof value;
    return types.includes(type)
      && (!rule.enum || rule.enum.includes(value))
      && (!rule.pattern || (typeof value === 'string' && new RegExp(rule.pattern).test(value)));
  });
}

function executeSyntheticTool(scenario, call, tools) {
  const definition = tools.find(tool => tool.name === call.name);
  let args;
  try { args = JSON.parse(call.arguments); } catch { return { ok: false, error: 'invalid_tool_arguments' }; }
  if (!definition || !validArguments(args, definition.parameters)) {
    return { ok: false, error: 'invalid_tool_arguments' };
  }
  const expected = scenario.expectedArguments?.[call.name] || {};
  if (Object.entries(expected).some(([key, value]) => args[key] !== value)) {
    return { ok: false, error: 'unexpected_synthetic_arguments' };
  }
  // No production executor is imported or invoked. Every result is a fixed fixture.
  return structuredClone(scenario.toolResults[call.name]);
}

function screenResult(scenario, result) {
  const failures = [];
  if (result.error) failures.push(result.error);
  if (!result.reply?.trim()) failures.push('empty_reply');
  for (const pattern of scenario.mustMatch || []) {
    if (!new RegExp(pattern, 'i').test(result.reply || '')) failures.push(`missing:${pattern}`);
  }
  for (const pattern of scenario.mustNotMatch || []) {
    if (new RegExp(pattern, 'i').test(result.reply || '')) failures.push(`forbidden:${pattern}`);
  }
  for (const name of scenario.requiredTools || []) {
    if (!result.calls.some(call => call.name === name && call.result.ok)) failures.push(`missing_tool:${name}`);
  }
  for (const name of scenario.requiredToolCalls || []) {
    if (!result.calls.some(call => call.name === name)) failures.push(`missing_tool_call:${name}`);
  }
  if (result.calls.some(call => ['invalid_tool_arguments', 'unexpected_synthetic_arguments'].includes(call.result.error))) {
    failures.push('invalid_tool_call');
  }
  return { passed: failures.length === 0, failures };
}

async function evaluateCase({ responses, model, scenario, now = () => performance.now() }) {
  const request = buildCaseRequest(model, scenario);
  const input = structuredClone(request.input);
  const calls = [];
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  const started = now();
  let reply = '';
  let error = null;
  let requests = 0;
  while (requests < MAX_REQUESTS_PER_CASE) {
    let response;
    try {
      requests += 1;
      response = await responses.create({ ...request, input: structuredClone(input) });
    } catch (failure) {
      // Never persist provider error bodies, headers, credentials or request contents.
      error = Number.isInteger(failure.status) ? `api_http_${failure.status}` : 'api_request_failed';
      break;
    }
    usage.inputTokens += Number(response.usage?.input_tokens || 0);
    usage.cachedInputTokens += Number(response.usage?.input_tokens_details?.cached_tokens || 0);
    usage.outputTokens += Number(response.usage?.output_tokens || 0);
    usage.reasoningTokens += Number(response.usage?.output_tokens_details?.reasoning_tokens || 0);
    if (response.status !== 'completed') {
      error = 'response_not_completed';
      break;
    }
    const toolCalls = (response.output || []).filter(item => item.type === 'function_call');
    if (!toolCalls.length) {
      reply = String(response.output_text || '').trim();
      break;
    }
    if (requests === MAX_REQUESTS_PER_CASE) {
      error = 'tool_round_limit';
      break;
    }
    input.push(...response.output);
    for (const call of toolCalls) {
      const result = executeSyntheticTool(scenario, call, request.tools || []);
      calls.push({ name: call.name, arguments: call.arguments, result });
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
  const result = {
    caseId: scenario.id, model, reply, calls, usage, requests,
    latencyMs: Math.round(now() - started), error,
    humanReview: 'pending',
  };
  return { ...result, screening: screenResult(scenario, result) };
}

module.exports = {
  MODELS, MAX_REQUESTS_PER_CASE, MAX_OUTPUT_TOKENS,
  buildCaseRequest, validArguments, executeSyntheticTool, screenResult, evaluateCase,
};
