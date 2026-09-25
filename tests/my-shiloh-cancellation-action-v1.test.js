const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  cancelOwnedAppointmentInTransaction,
} = require('../src/services/clientAppointmentCancellation');
const {
  ACTION_TYPE_CANCEL,
  cancellationPolicy,
  createMyShilohClientActionService,
} = require('../src/services/myShilohClientActions');
const {
  ACTION_TOOL_DEFINITIONS,
  ACTION_TOOL_NAMES,
  createMyShilohActionTools,
} = require('../src/services/myShilohActionTools');
const {
  createMyShilohAssistantService,
} = require('../src/services/myShilohAssistant');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const NOW = new Date('2026-09-19T05:00:00.000Z');
const START = new Date('2026-09-20T08:00:00.000Z');
const END = new Date('2026-09-20T09:30:00.000Z');
const REVISION = new Date('2026-09-18T12:00:00.000Z');

test('migration creates one-time session/client/appointment-bound action proposals', () => {
  const sql = read('migrations/137_my_shiloh_client_action_proposals.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS client_action_proposals/);
  assert.match(sql, /session_id BIGINT NOT NULL REFERENCES client_browser_sessions/);
  assert.match(sql, /crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients/);
  assert.match(sql, /appointment_id BIGINT NOT NULL REFERENCES appointments/);
  assert.match(sql, /action_type IN \('cancel_appointment'\)/);
  assert.match(sql, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /appointment_revision TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /consumed_at TIMESTAMPTZ/);
  assert.match(sql, /revoked_at TIMESTAMPTZ/);
  assert.doesNotMatch(sql, /UPDATE appointments|DELETE FROM appointments|INSERT INTO appointment_status_history/i);
});

function cancellationDb({ revision = REVISION, status = 'confirmed', startsAt = START } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM appointments[\s\S]*FOR UPDATE/.test(sql)) {
        return {
          rowCount: 1,
          rows: [{
            id: 901,
            status,
            client_id: null,
            crm_v2_client_id: 912,
            starts_at: startsAt,
            ends_at: END,
            updated_at: revision,
          }],
        };
      }
      if (/UPDATE appointments/.test(sql)) return { rowCount: 1, rows: [] };
      if (/UPDATE appointment_lifecycle/.test(sql)) return { rowCount: 1, rows: [] };
      if (/INSERT INTO appointment_status_history/.test(sql)) return { rowCount: 1, rows: [] };
      if (/UPDATE payment_requests pr/.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO crm_audit_events/.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected cancellation query: ${sql}`);
    },
  };
}

test('shared canonical cancellation owner mutates only an exact owned current appointment', async () => {
  const db = cancellationDb();
  const result = await cancelOwnedAppointmentInTransaction(db, {
    appointmentId: 901,
    crmV2ClientId: 912,
    expectedRevision: REVISION,
    requireFutureStart: true,
    allowedStatuses: ['scheduled', 'confirmed'],
    now: NOW,
    changedBy: 'client_session:55',
    reason: 'Client cancellation confirmed in My Shiloh',
    auditMetadata: { source: 'my_shiloh', clientSessionId: 55 },
  });

  assert.equal(result.status, 'cancelled');
  assert.ok(db.calls.some(call => /UPDATE appointments/.test(call.sql)));
  assert.ok(db.calls.some(call => /UPDATE appointment_lifecycle/.test(call.sql)));
  const history = db.calls.find(call => /INSERT INTO appointment_status_history/.test(call.sql));
  assert.equal(history.params[2], 'client_session:55');
  assert.equal(history.params[3], 'Client cancellation confirmed in My Shiloh');
  const audit = db.calls.find(call => /INSERT INTO crm_audit_events/.test(call.sql));
  const metadata = JSON.parse(audit.params[1]);
  assert.equal(metadata.source, 'my_shiloh');
  assert.equal(metadata.crmV2ClientId, 912);
  assert.equal(metadata.identityModel, 'crm_v2');
  assert.equal(metadata.schedulingAuthority, 'shiloh_canonical');
});

test('canonical cancellation fails closed for stale revision, started appointment and non-active status', async () => {
  const stale = cancellationDb({ revision: new Date('2026-09-18T13:00:00.000Z') });
  assert.equal((await cancelOwnedAppointmentInTransaction(stale, {
    appointmentId: 901,
    crmV2ClientId: 912,
    expectedRevision: REVISION,
    requireFutureStart: true,
    allowedStatuses: ['scheduled', 'confirmed'],
    now: NOW,
  })).status, 'appointment_changed');
  assert.equal(stale.calls.some(call => /UPDATE appointments/.test(call.sql)), false);

  const started = cancellationDb({ startsAt: new Date('2026-09-19T04:30:00.000Z') });
  assert.equal((await cancelOwnedAppointmentInTransaction(started, {
    appointmentId: 901,
    crmV2ClientId: 912,
    expectedRevision: REVISION,
    requireFutureStart: true,
    allowedStatuses: ['scheduled', 'confirmed'],
    now: NOW,
  })).status, 'appointment_started');
  assert.equal(started.calls.some(call => /UPDATE appointments/.test(call.sql)), false);

  const completed = cancellationDb({ status: 'completed' });
  assert.equal((await cancelOwnedAppointmentInTransaction(completed, {
    appointmentId: 901,
    crmV2ClientId: 912,
    expectedRevision: REVISION,
    allowedStatuses: ['scheduled', 'confirmed'],
    now: NOW,
  })).status, 'appointment_changed');
  assert.equal(completed.calls.some(call => /UPDATE appointments/.test(call.sql)), false);
});

function actionDb() {
  const calls = [];
  let insertedTokenHash = null;
  return {
    calls,
    connect: async () => ({
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rowCount: 0, rows: [] };
        if (/FROM client_browser_sessions/.test(sql)) return { rowCount: 1, rows: [{ '?column?': 1 }] };
        if (/myShilohClientActions:cancellation-candidate/.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              id: 901,
              starts_at: START,
              ends_at: END,
              status: 'confirmed',
              updated_at: REVISION,
              group_id: null,
              services: ['Hot Stone Massage'],
              practitioners: ['Marietjie'],
            }],
          };
        }
        if (/UPDATE client_action_proposals[\s\S]*revoked_at=/.test(sql) && !/outcome='declined'/.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/INSERT INTO client_action_proposals/.test(sql)) {
          insertedTokenHash = params[3];
          return { rowCount: 1, rows: [] };
        }
        if (/FROM client_action_proposals p/.test(sql)) {
          assert.equal(params[0], insertedTokenHash);
          return {
            rowCount: 1,
            rows: [{
              id: 77,
              appointment_id: 901,
              action_type: ACTION_TYPE_CANCEL,
              appointment_revision: REVISION,
              expires_at: new Date(NOW.getTime() + 10 * 60 * 1000),
              consumed_at: null,
              revoked_at: null,
              starts_at: START,
              services: ['Hot Stone Massage'],
              practitioners: ['Marietjie'],
            }],
          };
        }
        if (/FROM appointments[\s\S]*FOR UPDATE/.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              id: 901,
              status: 'confirmed',
              client_id: null,
              crm_v2_client_id: 912,
              starts_at: START,
              ends_at: END,
              updated_at: REVISION,
            }],
          };
        }
        if (/FROM appointment_group_members/.test(sql)) return { rowCount: 0, rows: [] };
        if (/SELECT DISTINCT staff_id/.test(sql)) return { rowCount: 1, rows: [{ staff_id: 13 }] };
        if (/pg_advisory_xact_lock/.test(sql)) return { rowCount: 1, rows: [] };
        if (/UPDATE appointments/.test(sql)) return { rowCount: 1, rows: [] };
        if (/UPDATE appointment_lifecycle/.test(sql)) return { rowCount: 1, rows: [] };
        if (/INSERT INTO appointment_status_history/.test(sql)) return { rowCount: 1, rows: [] };
        if (/UPDATE payment_requests pr/.test(sql)) return { rowCount: 0, rows: [] };
        if (/INSERT INTO crm_audit_events/.test(sql)) return { rowCount: 1, rows: [] };
        if (/SET consumed_at=/.test(sql)) return { rowCount: 1, rows: [] };
        throw new Error(`Unexpected action query: ${sql}`);
      },
      release() {},
    }),
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/outcome='declined'/.test(sql)) return { rowCount: 1, rows: [{ id: 77 }] };
      if (/SET revoked_at=COALESCE/.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected direct action query: ${sql}`);
    },
  };
}

test('prepare returns the one-time token only to the client action, never the model result', async () => {
  const db = actionDb();
  const service = createMyShilohClientActionService({
    db,
    now: () => NOW,
    randomBytes: () => Buffer.alloc(32, 7),
  });
  const prepared = await service.prepareCancellation({ sessionId: 55, crmV2ClientId: 912 });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.clientAction.type, 'cancel_appointment');
  assert.equal(prepared.clientAction.token.length, 43);
  assert.equal(JSON.stringify(prepared.modelResult).includes(prepared.clientAction.token), false);
  assert.match(prepared.modelResult.message, /has not changed/i);
  assert.match(prepared.clientAction.paymentNote, /does not automatically issue a refund/i);
  assert.match(prepared.clientAction.policy, /no booking deposit is required for this appointment/i);
  assert.doesNotMatch(prepared.clientAction.policy, /Marietjie/i);

  const confirmed = await service.confirmAction({
    sessionId: 55,
    crmV2ClientId: 912,
    actionToken: prepared.clientAction.token,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.status, 'cancelled');
  assert.equal(confirmed.appointment.service, 'Hot Stone Massage');
  assert.ok(db.calls.some(call => /SET consumed_at=/.test(call.sql) && call.params[2] === 'confirmed'));
});

test('My Shiloh cancellation fails closed when the appointment becomes linked to a group', async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM appointments[\s\S]*FOR UPDATE/.test(sql)) {
        return {
          rowCount: 1,
          rows: [{
            id: 901,
            status: 'confirmed',
            client_id: null,
            crm_v2_client_id: 912,
            starts_at: START,
            ends_at: END,
            updated_at: REVISION,
          }],
        };
      }
      if (/FROM appointment_group_members/.test(sql)) return { rowCount: 1, rows: [{ group_id: 44 }] };
      throw new Error(`Unexpected linked cancellation query: ${sql}`);
    },
  };
  const result = await cancelOwnedAppointmentInTransaction(db, {
    appointmentId: 901,
    crmV2ClientId: 912,
    expectedRevision: REVISION,
    requireFutureStart: true,
    allowedStatuses: ['scheduled', 'confirmed'],
    lockAssignedStaff: true,
    disallowLinkedGroup: true,
    now: NOW,
  });
  assert.equal(result.status, 'complex_booking');
  assert.equal(calls.some(call => /UPDATE appointments/.test(call.sql)), false);
});

test('My Shiloh cancellation copy uses the unified Booking Policy bands without exposing the practitioner-specific exemption', () => {
  const late = cancellationPolicy(
    new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
    NOW,
    ['Christel'],
  );
  assert.match(late, /less than 24 hours/i);
  assert.match(late, /100% of your booking deposit may be retained/i);
  assert.doesNotMatch(late, /charged|has been applied/i);

  const partial = cancellationPolicy(
    new Date(NOW.getTime() + 30 * 60 * 60 * 1000),
    NOW,
    ['Christel'],
  );
  assert.match(partial, /24–48 hours/i);
  assert.match(partial, /50% of your booking deposit may be retained/i);

  const exempt = cancellationPolicy(
    new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
    NOW,
    ['Marietjie'],
  );
  assert.match(exempt, /no booking deposit is required for this appointment/i);
  assert.doesNotMatch(exempt, /Marietjie/i);
});

test('prepare cancellation tool is strict, argument-free and cannot confirm the action', async () => {
  assert.equal(ACTION_TOOL_DEFINITIONS.length, 2);
  const definition = ACTION_TOOL_DEFINITIONS.find(tool => tool.name === ACTION_TOOL_NAMES.PREPARE_CANCELLATION);
  assert.equal(definition.name, ACTION_TOOL_NAMES.PREPARE_CANCELLATION);
  assert.equal(definition.strict, true);
  assert.deepEqual(definition.parameters.properties, {});
  assert.deepEqual(definition.parameters.required, []);
  assert.equal(definition.parameters.additionalProperties, false);

  const token = 'A'.repeat(43);
  const tools = createMyShilohActionTools({
    actionService: {
      async prepareReschedule() { return { ok: false }; },
      async prepareCancellation() {
        return {
          ok: true,
          modelResult: { ok: true, prepared: true, message: 'Confirmation card ready. Nothing changed.' },
          clientAction: { type: ACTION_TYPE_CANCEL, token },
        };
      },
    },
  });
  const result = await tools.execute(ACTION_TOOL_NAMES.PREPARE_CANCELLATION, {}, {
    sessionId: 55,
    crmV2ClientId: 912,
  });
  assert.equal(result.clientAction.token, token);
  assert.equal(JSON.stringify(result.modelResult).includes(token), false);
  assert.equal(Object.prototype.hasOwnProperty.call(tools, 'confirm'), false);
});

test('assistant captures the client action out of band while model sees only sanitized preparation result', async () => {
  const token = 'A'.repeat(43);
  let modelToolResult = null;
  const service = createMyShilohAssistantService({
    ai: async (_key, _message, options) => {
      modelToolResult = await options.toolExecutor(ACTION_TOOL_NAMES.PREPARE_CANCELLATION, {});
      return 'I prepared the cancellation. Please review the confirmation card.';
    },
    contextService: {
      async getContext() {
        return {
          version: 'my_shiloh_client_context_v1',
          client: { id: 912, name: 'Christel Botha' },
          nextAppointment: null,
          forms: [],
          payment: null,
        };
      },
    },
    readTools: { definitions: [], async execute() { return { ok: false }; } },
    actionTools: {
      definitions: ACTION_TOOL_DEFINITIONS,
      handles: name => name === ACTION_TOOL_NAMES.PREPARE_CANCELLATION,
      async execute() {
        return {
          modelResult: { ok: true, prepared: true, message: 'Card ready. Appointment unchanged.' },
          clientAction: { type: ACTION_TYPE_CANCEL, token },
        };
      },
    },
    clearConversationSession: async () => true,
  });

  const reply = await service.reply({
    sessionId: 55,
    crmV2ClientId: 912,
    message: 'Cancel my appointment',
  });
  assert.equal(reply.action.token, token);
  assert.equal(JSON.stringify(modelToolResult).includes(token), false);
  assert.match(reply.reply, /review the confirmation card/i);
});

test('confirmation route is session-owned, same-origin and CSRF-protected', () => {
  const route = read('src/routes/myShiloh.js');
  assert.match(route, /\/my-shiloh\/api\/actions\/confirm', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /\/my-shiloh\/api\/actions\/decline', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /sessionId: req\.myShilohClientSession\.sessionId/);
  assert.match(route, /crmV2ClientId: req\.myShilohClientSession\.crmV2ClientId/);
  assert.doesNotMatch(route, /req\.(?:body|query|params).*crmV2ClientId/);
  assert.doesNotMatch(route, /req\.(?:body|query|params).*appointmentId/);
});

test('browser confirmation card uses text-only DOM and fresh CSRF for both choices', () => {
  const app = read('public/my-shiloh/assets/app.js');
  assert.match(app, /freshCsrfToken/);
  assert.match(app, /\/my-shiloh\/api\/actions\/confirm/);
  assert.match(app, /\/my-shiloh\/api\/actions\/decline/);
  assert.match(app, /data\.action\) renderClientAction/);
  assert.match(app, /heading\.textContent = String\(action\.title/);
  assert.match(app, /detail\.textContent =/);
  assert.doesNotMatch(app, /innerHTML[\s\S]*action\./);
  assert.match(app, /INSTALL_VERIFIED_KEY = 'my-shiloh-install-whatsapp-verified-v1'/);
  assert.doesNotMatch(app, /sessionStorage|indexedDB/i);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(?:action|appointment|token|client|session|csrf)/i);
});

test('WhatsApp cancellation delegates to the same canonical owner after its existing phone authority check', () => {
  const change = read('src/services/appointmentChange.js');
  assert.match(change, /resolveFinalBookingIdentity/);
  assert.match(change, /cancelOwnedAppointmentInTransaction/);
  assert.match(change, /reason:'Client cancellation confirmed in WhatsApp'/);
  assert.match(change, /source:'whatsapp'/);
});
