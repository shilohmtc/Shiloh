const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ACTION_TYPE_RESCHEDULE,
  createMyShilohClientActionService,
  johannesburgDateTime,
} = require('../src/services/myShilohClientActions');
const {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_DEFINITIONS,
  createMyShilohActionTools,
} = require('../src/services/myShilohActionTools');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const NOW = new Date('2026-09-19T06:00:00.000Z');
const CURRENT_START = new Date('2026-09-24T08:00:00.000Z');
const CURRENT_END = new Date('2026-09-24T09:30:00.000Z');
const PROPOSED_START = new Date('2026-09-25T07:00:00.000Z');
const PROPOSED_END = new Date('2026-09-25T08:30:00.000Z');
const REVISION = new Date('2026-09-18T12:00:00.000Z');

test('migration extends one-time proposals for exact reschedule slots without mutating appointments', () => {
  const sql = read('migrations/138_my_shiloh_confirmed_reschedule.sql');
  assert.match(sql, /'cancel_appointment','reschedule_appointment'/);
  assert.match(sql, /proposed_starts_at TIMESTAMPTZ/);
  assert.match(sql, /proposed_ends_at TIMESTAMPTZ/);
  assert.match(sql, /reschedule_slot_required/);
  assert.match(sql, /pending_approval/);
  assert.doesNotMatch(sql, /UPDATE appointments|INSERT INTO appointment_reschedule_requests/i);
});

function proposalDb() {
  const calls = [];
  let tokenHash = null;
  return {
    calls,
    connect: async () => ({
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rowCount: 0, rows: [] };
        if (/FROM client_browser_sessions/.test(sql)) return { rowCount: 1, rows: [{ '?column?': 1 }] };
        if (/myShilohClientActions:reschedule-candidate/.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              id: 901,
              location_id: 2,
              starts_at: CURRENT_START,
              ends_at: CURRENT_END,
              status: 'confirmed',
              updated_at: REVISION,
              normalized_mobile: '27820000000',
              group_id: null,
              staff_count: 1,
              staff_id: 13,
              service_count: 1,
              service_id: 101,
              services: ['Hot Stone Massage'],
              practitioners: ['Marietjie'],
            }],
          };
        }
        if (/UPDATE client_action_proposals[\s\S]*action_type='reschedule_appointment'/.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/INSERT INTO client_action_proposals/.test(sql)) {
          tokenHash = params[3];
          assert.equal(new Date(params[5]).toISOString(), PROPOSED_START.toISOString());
          assert.equal(new Date(params[6]).toISOString(), PROPOSED_END.toISOString());
          return { rowCount: 1, rows: [] };
        }
        if (/FROM client_action_proposals p/.test(sql)) {
          assert.equal(params[0], tokenHash);
          return {
            rowCount: 1,
            rows: [{
              id: 77,
              appointment_id: 901,
              action_type: ACTION_TYPE_RESCHEDULE,
              appointment_revision: REVISION,
              expires_at: new Date(NOW.getTime() + 10 * 60 * 1000),
              consumed_at: null,
              revoked_at: null,
              proposed_starts_at: PROPOSED_START,
              proposed_ends_at: PROPOSED_END,
              starts_at: CURRENT_START,
              services: ['Hot Stone Massage'],
              practitioners: ['Marietjie'],
            }],
          };
        }
        if (/SET consumed_at=\$2,outcome='pending_approval'/.test(sql)) return { rowCount: 1, rows: [] };
        throw new Error(`Unexpected proposal connection query: ${sql}`);
      },
      release() {},
    }),
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT normalized_mobile/.test(sql)) {
        return { rowCount: 1, rows: [{ normalized_mobile: '27820000000' }] };
      }
      if (/UPDATE client_action_proposals[\s\S]*SET outcome=\$2/.test(sql)) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected proposal direct query: ${sql}`);
    },
  };
}

test('prepare reschedule accepts only an exact canonical slot and returns token out of band', async () => {
  const db = proposalDb();
  const availabilityCalls = [];
  const service = createMyShilohClientActionService({
    db,
    now: () => NOW,
    randomBytes: () => Buffer.alloc(32, 9),
    availability: async input => {
      availabilityCalls.push(input);
      return {
        status: 'available',
        slots: [{
          starts_at: PROPOSED_START,
          ends_at: PROPOSED_END,
        }],
      };
    },
    createRescheduleRequest: async () => {
      throw new Error('confirmation should not run while preparing');
    },
  });

  const prepared = await service.prepareReschedule({
    sessionId: 55,
    crmV2ClientId: 912,
    proposedStartsAt: PROPOSED_START.toISOString(),
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.clientAction.type, ACTION_TYPE_RESCHEDULE);
  assert.equal(prepared.clientAction.token.length, 43);
  assert.equal(JSON.stringify(prepared.modelResult).includes(prepared.clientAction.token), false);
  assert.match(prepared.clientAction.note, /stays confirmed/i);
  assert.equal(prepared.clientAction.proposedTime, '09:00');
  assert.deepEqual(availabilityCalls[0], {
    staffId: 13,
    serviceId: 101,
    date: '2026-09-25',
    locationId: 2,
    intervalMinutes: 15,
    excludeAppointmentId: 901,
  });
});

test('prepare reschedule fails closed when requested startsAt is not in canonical availability', async () => {
  const db = proposalDb();
  const service = createMyShilohClientActionService({
    db,
    now: () => NOW,
    availability: async () => ({ status: 'no_slots', slots: [] }),
    createRescheduleRequest: async () => ({ status: 'should_not_run' }),
  });

  const result = await service.prepareReschedule({
    sessionId: 55,
    crmV2ClientId: 912,
    proposedStartsAt: PROPOSED_START.toISOString(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CLIENT_ACTION_SLOT_UNAVAILABLE');
  assert.equal(db.calls.some(call => /INSERT INTO client_action_proposals/.test(call.sql)), false);
});

test('reschedule confirmation consumes proposal once and delegates to practitioner approval authority', async () => {
  const db = proposalDb();
  const requests = [];
  const service = createMyShilohClientActionService({
    db,
    now: () => NOW,
    randomBytes: () => Buffer.alloc(32, 9),
    availability: async () => ({
      slots: [{ starts_at: PROPOSED_START, ends_at: PROPOSED_END }],
    }),
    createRescheduleRequest: async (phone, intent) => {
      requests.push({ phone, intent });
      return {
        status: 'pending_approval',
        reply: 'Reschedule request sent for practitioner approval.',
      };
    },
  });

  const prepared = await service.prepareReschedule({
    sessionId: 55,
    crmV2ClientId: 912,
    proposedStartsAt: PROPOSED_START.toISOString(),
  });

  const confirmed = await service.confirmAction({
    sessionId: 55,
    crmV2ClientId: 912,
    actionToken: prepared.clientAction.token,
  });

  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.status, 'pending_approval');
  assert.equal(confirmed.appointment.proposedTime, '09:00');
  assert.deepEqual(requests, [{
    phone: '27820000000',
    intent: {
      appointment_id: 901,
      preferred_date: '2026-09-25',
      preferred_time: '09:00',
    },
  }]);
  assert.equal(db.calls.some(call => /UPDATE appointments/.test(call.sql)), false);
});

test('prepare reschedule tool requires only exact returned startsAt and cannot confirm anything', async () => {
  const definition = ACTION_TOOL_DEFINITIONS.find(tool => tool.name === ACTION_TOOL_NAMES.PREPARE_RESCHEDULE);
  assert.ok(definition);
  assert.equal(definition.strict, true);
  assert.deepEqual(definition.parameters.required, ['startsAt']);
  assert.deepEqual(Object.keys(definition.parameters.properties), ['startsAt']);
  assert.equal(definition.parameters.additionalProperties, false);

  const tools = createMyShilohActionTools({
    actionService: {
      async prepareCancellation() { return { ok: false }; },
      async prepareReschedule(input) {
        assert.equal(input.proposedStartsAt, PROPOSED_START.toISOString());
        return {
          ok: true,
          modelResult: { ok: true, prepared: true, message: 'Card ready. Appointment unchanged.' },
          clientAction: { type: ACTION_TYPE_RESCHEDULE, token: 'R'.repeat(43) },
        };
      },
    },
  });

  const result = await tools.execute(ACTION_TOOL_NAMES.PREPARE_RESCHEDULE, {
    startsAt: PROPOSED_START.toISOString(),
  }, {
    sessionId: 55,
    crmV2ClientId: 912,
  });
  assert.equal(result.clientAction.type, ACTION_TYPE_RESCHEDULE);
  assert.equal(JSON.stringify(result.modelResult).includes('R'.repeat(43)), false);
  assert.equal(Object.prototype.hasOwnProperty.call(tools, 'confirm'), false);
});

test('Johannesburg slot conversion stays explicit at the practitioner approval handoff', () => {
  assert.deepEqual(johannesburgDateTime(PROPOSED_START), {
    date: '2026-09-25',
    time: '09:00',
  });
});

test('Shiloh prompt requires availability first and preserves client and clinic decision boundaries', () => {
  const prompt = read('src/services/orchestrator.js');
  assert.match(prompt, /first use find_available_slots/);
  assert.match(prompt, /exact startsAt value/);
  assert.match(prompt, /authorized clinic decision is still required/);
  assert.match(prompt, /AI has no tool that can press a confirmation button/);
});

test('confirmation API and browser accept a pending clinic decision without claiming the move happened', () => {
  const route = read('src/routes/myShiloh.js');
  const app = read('public/my-shiloh/assets/app.js');
  assert.match(route, /result\.ok && result\.status === 'pending_approval'/);
  assert.match(route, /current appointment is unchanged/i);
  assert.match(app, /data\.status === 'pending_approval'/);
  assert.match(app, /Reception for planning/i);
  assert.doesNotMatch(app, /Your appointment has been rescheduled/);
});
