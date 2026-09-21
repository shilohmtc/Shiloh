const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MIN_TREATMENTS,
  MAX_TREATMENTS,
  createCalendarMultiServiceBookingService,
  resolveAssignments,
  assertNoInternalConflicts,
} = require('../src/services/calendarMultiServiceBooking');
const {
  renderCalendarMultiServiceBookingPage,
  calendarMultiServiceBookingClientScript,
} = require('../src/presentation/calendarMultiServiceBookingUx');

const root = path.join(__dirname, '..');

const options = {
  services: [
    { id: 10, name: 'Lymphatic Drainage Session', durationMinutes: 60, price: 650, staffIds: [3] },
    { id: 11, name: 'Medi Heel Pedicure & Gel', durationMinutes: 60, price: 490, staffIds: [4] },
  ],
  staff: [
    { id: 3, displayName: 'Abigail' },
    { id: 4, displayName: 'Marietjie' },
  ],
};

test('multiple-treatment booking accepts 2-10 independently eligible treatment assignments', () => {
  assert.equal(MIN_TREATMENTS, 2);
  assert.equal(MAX_TREATMENTS, 10);
  const rows = resolveAssignments(options, [
    { serviceId: 10, staffId: 3, startTime: '09:00' },
    { serviceId: 11, staffId: 4, startTime: '10:00' },
  ]);
  assert.deepEqual(rows.map(row => [row.position, row.service.name, row.practitioner.displayName]), [
    [1, 'Lymphatic Drainage Session', 'Abigail'],
    [2, 'Medi Heel Pedicure & Gel', 'Marietjie'],
  ]);
  assert.throws(() => resolveAssignments(options, [{ serviceId: 10, staffId: 3 }]), /between 2 and 10/i);
  assert.throws(() => resolveAssignments(options, [
    { serviceId: 10, staffId: 4 },
    { serviceId: 11, staffId: 4 },
  ]), /eligible treatment and practitioner/i);
});

test('same-practitioner overlaps fail before an atomic linked booking can be created', () => {
  assert.throws(() => assertNoInternalConflicts([
    { practitioner: { id: 3 }, startsAt: '2026-09-22T07:00:00.000Z', endsAt: '2026-09-22T08:00:00.000Z' },
    { practitioner: { id: 3 }, startsAt: '2026-09-22T07:30:00.000Z', endsAt: '2026-09-22T08:30:00.000Z' },
  ]), /cannot provide two treatments at overlapping times/i);
  assert.doesNotThrow(() => assertNoInternalConflicts([
    { practitioner: { id: 3 }, startsAt: '2026-09-22T07:00:00.000Z', endsAt: '2026-09-22T08:00:00.000Z' },
    { practitioner: { id: 3 }, startsAt: '2026-09-22T08:00:00.000Z', endsAt: '2026-09-22T09:00:00.000Z' },
  ]));
});

test('staff UI starts with two treatments and supports a polished linked-visit review', () => {
  const page = renderCalendarMultiServiceBookingPage({ options, prefill: { date: '2026-09-22' } });
  const script = calendarMultiServiceBookingClientScript();
  assert.match(page, /Book multiple treatments/);
  assert.equal((page.match(/class="treatment-card"/g) || []).length, 3, 'two visible cards plus one template');
  assert.match(page, /one combined confirmation/i);
  assert.match(page, /data-add-treatment/);
  assert.match(script, /MIN=2,MAX=10/);
  assert.match(script, /suggestFollowingTimes/);
  assert.match(script, /same practitioner cannot provide overlapping treatments/i);
  assert.doesNotMatch(page, /transaction|payload|canonical CRM/i);
});

test('route is private, same-origin and CSRF protected for every mutation', () => {
  const route = fs.readFileSync(path.join(root, 'src/routes/calendarMultiServiceBooking.js'), 'utf8');
  assert.match(route, /requireStaffSession/);
  assert.match(route, /sameOriginGuard/);
  assert.match(route, /csrfGuard/);
  assert.match(route, /router\.post\('\/prepare', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /router\.post\('\/confirm', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /router\.post\('\/discard', sameOrigin, requireSession, requireCsrf/);
});

test('linked visit schema, atomic writes and combined confirmation remain explicit', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations/145_multi_service_client_bookings.sql'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/services/calendarMultiServiceBooking.js'), 'utf8');
  const confirmation = fs.readFileSync(path.join(root, 'src/services/customerBookingConfirmation.js'), 'utf8');
  const myShiloh = fs.readFileSync(path.join(root, 'src/services/myShilohClientContext.js'), 'utf8');
  const calendar = fs.readFileSync(path.join(root, 'src/presentation/calendarReadOnlyUx.js'), 'utf8');
  assert.match(migration, /multi_service_booking/);
  assert.match(service, /BEGIN/);
  assert.match(service, /ROLLBACK/);
  assert.match(service, /appointment_group_members/);
  assert.match(service, /queueConfirmation\(appointmentIds\[0\]/);
  assert.match(confirmation, /ag\.group_type='multi_service_booking'/);
  assert.match(confirmation, /string_agg\(aps\.service_name_snapshot,' \+ '/);
  assert.match(myShiloh, /linked_group\.group_type='multi_service_booking'/);
  assert.match(myShiloh, /group_seed\.guest_position=1/);
  assert.match(myShiloh, /linked_group\.final_total/);
  assert.match(calendar, /multi_service_booking'\) return 'Linked visit'/);
  assert.match(calendar, /'multi_service_booking'\]\.includes/);
});

test('final confirmation creates every treatment atomically and queues one combined client message', async () => {
  const calls = [];
  let nextAppointmentId = 701;
  const payload = {
    clientId: 55,
    clientMobile: '27821234567',
    locationId: 1,
    notes: 'Christa-style linked visit',
    assignments: [
      { position: 1, staffId: 3, serviceId: 10, durationMinutes: 60, unitPrice: 650, startsAt: '2026-09-22T07:00:00.000Z', endsAt: '2026-09-22T08:00:00.000Z' },
      { position: 2, staffId: 4, serviceId: 11, durationMinutes: 60, unitPrice: 490, startsAt: '2026-09-22T08:00:00.000Z', endsAt: '2026-09-22T09:00:00.000Z' },
    ],
  };
  const serviceRows = {
    10: { service_id: 10, service_name: 'Lymphatic Drainage Session', service_status: 'active', duration_minutes: 60, processing_time_minutes: 0, extra_time_minutes: 0, price: '650.00', variable_price: false, staff_id: 3, staff_name: 'Abigail', staff_status: 'active' },
    11: { service_id: 11, service_name: 'Medi Heel Pedicure & Gel', service_status: 'active', duration_minutes: 60, processing_time_minutes: 0, extra_time_minutes: 0, price: '490.00', variable_price: false, staff_id: 4, staff_name: 'Marietjie', staff_status: 'active' },
  };
  const connection = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ text, params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('FROM admin_multi_service_booking_sessions')) return { rows: [{ payload }], rowCount: 1 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (text.includes('FROM crm_v2_clients WHERE id=$1 FOR UPDATE')) return { rows: [{ id: 55, name: 'Christa', normalized_mobile: '27821234567', status: 'active' }], rowCount: 1 };
      if (text.includes("FROM locations WHERE id=$1 AND status='active'")) return { rows: [{ id: 1 }], rowCount: 1 };
      if (text.includes('FROM services sv JOIN staff_services')) return { rows: [serviceRows[Number(params[0])]], rowCount: 1 };
      if (text.includes("AT TIME ZONE 'Africa/Johannesburg')::date::text AS local_date")) {
        return { rows: [{ local_date: '2026-09-22', local_end_date: '2026-09-22', local_start: '09:00:00', local_end: '10:00:00' }], rowCount: 1 };
      }
      if (text.includes('WITH requested AS ( SELECT $2::date AS local_date')) {
        return { rows: [{ requested_dow: 2, is_holiday: false, weekly_start: '08:00:00', weekly_end: '18:00:00' }], rowCount: 1 };
      }
      if (text.startsWith('SELECT $1::time >= $3::time')) return { rows: [{ covered: true }], rowCount: 1 };
      if (text.startsWith('WITH requested AS (SELECT $2::timestamptz starts_at')) {
        return { rows: [{ scheduling_type: 'regular', inside_base_hours: false, inside_available_exception: false, all_day_unavailable: false, partial_unavailable: false }], rowCount: 1 };
      }
      if (text.startsWith('SELECT DISTINCT conflict_type')) return { rows: [], rowCount: 0 };
      if (text.includes("SELECT 'booking_request_proposal_hold'::text")) return { rows: [], rowCount: 0 };
      if (text.startsWith('INSERT INTO appointment_groups')) return { rows: [{ id: 88 }], rowCount: 1 };
      if (text.startsWith('INSERT INTO appointments')) return { rows: [{ id: nextAppointmentId++ }], rowCount: 1 };
      if (text.startsWith('INSERT INTO appointment_services')
        || text.startsWith('INSERT INTO appointment_staff')
        || text.startsWith('INSERT INTO appointment_group_members')
        || text.startsWith('INSERT INTO appointment_status_history')
        || text.startsWith('INSERT INTO crm_audit_events')
        || text.startsWith('DELETE FROM admin_multi_service_booking_sessions')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${text}`);
    },
    release() {},
  };
  const queueCalls = [];
  const sendCalls = [];
  const booking = createCalendarMultiServiceBookingService({
    db: { async connect() { return connection; } },
    standardBooking: {
      async resolveOperator() { return { id: 2, display_name: 'Christel' }; },
      async listBookableOptions() { return options; },
      async searchClients() { return { clients: [] }; },
    },
    queueConfirmation: async (appointmentId) => { queueCalls.push(appointmentId); return { queued: true, status: 'pending' }; },
    sendConfirmation: async (appointmentId) => { sendCalls.push(appointmentId); return { sent: true, deliveryStatus: 'sent' }; },
  });
  const result = await booking.confirm({ adminId: 2 });
  assert.deepEqual(result.appointmentIds, [701, 702]);
  assert.equal(result.groupId, 88);
  assert.equal(result.subtotal, 1140);
  assert.deepEqual(queueCalls, [701]);
  assert.deepEqual(sendCalls, [701]);
  assert.equal(calls.filter(call => call.text.startsWith('INSERT INTO appointments')).length, 2);
  assert.equal(calls.some(call => call.text === 'COMMIT'), true);
  assert.equal(calls.some(call => call.text === 'ROLLBACK'), false);
});
