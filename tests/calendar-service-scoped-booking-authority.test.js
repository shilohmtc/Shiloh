const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createCalendarCreateBookingService } = require('../src/services/calendarCreateBooking');
const {
  CALENDAR_CAPABILITIES,
  evaluateCalendarAuthority,
  allowsBookingTarget,
} = require('../src/services/calendarAuthorization');

const enabledEnv = {};
const principals = {
  christel: { id: 2, staff_id: 9, display_name: 'Christel', role: 'owner', business_role: 'owner', calendar_scope: 'all_business', service_scope: 'all_services', permissions: { 'appointment:create': true, 'client:lookup': true }, admin_active: true, staff_status: 'active', client_bookable: true },
  abigail: { id: 3, staff_id: 10, display_name: 'Abigail', role: 'practitioner', business_role: 'employee_practitioner', calendar_scope: 'own_appointments', service_scope: 'own_services', permissions: { 'appointment:view': true, 'client:lookup': true }, admin_active: true, staff_status: 'active', client_bookable: true },
  marietjie: { id: 4, staff_id: 11, display_name: 'Marietjie', role: 'practitioner', business_role: 'tenant_practitioner', calendar_scope: 'own_services', service_scope: 'own_services', permissions: { 'appointment:view': true, 'appointment:create': true, 'client:lookup': true }, admin_active: true, staff_status: 'active', client_bookable: true },
  naomi: { id: 6, staff_id: null, display_name: 'Naomi', role: 'receptionist', business_role: 'booking_operator', calendar_scope: 'all_business', service_scope: 'all_services', permissions: { 'appointment:view': true, 'appointment:create': true, 'client:lookup': true }, admin_active: true, staff_status: null, client_bookable: null },
  jp: { id: 5, staff_id: null, display_name: 'Jean-Pierre', role: 'admin', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services', permissions: { 'appointment:create': true, 'client:lookup': true }, admin_active: true, staff_status: null, client_bookable: null },
};

function eligibleRow(overrides = {}) {
  return { staff_id: 20, staff_name: 'Target Practitioner', service_id: 44, service_name: 'Deep Tissue Massage', duration_minutes: 60, processing_time_minutes: 0, extra_time_minutes: 0, price: '650.00', variable_price: false, ...overrides };
}

function scriptedDb(handler) {
  const calls = [];
  return { calls, async query(sql, params = []) { const call = { sql: String(sql), params }; calls.push(call); return (await handler(call)) || { rows: [], rowCount: 0 }; } };
}

function bookingDb({ admin, pending = null, selection = eligibleRow(), optionRows = null, allowedServiceIds = [44] } = {}) {
  return scriptedDb(async (call) => {
    if (call.sql.includes('FROM staff_admin_accounts a')) return Number(call.params[0]) === Number(admin?.id) ? { rows: [admin], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (call.sql.includes('calendarAuthorization:services')) return { rows: allowedServiceIds.map((service_id) => ({ service_id })), rowCount: allowedServiceIds.length };
    if (call.sql.includes('FROM admin_booking_sessions abs')) return pending ? { rows: [pending], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (call.sql.includes('JOIN staff_services ss')) {
      if (call.sql.includes('st.id = $1')) return selection ? { rows: [selection], rowCount: 1 } : { rows: [], rowCount: 0 };
      const rows = optionRows || [selection]; return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

function client(id = '123') {
  return { id, name: 'Jane Doe', normalizedMobile: '27821234567', profileStatus: 'minimal', status: 'active' };
}

function crmV2() {
  return { async searchClients() { return []; }, async getClientById(id) { return client(String(id)); }, async createClient() { return { status: 'created', client: client() }; } };
}

function pending(overrides = {}) {
  return { crm_v2_client_id: 123, source_client_name: 'Jane Doe', client_mobile_snapshot: '27821234567', staff_id: 20, service_id: 44, location_id: 1, starts_at: '2026-08-28T08:15:00.000Z', ends_at: '2026-08-28T09:15:00.000Z', state: 'confirm', current_client_name: 'Jane Doe', current_client_mobile: '27821234567', current_client_status: 'active', ...overrides };
}

test('Calendar booking authority is capability/scope data, not a named-person policy', () => {
  const marietjie = evaluateCalendarAuthority(principals.marietjie, { allowedServiceIds: [44] });
  const renamed = evaluateCalendarAuthority({ ...principals.marietjie, display_name: 'Replacement operator' }, { allowedServiceIds: [44] });
  assert.deepEqual(renamed, marietjie);
  assert.equal(allowsBookingTarget(marietjie, { staffId: 20, serviceId: 44 }), true);
  assert.equal(allowsBookingTarget(marietjie, { staffId: 20, serviceId: 45 }), false);
  const abigail = evaluateCalendarAuthority(principals.abigail, { allowedServiceIds: [44] });
  assert.equal(abigail.capabilities.includes(CALENDAR_CAPABILITIES.BOOKING_CREATE), false);
  assert.equal(allowsBookingTarget(abigail, { staffId: 10, serviceId: 44 }), false);
  assert.equal(evaluateCalendarAuthority({ ...principals.marietjie, admin_active: false }, { allowedServiceIds: [44] }), null);
});

test('all-business/all-services booking scope is canonical data and has no named union', async () => {
  const db = bookingDb({ admin: principals.jp });
  const service = createCalendarCreateBookingService({ db, env: enabledEnv, crmV2Service: crmV2() });
  const admin = await service.resolveOperator(principals.jp.id);
  assert.deepEqual(admin.bookingScope, { key: 'all_business:all_services', calendarScope: 'all_business', serviceScope: 'all_services' });
  assert.equal(db.calls.some((call) => /Christel|Abigail|Jean-Pierre/.test(call.sql)), false);
});

test('reception booking options declare practitioner-first presentation without changing service authority', async () => {
  const db = bookingDb({ admin: principals.naomi });
  const service = createCalendarCreateBookingService({ db, env: enabledEnv, crmV2Service: crmV2() });
  const options = await service.listBookableOptions(principals.naomi.id);
  assert.equal(options.authority.serviceScope, 'all_business:all_services');
  assert.equal(options.authority.bookingFlow, 'practitioner_first');
  assert.equal(options.services[0].staffIds[0], 20);
});

test('bookable catalogue and prepare remain bounded by authenticated service relationships', async () => {
  const db = bookingDb({ admin: principals.marietjie, optionRows: [eligibleRow(), eligibleRow({ staff_id: 21 })] });
  const prepareCalls = [];
  const service = createCalendarCreateBookingService({
    db,
    env: enabledEnv,
    crmV2Service: crmV2(),
    prepareBooking: async (input) => {
      prepareCalls.push(input);
      return { status: 'pending_confirmation', client: input.crmV2Client, staff: { id: 20, display_name: 'Target Practitioner' }, service: { id: 44, name: 'Deep Tissue Massage', price: '650.00', variable_price: false }, startsAt: '2026-08-28T08:15:00.000Z', endsAt: '2026-08-28T09:15:00.000Z' };
    },
  });
  const options = await service.listBookableOptions(principals.marietjie.id);
  assert.equal(options.authority.serviceScope, 'own_services:own_services');
  const result = await service.prepare({ adminId: principals.marietjie.id, clientId: 123, staffId: 20, serviceId: 44, date: '2026-08-28', time: '10:15' });
  assert.equal(result.status, 'pending_confirmation');
  assert.equal(prepareCalls[0].adminId, principals.marietjie.id);
  assert.equal(prepareCalls[0].crmV2Client.id, '123');
  const selection = db.calls.find((call) => call.sql.includes('st.id = $1'));
  assert.deepEqual(selection.params, [20, 44]);
});

test('out-of-scope service is rejected before CRM V2 lookup or booking preparation', async () => {
  let clientReads = 0; let prepares = 0;
  const service = createCalendarCreateBookingService({
    db: bookingDb({ admin: principals.marietjie, allowedServiceIds: [] }),
    env: enabledEnv,
    crmV2Service: { ...crmV2(), async getClientById() { clientReads += 1; return client(); } },
    prepareBooking: async () => { prepares += 1; },
  });
  await assert.rejects(service.prepare({ adminId: principals.marietjie.id, clientId: 123, staffId: 20, serviceId: 44, date: '2026-08-28', time: '10:15' }), (error) => error?.code === 'CALENDAR_BOOKING_INELIGIBLE_SELECTION');
  assert.equal(clientReads, 0);
  assert.equal(prepares, 0);
});

test('direct final confirmation is bound to session actor, scope and V2 pending state', async () => {
  const db = bookingDb({ admin: principals.marietjie, pending: pending() });
  const confirmCalls = [];
  const service = createCalendarCreateBookingService({
    db,
    env: enabledEnv,
    crmV2Service: crmV2(),
    confirmBooking: async (...args) => { confirmCalls.push(args); return { status: 'created', appointmentId: 777 }; },
  });
  const result = await service.confirm({ adminId: principals.marietjie.id, notes: ' staff only ', actorAdminId: 99, clientId: 999, mobile: '27829999999' });
  assert.equal(confirmCalls.length, 1);
  assert.equal(confirmCalls[0][0].id, principals.marietjie.id);
  assert.deepEqual(confirmCalls[0][1], { source: 'shiloh_calendar', notes: 'staff only' });
  assert.equal(result.appointmentId, 777);
  const pendingRead = db.calls.find((call) => call.sql.includes('FROM admin_booking_sessions abs'));
  assert.deepEqual(pendingRead.params, [principals.marietjie.id]);
});

test('Calendar confirm accepts only internal note body data, no browser identity, and acknowledgement ceremony endpoint is retired', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/calendarCreateBooking.js'), 'utf8');
  const confirm = routeSource.slice(routeSource.indexOf("router.post('/confirm'"));
  assert.doesNotMatch(routeSource, /router\.post\('\/mobile-acknowledgement'/);
  assert.match(confirm, /sameOrigin, requireSession, requireCsrf/);
  assert.match(confirm, /adminId: req\.staffBrowserSession\.adminId/);
  assert.match(confirm, /notes: req\.body\?\.notes/);
  assert.doesNotMatch(confirm, /clientId|mobile|actorAdminId/);
});

test('Calendar layer delegates V2 appointment writes while retaining canonical mobile snapshot and internal notes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/calendarCreateBooking.js'), 'utf8');
  assert.doesNotMatch(source, /INSERT INTO appointments|INSERT INTO clients|INSERT INTO client_contacts/);
  assert.match(source, /confirmBooking\(admin, \{ source: 'shiloh_calendar', notes: normalizedNotes \}\)/);
  assert.match(source, /client_mobile_snapshot/);
  assert.doesNotMatch(source, /mobile_acknowledged_at|acknowledged_mobile|acknowledgeMobile/);
  assert.doesNotMatch(source, /operatorContactAuthority|client_identity_verifications/);
});
