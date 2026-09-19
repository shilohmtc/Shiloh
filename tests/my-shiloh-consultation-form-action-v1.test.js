const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ACTION_TYPE_FORM,
  FORM_ACTION_PATH,
  createMyShilohConsultationFormActionService,
} = require('../src/services/myShilohConsultationFormActions');
const {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_DEFINITIONS,
  CONSULTATION_FORM_TOOL_DEFINITION,
  createMyShilohActionTools,
} = require('../src/services/myShilohActionTools');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const NOW = new Date('2026-09-19T06:00:00.000Z');

function formDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/myShilohConsultationFormActions:session/.test(sql)) return { rowCount: 1, rows: [{ '?column?': 1 }] };
      if (/myShilohConsultationFormActions:pending/.test(sql)) return { rowCount: rows.length, rows };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('form action is server-resolved, session-bound, and exposes no form identity or token to the AI', async () => {
  const db = formDb([{
    id: 44,
    status: 'sent',
    title: 'Skin consultation',
    template_key: 'skin_v1',
    appointment_id: 901,
    appointment_status: 'confirmed',
  }]);
  const service = createMyShilohConsultationFormActionService({
    db,
    now: () => NOW,
  });
  const result = await service.prepareFormAction({ sessionId: 55, crmV2ClientId: 912 });
  assert.equal(result.ok, true);
  assert.equal(result.clientAction.type, ACTION_TYPE_FORM);
  assert.equal(result.clientAction.href, FORM_ACTION_PATH);
  assert.equal(Object.prototype.hasOwnProperty.call(result.clientAction, 'token'), false);
  assert.equal(JSON.stringify(result.modelResult).includes('44'), false);
  assert.equal(JSON.stringify(result.modelResult).includes('912'), false);
  assert.match(db.calls[1].sql, /a\.crm_v2_client_id=\$1/);
  assert.match(db.calls[1].sql, /a\.client_id IS NULL/);
  assert.match(db.calls[1].sql, /a\.status = ANY/);
});

test('multiple pending forms fail closed instead of guessing a target', async () => {
  const service = createMyShilohConsultationFormActionService({
    db: formDb([{ id: 1 }, { id: 2 }]),
    now: () => NOW,
  });
  const result = await service.prepareFormAction({ sessionId: 55, crmV2ClientId: 912 });
  assert.deepEqual(result, { ok: false, code: 'CLIENT_FORM_MULTIPLE_PENDING' });
});

test('opening revalidates through the canonical form authority after server-side selection', async () => {
  const issued = [];
  const service = createMyShilohConsultationFormActionService({
    db: formDb([{ id: 44, status: 'opened', title: 'Skin consultation', appointment_id: 901 }]),
    now: () => NOW,
    formService: {
      async issueAccessToken(input) { issued.push(input); return { token: 'T'.repeat(43), expiresAt: new Date(NOW.getTime() + 600000) }; },
      async openForm(token) { assert.equal(token, 'T'.repeat(43)); return { completed: false, assignmentId: 44, form: { title: 'Skin consultation' } }; },
    },
  });
  const result = await service.openForSession({ sessionId: 55, crmV2ClientId: 912 });
  assert.equal(result.ok, true);
  assert.deepEqual(issued, [{ assignmentId: 44 }]);
  assert.equal(result.accessToken, 'T'.repeat(43));
  assert.equal(result.model.assignmentId, 44);
});

test('consultation form action tool is strict, parameterless, and cannot confirm or choose an ID', async () => {
  const definition = CONSULTATION_FORM_TOOL_DEFINITION;
  assert.ok(definition);
  assert.equal(definition.strict, true);
  assert.deepEqual(definition.parameters.required, []);
  assert.deepEqual(definition.parameters.properties, {});
  assert.equal(definition.parameters.additionalProperties, false);

  const tools = createMyShilohActionTools({
    actionService: {
      async prepareCancellation() { return { ok: false }; },
      async prepareReschedule() { return { ok: false }; },
    },
    formActionService: {
      async prepareFormAction(input) {
        assert.deepEqual(input, { sessionId: 55, crmV2ClientId: 912 });
        return {
          ok: true,
          modelResult: { ok: true, prepared: true, message: 'Form action ready.' },
          clientAction: { type: ACTION_TYPE_FORM, href: FORM_ACTION_PATH, label: 'Complete form' },
        };
      },
    },
  });
  const result = await tools.execute(ACTION_TOOL_NAMES.PREPARE_CONSULTATION_FORM, {}, { sessionId: 55, crmV2ClientId: 912 });
  assert.equal(result.clientAction.type, ACTION_TYPE_FORM);
  assert.equal(JSON.stringify(result.modelResult).includes('912'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(tools, 'confirm'), false);
});

test('My Shiloh route and browser action use a fixed path with authenticated server resolution', () => {
  const route = read('src/routes/myShiloh.js');
  const browser = read('public/my-shiloh/assets/app.js');
  assert.match(route, /router\.get\('\/my-shiloh\/forms\/complete', requireSession/);
  assert.match(route, /openForSession\(\{[\s\S]*req\.myShilohClientSession\.crmV2ClientId/);
  assert.doesNotMatch(route, /req\.params\.(?:client|form|practitioner|service)Id/);
  assert.match(browser, /String\(action\.href \|\| ''\) !== '\/my-shiloh\/forms\/complete'/);
  assert.match(browser, /open\.textContent = String\(action\.label \|\| 'Complete form'\)/);
});
