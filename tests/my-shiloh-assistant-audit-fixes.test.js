'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const { processClinicFaqMessage, resolveClinicFaq } = require('../src/services/clinicFaq');
const { createMyShilohAssistantService } = require('../src/services/myShilohAssistant');
const { createMyShilohClientContextService } = require('../src/services/myShilohClientContext');
const { createMyShilohReadTools } = require('../src/services/myShilohReadTools');
const { buildInstructions } = require('../src/services/orchestrator');
const { REVIEW_ONLY_REPLY, PREPARATION_FAILED_REPLY } = require('../src/services/myShilohAssistantReplyPolicy');

function assistant(overrides = {}) {
  return createMyShilohAssistantService({ contextService: { getContext: async () => ({ client: { name: 'Synthetic Client' } }) },
    readTools: { definitions: [], execute: async () => ({ ok: true }) },
    actionTools: { definitions: [], handles: () => true, execute: async () => ({ modelResult: { ok: false }, clientAction: null }) },
    ai: async () => 'Which day would suit you?', ...overrides });
}
const send = (service, message = 'Could we do Friday instead?') => service.reply({ sessionId: 1, crmV2ClientId: 55, message });

test('ordinary contextual language and tea substrings never become unrelated FAQ answers', () => {
  for (const message of ['can we make it later', 'could I do Friday instead?', 'can I have the same again?', 'can I change my number?', 'please instead use Friday']) {
    assert.equal(processClinicFaqMessage(message).handled, false, message);
  }
  assert.equal(resolveClinicFaq('instead').kind, 'none');
  assert.equal(processClinicFaqMessage('do you offer coffee or tea').handled, true);
  assert.equal(processClinicFaqMessage('can I bring my pet?').handled, true);
});

test('booking completion claims without commit evidence get application-owned review guidance', async () => {
  for (const reply of ["Your appointment is confirmed for Friday at 10:00.", "I've booked it.", 'Booking successful!', "You're all set for Friday.", 'Consider it done.', 'Reserved for you.', 'I rescheduled your visit.', 'Your booking has been completed.', '**Confirmed** for tomorrow.', 'Your appointment is scheduled for Friday.', 'See you on Friday!']) {
    const result = await send(assistant({ ai: async () => reply }));
    assert.equal(result.reply, REVIEW_ONLY_REPLY, reply); assert.equal(result.action, null);
  }
  assert.equal((await send(assistant())).reply, 'Which day would suit you?');
});

test('failed, thrown and incomplete superseding preparation clears the earlier card and explanation', async () => {
  for (const mode of ['failed', 'throw', 'incomplete']) {
    let calls = 0;
    const service = assistant({ actionTools: { definitions: [], handles: () => true, execute: async () => {
      if (++calls === 1) return { modelResult: { ok: true }, clientAction: { type: 'booking_request', detail: 'Earlier choice' } };
      if (mode === 'throw') throw Error('synthetic unavailable');
      return { modelResult: { ok: false, error: 'slot_unavailable' }, clientAction: null };
    } }, ai: async (_key, _message, options) => {
      await options.toolExecutor('prepare_my_booking', {});
      if (mode === 'incomplete') options.onIncomplete();
      else { try { await options.toolExecutor('prepare_my_booking', {}); } catch (_) { /* production loop converts this to unavailable */ } }
      return 'The booking is ready.';
    } });
    const result = await send(service);
    assert.equal(result.action, null, mode); assert.equal(result.reply, PREPARATION_FAILED_REPLY, mode);
  }
});

test('successful preparation keeps fixed review wording, never the model confirmation', async () => {
  const service = assistant({ actionTools: { definitions: [], handles: () => true, execute: async () => ({ modelResult: { ok: true }, clientAction: { type: 'booking_request' } }) },
    ai: async (_key, _message, options) => { await options.toolExecutor('prepare_my_booking', {}); return 'Booked!'; } });
  const result = await send(service);
  assert.equal(result.reply, 'Your booking is ready to review below. Nothing has been booked or reserved.');
});

test('last visit is server-derived, client-isolated, review-only and carried into conversation', async () => {
  let reads = 0;
  const service = assistant({ readTools: { definitions: [], execute: async (name, args, authority) => {
    reads++; assert.equal(name, 'get_my_last_completed_visit'); assert.deepEqual(args, {}); assert.equal(authority.crmV2ClientId, 55);
    return { ok: true, visit: { found: true, complete: true, ambiguous: false, multiService: false,
      startsAt: '2030-12-31T23:30:00Z', services: ['Synthetic treatment'], practitioners: ['Synthetic therapist'] } };
  } }, ai: async (_key, _message, options) => {
    assert.deepEqual(options.tools, []);
    assert.match(options.clientContext.repeatVisitReview, /Synthetic treatment with Synthetic therapist/);
    assert.equal((await options.toolExecutor('prepare_my_booking', {})).error, 'review_last_visit_first');
    return 'Booked!';
  } });
  const result = await send(service, 'book my last appointment again');
  assert.equal(reads, 1); assert.equal(result.action, null);
  assert.match(result.reply, /2031 at 01:30 \(South African time\)/);
  assert.match(result.reply, /What new date and time/); assert.match(result.reply, /current price and availability/);
});

test('no history, incomplete, ambiguous and multi-treatment history request clarification', async () => {
  for (const [visit, expected] of [
    [{ found: false }, /Which treatment/],
    [{ found: true, complete: false }, /cannot identify/],
    [{ found: true, complete: true, ambiguous: true }, /cannot identify/],
    [{ found: true, complete: true, multiService: true, startsAt: '2030-01-01T12:00:00Z', services: ['Synthetic one', 'Synthetic two'], practitioners: ['Synthetic therapist'] }, /Which treatment would you like to repeat/],
  ]) {
    const result = await send(assistant({ readTools: { definitions: [], execute: async () => ({ ok: true, visit }) } }), 'rebook my last visit');
    assert.match(result.reply, expected); assert.equal(result.action, null);
  }
});

test('SQL last-visit scope excludes other clients and noncompleted/shared records; truncated/ambiguous visits fail closed', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE appointments(id BIGINT,crm_v2_client_id BIGINT,client_id BIGINT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,status TEXT);
    CREATE TABLE appointment_services(appointment_id BIGINT,service_id BIGINT,position INT);
    CREATE TABLE services(id BIGINT,name TEXT); CREATE TABLE staff(id BIGINT,display_name TEXT);
    CREATE TABLE appointment_staff(appointment_id BIGINT,staff_id BIGINT,position INT);
    CREATE TABLE appointment_group_members(appointment_id BIGINT);
    INSERT INTO services VALUES(1,'Synthetic treatment'); INSERT INTO staff VALUES(1,'Synthetic therapist');
    INSERT INTO appointments VALUES(1,55,NULL,'2030-01-01','2030-01-01 01:00','completed'),
      (2,55,NULL,'2030-01-02','2030-01-02 01:00','cancelled'),(3,55,NULL,'2030-01-03','2030-01-03 01:00','no_show'),
      (4,55,NULL,'2031-01-01','2031-01-01 01:00','confirmed'),(5,56,NULL,'2030-01-04','2030-01-04 01:00','completed'),
      (6,55,NULL,'2030-01-05','2030-01-05 01:00','completed'),(7,55,10,'2030-01-06','2030-01-06 01:00','completed'),
      (8,55,NULL,'2030-01-07','2030-01-07 01:00','no_charge');
    INSERT INTO appointment_group_members VALUES(6);
    INSERT INTO appointment_services SELECT id,1,1 FROM appointments;
    INSERT INTO appointment_staff SELECT id,1,1 FROM appointments;`);
  const context = createMyShilohClientContextService({ db: pg, now: () => new Date('2030-02-01T00:00:00Z') });
  const tools = createMyShilohReadTools({ contextService: context });
  const result = await tools.execute('get_my_last_completed_visit', { crmV2ClientId: 56 }, { crmV2ClientId: 55 });
  assert.equal(result.visit.startsAt, '2030-01-01T00:00:00.000Z'); assert.equal(result.visit.complete, true);
  assert.equal(JSON.stringify(result).includes('"id"'), false);
  assert.equal((await tools.execute('get_my_last_completed_visit', {}, {})).ok, false);
  await pg.exec('INSERT INTO appointment_services VALUES(1,1,2)');
  assert.equal((await context.loadLastCompletedVisit(55)).multiService, true);
  await pg.exec('INSERT INTO appointment_services SELECT 1,1,n FROM generate_series(3,6) n');
  assert.equal((await context.loadLastCompletedVisit(55)).complete, false);
  await pg.exec("UPDATE appointments SET starts_at='2030-01-01',ends_at='2030-01-01 01:00',status='completed' WHERE id=2");
  assert.equal((await context.loadLastCompletedVisit(55)).ambiguous, true);
});

test('actual Responses path keeps contextual FAQ turns and server last-visit review in session history', async () => {
  const filename = require.resolve('../src/services/ai'); const local = createRequire(filename); let saved; const requests = [];
  const stubs = { openai: class { constructor() { this.responses = { create: async request => { requests.push(request); return { id: 'synthetic-response', output: [], output_text: 'What date suits you?' }; } }; } },
    './memory': { getSession: async () => 'synthetic-prior', saveSession: async (...args) => { saved = args; } },
    './knowledge': { retrieveKnowledge: async () => [] }, './profile': { getProfile: async () => ({}) },
    './activeCatalogueKnowledge': { getActiveCatalogueKnowledge: async () => null }, './practitionerKnowledge': { getPractitionerKnowledge: async () => null },
    '../lib/logger': { info() {}, warn() {}, error() {} } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => stubs[name] || local(name), process: { env: {} } }, { filename });
  for (const message of ['could I do Friday instead?', 'can we make it later', 'do you offer coffee or tea']) {
    await module.exports.generateReply('myshiloh:1', message, { surface: 'my_shiloh', profileOverride: {} });
    assert.equal(requests.at(-1).input, message); assert.equal(requests.at(-1).previous_response_id, 'synthetic-prior');
    assert.equal(saved[1], 'synthetic-response');
  }
  await module.exports.generateReply('myshiloh:1', 'book my last appointment', { surface: 'my_shiloh', profileOverride: {}, clientContext: { client: { name: 'Synthetic' }, repeatVisitReview: 'Server-owned synthetic visit review. What new date and time?' } });
  assert.equal(requests.at(-1).input[1].role, 'assistant');
  assert.match(requests.at(-1).input[1].content, /Server-owned synthetic visit review/);
});

test('profile guidance describes released self-service rather than obsolete clinic verification', () => {
  const prompt = buildInstructions({ surface: 'my_shiloh' });
  assert.match(prompt, /signed-in client can change their mobile number in Profile/);
  assert.doesNotMatch(prompt, /cannot be changed in the profile form/);
});

 test('negative last-visit instruction does not read history', async () => {
  let reads = 0;
  await send(assistant({ readTools: { definitions: [], execute: async () => { reads++; return {}; } } }), "do not book my last appointment");
  assert.equal(reads, 0);
});
