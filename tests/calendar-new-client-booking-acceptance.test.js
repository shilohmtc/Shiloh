const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createCalendarCreateBookingService,
  normalizeNewClientInput,
} = require('../src/services/calendarCreateBooking');
const TEST_ADMIN_ID = 2;
const enabledEnv = {};

function authorityRow(overrides = {}) {
  return {
    id: TEST_ADMIN_ID,
    staff_id: 9,
    display_name: 'Christel',
    role: 'admin',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'appointment:create': true, 'client:lookup': true },
    admin_active: true,
    staff_status: 'active',
    client_bookable: true,
    ...overrides,
  };
}

function eligibleRow() {
  return {
    staff_id: 9,
    staff_name: 'Abigail',
    service_id: 44,
    service_name: 'Deep Tissue Massage',
    duration_minutes: 60,
    processing_time_minutes: 0,
    extra_time_minutes: 0,
    price: '650.00',
    variable_price: false,
  };
}

function v2Client(overrides = {}) {
  return {
    id: '701',
    name: 'Jane Doe',
    normalizedMobile: '27821234567',
    profileStatus: 'minimal',
    status: 'active',
    ...overrides,
  };
}

function scriptedDb(handler = async () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const call = { sql: String(sql), params };
      calls.push(call);
      return (await handler(call, calls)) || { rows: [], rowCount: 0 };
    },
  };
}

function bookingDb({ pending = null, eligible = true } = {}) {
  return scriptedDb(async (call) => {
    if (call.sql.includes('FROM staff_admin_accounts a')) return { rows: [authorityRow()], rowCount: 1 };
    if (call.sql.includes('JOIN staff_services ss') && call.sql.includes('st.id = $1')) {
      return eligible ? { rows: [eligibleRow()], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (call.sql.includes('FROM admin_booking_sessions abs')) {
      return pending ? { rows: [pending], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function crmV2(overrides = {}) {
  return {
    async searchClients() { return []; },
    async getClientById(id) { return v2Client({ id: String(id) }); },
    async createClient() { return { status: 'created', client: v2Client() }; },
    ...overrides,
  };
}

function preparedResult(client = v2Client()) {
  return {
    status: 'pending_confirmation',
    client,
    staff: { id: 9, display_name: 'Abigail' },
    service: { id: 44, name: 'Deep Tissue Massage', price: '650.00', variable_price: false },
    startsAt: '2026-08-28T08:15:00.000Z',
    endsAt: '2026-08-28T09:15:00.000Z',
  };
}

function pending(overrides = {}) {
  return {
    crm_v2_client_id: 701,
    source_client_name: 'Jane Doe',
    client_mobile_snapshot: '27821234567',
    staff_id: 9,
    service_id: 44,
    location_id: 1,
    starts_at: '2026-08-28T08:15:00.000Z',
    ends_at: '2026-08-28T09:15:00.000Z',
    state: 'confirm',
    current_client_name: 'Jane Doe',
    current_client_mobile: '27821234567',
    current_client_status: 'active',
    ...overrides,
  };
}

const ROOT = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'src/routes/calendarCreateBooking.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(ROOT, 'src/services/calendarCreateBooking.js'), 'utf8');
const uxSource = fs.readFileSync(path.join(ROOT, 'src/presentation/calendarCreateBookingUx.js'), 'utf8');
const choiceSource = fs.readFileSync(path.join(ROOT, 'src/presentation/calendarCreateBookingClientChoiceUx.js'), 'utf8');

test('Create Booking presents existing clients first, keeps search visible, and exposes Add new client without registration', () => {
  assert.match(choiceSource, /existingButton\.textContent='Existing clients'/);
  assert.match(choiceSource, /searchLabel\.hidden=false;searchActions\.hidden=false/);
  assert.match(choiceSource, /newButton\.textContent='Add new client'/);
  assert.match(choiceSource, /data-client-mode-existing/);
  assert.doesNotMatch(choiceSource, /data-client-mode-search/);
  assert.match(choiceSource, /data-client-mode-new/);
  assert.match(choiceSource, /loadExistingClients\(\)/);
  assert.doesNotMatch(`${uxSource}\n${choiceSource}`, /Find existing client|\+ New client|Client registration/);
  assert.match(uxSource, /Name or mobile number/);
  assert.doesNotMatch(`${uxSource}\n${choiceSource}`, /Search CRM V2|Clean CRM V2|guarded Shiloh write/);
});

test('new-client input normalization is bounded and does not invent identity', () => {
  assert.deepEqual(normalizeNewClientInput({ name: '  Jane   Doe ', mobile: ' 082 123 4567 ' }), {
    name: 'Jane Doe',
    mobile: '082 123 4567',
  });
  assert.deepEqual(normalizeNewClientInput({ fullName: 'Jane Doe', mobileNumber: '0821234567' }), {
    name: 'Jane Doe',
    mobile: '0821234567',
  });
  assert.equal(normalizeNewClientInput(null), null);
  assert.equal(normalizeNewClientInput({}), null);
});

test('client choice is exclusive and invalid identity fails before service selection or CRM mutation', async () => {
  const db = bookingDb();
  let creates = 0;
  const service = createCalendarCreateBookingService({
    db,
    env: enabledEnv,
    crmV2Service: crmV2({ async createClient() { creates += 1; } }),
  });
  await assert.rejects(
    service.prepare({ adminId: TEST_ADMIN_ID, clientId: 701, newClient: { name: 'Jane Doe', mobile: '0821234567' }, staffId: 9, serviceId: 44, date: '2026-08-28', time: '10:15' }),
    (error) => error?.code === 'CALENDAR_BOOKING_INVALID_CLIENT_SELECTION'
  );
  assert.equal(creates, 0);
  assert.equal(db.calls.some((call) => call.sql.includes('st.id = $1')), false);
});

test('out-of-scope service is rejected before createClient can mutate CRM V2', async () => {
  const db = bookingDb({ eligible: false });
  let creates = 0;
  const service = createCalendarCreateBookingService({
    db,
    env: enabledEnv,
    crmV2Service: crmV2({ async createClient() { creates += 1; } }),
  });
  await assert.rejects(
    service.prepare({ adminId: TEST_ADMIN_ID, newClient: { name: 'Jane Doe', mobile: '0821234567' }, staffId: 9, serviceId: 44, date: '2026-08-28', time: '10:15' }),
    (error) => error?.code === 'CALENDAR_BOOKING_INELIGIBLE_SELECTION'
  );
  assert.equal(creates, 0);
});

test('New client uses createClient, exact actor provenance, server reread and exposes exact reviewed mobile', async () => {
  const createCalls = [];
  const getCalls = [];
  const prepareCalls = [];
  const service = createCalendarCreateBookingService({
    db: bookingDb(),
    env: enabledEnv,
    crmV2Service: crmV2({
      async createClient(input) { createCalls.push(input); return { status: 'created', client: v2Client() }; },
      async getClientById(id) { getCalls.push(id); return v2Client({ id: String(id) }); },
    }),
    prepareBooking: async (input) => { prepareCalls.push(input); return preparedResult(input.crmV2Client); },
  });
  const result = await service.prepare({ adminId: TEST_ADMIN_ID, newClient: { name: 'Jane Doe', mobile: '082 123 4567' }, staffId: 9, serviceId: 44, date: '2026-08-28', time: '10:15' });
  assert.deepEqual(createCalls, [{ name: 'Jane Doe', mobile: '082 123 4567', actorReference: `calendar_admin:${TEST_ADMIN_ID}` }]);
  assert.deepEqual(getCalls, ['701']);
  assert.equal(prepareCalls[0].crmV2Client.id, '701');
  assert.equal(prepareCalls[0].adminId, TEST_ADMIN_ID);
  assert.equal(result.review.client.created, true);
  assert.equal(result.review.client.contactHint, 'ending in 4567');
  assert.equal(result.review.client.mobile, '+27821234567');
  assert.equal(Object.hasOwn(result.review, 'mobileAcknowledgementRequired'), false);
});

test('exact-mobile existing result resolves the same canonical CRM V2 client', async () => {
  const service = createCalendarCreateBookingService({
    db: bookingDb(),
    env: enabledEnv,
    crmV2Service: crmV2({
      async createClient() { return { status: 'existing', client: v2Client({ id: '333' }) }; },
      async getClientById(id) { return v2Client({ id: String(id), name: 'Existing Jane' }); },
    }),
    prepareBooking: async (input) => preparedResult(input.crmV2Client),
  });
  const result = await service.prepare({ adminId: TEST_ADMIN_ID, newClient: { name: 'Jane Doe', mobile: '0821234567' }, staffId: 9, serviceId: 44, date: '2026-08-28', time: '10:15' });
  assert.equal(result.review.client.id, '333');
  assert.equal(result.review.client.matchedExisting, true);
  assert.equal(result.review.client.created, false);
  assert.equal(result.review.client.mobile, '+27821234567');
});

test('CRM V2 exact-mobile conflict fails closed before pending booking preparation', async () => {
  let prepares = 0;
  const service = createCalendarCreateBookingService({
    db: bookingDb(),
    env: enabledEnv,
    crmV2Service: crmV2({ async createClient() { return { status: 'conflict', clientIds: ['1', '2'] }; } }),
    prepareBooking: async () => { prepares += 1; },
  });
  await assert.rejects(
    service.prepare({ adminId: TEST_ADMIN_ID, newClient: { name: 'Jane Doe', mobile: '0821234567' }, staffId: 9, serviceId: 44, date: '2026-08-28', time: '10:15' }),
    (error) => error?.code === 'CALENDAR_BOOKING_CRM_V2_CONFLICT'
  );
  assert.equal(prepares, 0);
});

test('Find client searches CRM V2 only and always requires explicit selection', async () => {
  const searches = [];
  const service = createCalendarCreateBookingService({
    db: bookingDb(),
    env: enabledEnv,
    crmV2Service: crmV2({ async searchClients(input) { searches.push(input); return [v2Client()]; } }),
  });
  const result = await service.searchClients(TEST_ADMIN_ID, '  Jane   Doe  ');
  assert.deepEqual(searches, [{ query: 'Jane Doe', status: 'active', limit: 10 }]);
  assert.equal(result.requiresExplicitSelection, true);
  assert.equal(result.identityModel, 'crm_v2_operator_search_only');
  assert.deepEqual(result.clients[0], {
    id: '701', displayName: 'Jane Doe', status: 'active', profileStatus: 'minimal', contactHint: 'ending in 4567',
  });
});

test('discard removes only the server pending session and never deletes a CRM V2 client', async () => {
  const cancellations = [];
  const service = createCalendarCreateBookingService({
    db: bookingDb(),
    env: enabledEnv,
    crmV2Service: crmV2(),
    cancelBooking: async (adminId) => { cancellations.push(adminId); return true; },
  });
  const result = await service.discard({ adminId: TEST_ADMIN_ID });
  assert.deepEqual(cancellations, [TEST_ADMIN_ID]);
  assert.deepEqual(result, { status: 'discarded', crmV2ClientRemoved: false });
});

test('booking review and route contain no final-mobile acknowledgement ceremony', () => {
  assert.doesNotMatch(uxSource, /Final mobile acknowledgement|Acknowledge final mobile|data-mobile-ack|mobileAcknowledged/);
  assert.doesNotMatch(routeSource, /router\.post\('\/mobile-acknowledgement'/);
  assert.match(uxSource, /data-create-booking/);
  assert.match(uxSource, /Create booking/);
});

test('direct confirmation delegates once with authenticated operator and bounded source without acknowledgement state', async () => {
  const calls = [];
  const service = createCalendarCreateBookingService({
    db: bookingDb({ pending: pending() }),
    env: enabledEnv,
    crmV2Service: crmV2(),
    confirmBooking: async (...args) => { calls.push(args); return { status: 'created', appointmentId: 9001 }; },
  });
  const result = await service.confirm({ adminId: TEST_ADMIN_ID, clientId: 999, mobile: '27829999999' });
  assert.equal(result.appointmentId, 9001);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].id, TEST_ADMIN_ID);
  assert.deepEqual(calls[0][1], { source: 'shiloh_calendar', notes: null });
});

test('Calendar V2 path has no legacy lookup, shadow client/contact write or identity-evidence dependency', () => {
  assert.doesNotMatch(serviceSource, /adminClientLookup|adminProvisionalClient|operatorContactAuthority|client_identity_verifications|client_facing_name_authorities|client_contacts/);
  assert.doesNotMatch(serviceSource, /INSERT INTO\s+(?:clients|client_contacts)/i);
  assert.match(serviceSource, /crmV2Service\.searchClients/);
  assert.match(serviceSource, /crmV2Service\.createClient/);
  assert.match(serviceSource, /crmV2Service\.getClientById/);
  assert.doesNotMatch(routeSource, /bookingContext|\/client-authority/);
});
