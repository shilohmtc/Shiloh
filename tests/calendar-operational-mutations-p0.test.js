const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  OPERATIONS,
  createCalendarOperationalMutationService,
  staticMutationCapability,
  operationFingerprint,
  scheduleStateRevision,
  isOperationalLeave,
} = require('../src/services/calendarOperationalMutations');
const { calendarOperationalMutationsClientScript } = require('../src/presentation/calendarOperationalMutationsUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');

const ROOT = path.join(__dirname, '..');
const REVISION = '2026-08-27T05:00:00.000Z';
const NEXT_REVISION = '2026-08-27T05:01:00.000Z';
const FUTURE_START = '2026-09-03T06:00:00.000Z';
const FUTURE_END = '2026-09-03T06:45:00.000Z';

function adminRow(overrides = {}) {
  return {
    id: 71,
    staff_id: 1,
    display_name: 'Christel',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'own_services',
    permissions: {
      'appointment:view': true,
      'calendar:booking:reschedule': true,
      'calendar:booking:cancel': true,
      'calendar:booking:reassign': true,
      'schedule:manage': true,
    },
    admin_active: true,
    staff_status: 'active',
    ...overrides,
  };
}

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function fakeDatabase(handler, { replay = null, admin = adminRow(), allowedServiceIds = [25] } = {}) {
  const calls = [];
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return result();
    if (sql.includes('calendarAuthorization:principal')) return result(admin ? [admin] : []);
    if (sql.includes('calendarAuthorization:services')) return result(allowedServiceIds.map((service_id) => ({ service_id })));
    if (sql.includes('pg_advisory_xact_lock')) return result([{}]);
    if (sql.includes('calendarOperational:idempotency')) return result(replay ? [replay] : []);
    if (sql.startsWith('INSERT INTO crm_audit_events')) return result([{ id: 900 }]);
    return handler(sql, params, calls);
  };
  const client = { query, release() { calls.push({ sql: 'RELEASE', params: [] }); } };
  return {
    db: { query, async connect() { return client; } },
    calls,
  };
}

function appointmentHandler(overrides = {}) {
  return async (sql) => {
    if (sql.includes('FROM appointments') && (sql.includes('WHERE id=$1') || sql.includes('WHERE a.id=$1')) && sql.includes('FOR UPDATE')) {
      return result([{
        id: 592, location_id: 1, starts_at: FUTURE_START, ends_at: FUTURE_END,
        status: 'scheduled', updated_at: REVISION, booking_request_status: overrides.bookingRequestStatus || null,
      }]);
    }
    if (sql.includes('FROM appointment_staff ast')) {
      return result([{ assignment_id: 801, staff_id: 1, position: 1, staff_name_snapshot: 'Christel', display_name: 'Christel', staff_status: 'active' }]);
    }
    if (sql.includes('SELECT staff_id, staff_name_snapshot FROM appointment_staff')) {
      return result([{ staff_id: 1, staff_name_snapshot: 'Christel' }]);
    }
    if (sql.startsWith('SELECT status,updated_at FROM appointments')) return result([{ status: 'scheduled', updated_at: REVISION }]);
    if (sql.includes('FROM appointment_services')) {
      return result([{ id: 901, service_id: 25, position: 1, service_name_snapshot: 'Service' }]);
    }
    if (sql.includes("FROM staff") && sql.includes("resource_type='practitioner'")) {
      return result([{ id: Number(overrides.destinationStaffId || 2), display_name: 'Abigail', scheduling_type: 'regular' }]);
    }
    if (sql.includes('FROM staff_services')) return result(overrides.mappedRows || [{ service_id: 25 }]);
    if (sql.includes('SELECT conflict_type')) return result(overrides.conflicts || []);
    if (sql.startsWith('UPDATE appointments') && sql.includes('starts_at=')) {
      return result([{ id: 592, starts_at: overrides.newStart || '2026-09-10T06:00:00.000Z', ends_at: '2026-09-10T06:45:00.000Z', status: 'scheduled', updated_at: NEXT_REVISION }]);
    }
    if (sql.startsWith('UPDATE appointments') && sql.includes("status='cancelled'")) return result([{ id: 592, status: 'cancelled', updated_at: NEXT_REVISION }]);
    if (sql.startsWith('UPDATE appointments') && sql.includes('updated_at=NOW()')) return result([{ updated_at: NEXT_REVISION }]);
    if (sql.startsWith('UPDATE appointment_staff') || sql.startsWith('UPDATE appointment_lifecycle') || sql.startsWith('INSERT INTO appointment_status_history')) return result();
    if (sql.startsWith('UPDATE payment_requests pr')) return result();
    throw new Error(`Unexpected SQL: ${sql}`);
  };
}

function dayModel(capable) {
  const appointment = {
    kind: 'appointment', canonical: true, id: 592, revision: REVISION,
    startsAt: FUTURE_START, endsAt: FUTURE_END, status: 'scheduled',
    clientName: 'Client', serviceName: 'Service', staffIds: [1],
    serviceContexts: [{ serviceId: 25, serviceName: 'Service' }],
  };
  const block = {
    kind: 'calendar_block', canonical: true, id: 31, revision: REVISION,
    startsAt: '2026-09-03T08:00:00.000Z', endsAt: '2026-09-03T09:00:00.000Z',
    staffIds: [1], blockType: 'other', title: 'Admin',
  };
  const operationalLeave = {
    kind: 'operational_leave', canonical: true, id: 41, revision: REVISION,
    date: '2026-09-03', allDay: true, staffIds: [1], reason: 'Training',
  };
  const approvedLeave = {
    kind: 'approved_leave', canonical: true, id: 42, revision: REVISION,
    date: '2026-09-03', allDay: true, staffIds: [1], reason: 'Approved leave',
  };
  return {
    view: 'day', dateKey: '2026-09-03', selectedStaffId: null, readOnly: true,
    mutationCapability: capable && typeof capable === 'object' ? capable : capable ? {
      enabled: true,
      operations: OPERATIONS,
      calendarScope: 'all_business',
      serviceScope: 'all_services',
      linkedStaffId: 1,
      allowedServiceIds: null,
    } : { enabled: false },
    period: { dateKeys: ['2026-09-03'], startKey: '2026-09-03', previousAnchor: '2026-09-02', nextAnchor: '2026-09-04' },
    permittedStaff: [{ id: 1, displayName: 'Christel' }],
    timeline: {
      staff: [{ id: 1, displayName: 'Christel' }], workingWindows: [{ staffId: 1, dayOfWeek: 4, startsLocal: '08:00', endsLocal: '17:00' }],
      scheduleExceptions: [], recurringClosures: [], appointments: [appointment], blocks: [block],
      leave: [operationalLeave, approvedLeave], closures: [], externalBusy: [],
      events: [appointment, block, operationalLeave, approvedLeave],
    },
  };
}

test('mutation capability is data-configured, granular and fail-closed without person-name policy', () => {
  assert.deepEqual(staticMutationCapability(adminRow({ display_name: 'Any assigned operator' }), { allowedServiceIds: [25] }).operations, OPERATIONS);
  const bookingOnly = staticMutationCapability(adminRow({
    display_name: 'New operator without source changes',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: {
      'calendar:booking:reschedule': true,
      'calendar:booking:cancel': true,
      'calendar:booking:reassign': true,
    },
  }));
  assert.deepEqual(bookingOnly.operations, ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign']);
  assert.equal(staticMutationCapability(adminRow({ permissions: { 'appointment:view': true } }), { allowedServiceIds: [25] }), null);
  assert.equal(staticMutationCapability(adminRow({ admin_active: false })), null);
  assert.equal(staticMutationCapability(adminRow({ staff_status: 'inactive' })), null);
  assert.equal(staticMutationCapability(adminRow({ staff_id: null, staff_status: null, calendar_scope: 'own_services', service_scope: 'all_services' })), null);
});

test('least-privilege booking operator cannot cross into schedule mutations', async () => {
  const bookingOperator = adminRow({
    staff_id: null,
    staff_status: null,
    business_role: 'booking_operator',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: {
      'appointment:view': true,
      'appointment:create': true,
      'client:lookup': true,
      'calendar:booking:reschedule': true,
      'calendar:booking:cancel': true,
      'calendar:booking:reassign': true,
    },
  });
  const fake = fakeDatabase(async (sql) => { throw new Error(`Unexpected SQL after denied capability: ${sql}`); }, { admin: bookingOperator });
  const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
  await assert.rejects(service.createBlock({
    adminId: bookingOperator.id,
    staffId: 1,
    startsAt: FUTURE_START,
    endsAt: FUTURE_END,
    title: 'Must not write',
    requestId: 'least_privilege_block_1',
  }), (error) => error.code === 'CALENDAR_OPERATION_FORBIDDEN');
  assert.ok(fake.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!fake.calls.some((call) => call.sql.startsWith('INSERT INTO calendar_blocks')));
});

test('endpoint transaction rejects an appointment outside current service scope before mutation', async () => {
  const scopedOperator = adminRow({ calendar_scope: 'own_services', service_scope: 'own_services' });
  const fake = fakeDatabase(appointmentHandler(), { admin: scopedOperator, allowedServiceIds: [999] });
  const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
  await assert.rejects(service.reschedule({
    adminId: scopedOperator.id,
    appointmentId: 592,
    expectedRevision: REVISION,
    startsAt: '2026-09-10T06:00:00.000Z',
    requestId: 'scoped_reschedule_1',
  }), (error) => error.code === 'CALENDAR_OPERATION_FORBIDDEN');
  assert.ok(fake.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!fake.calls.some((call) => call.sql.startsWith('UPDATE appointments')));
});

test('cockpit exposes bounded canonical controls only with mutation capability', () => {
  const readOnly = renderCalendarPage(dayModel(false));
  assert.match(readOnly, /data-calendar-readonly="true"/);
  assert.doesNotMatch(readOnly, /operations\/client\.js|data-calendar-operation=|draggable=/);

  const capable = renderCalendarPage(dayModel(true));
  assert.match(capable, /data-calendar-readonly="false"/);
  assert.match(capable, /operations\/client\.js/);
  assert.match(capable, /data-appointment-id="592"[^>]*data-revision="2026-08-27T05:00:00.000Z"[^>]*draggable="true"/);
  assert.match(capable, /data-block-id="31"/);
  assert.match(capable, /data-leave-id="41"/);
  assert.doesNotMatch(capable, /data-leave-id="42"/i, 'approved workflow leave cannot be managed as operational leave');
  assert.match(capable, /data-calendar-operation="add-block"/);
  assert.match(capable, /data-calendar-operation="add-leave"/);
  assert.match(capable, /data-calendar-operation="manage-schedule"/);
  assert.match(capable, /@media\(max-width:700px\)[\s\S]*min-height:44px/);
});

test('unresolved booking requests are labelled and cannot expose generic Calendar appointment controls', () => {
  for (const state of ['pending', 'awaiting_client_confirmation']) {
    const model = dayModel(true);
    model.timeline.appointments[0].bookingRequestState = state;
    const html = renderCalendarPage(model);
    assert.match(html, /Booking request/);
    assert.match(html, state === 'pending' ? /Needs staff resolution/ : /Awaiting client confirmation/);
    assert.match(html, /href="\/calendar\/workspace#booking-request-592"/);
    assert.doesNotMatch(html, /data-appointment-id="592"/);
    assert.doesNotMatch(html, /data-calendar-operation="manage-appointment"/);
  }
});

test('reschedule, reassignment and cancellation fail closed while booking request resolution is active', async () => {
  for (const bookingRequestStatus of ['pending', 'awaiting_client_confirmation']) {
    for (const action of ['reschedule', 'reassign', 'cancel']) {
      const fake = fakeDatabase(appointmentHandler({ bookingRequestStatus }));
      const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
      const common = { adminId: 71, appointmentId: 592, expectedRevision: REVISION, requestId: `${action}_${bookingRequestStatus}` };
      const input = action === 'reschedule'
        ? { ...common, startsAt: '2026-09-10T06:00:00.000Z' }
        : action === 'reassign'
          ? { ...common, destinationStaffId: 2 }
          : { ...common, confirmation: { confirmed: true, appointmentId: 592, revision: REVISION }, reason: 'Clinic decision' };
      await assert.rejects(service[action](input), error => error.code === 'CALENDAR_OPERATION_BOOKING_REQUEST_UNRESOLVED');
      assert.equal(fake.calls.some(call => call.sql.startsWith('UPDATE appointments')), false);
      assert.ok(fake.calls.some(call => call.sql === 'ROLLBACK'));
    }
  }
});

test('cockpit renders only data-granted operation families for a booking operator', () => {
  const capability = {
    enabled: true,
    operations: ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign'],
    calendarScope: 'all_business',
    serviceScope: 'all_services',
    linkedStaffId: null,
    allowedServiceIds: null,
  };
  const html = renderCalendarPage(dayModel(capability));
  assert.match(html, /data-allowed-operations="appointment:reschedule,appointment:cancel,appointment:reassign"/);
  assert.match(html, /data-appointment-management-target="true" role="button" tabindex="0"/);
  assert.doesNotMatch(html, /data-calendar-operation="manage-appointment"/);
  assert.doesNotMatch(html, /data-calendar-operation="(?:add-block|add-leave|manage-schedule|manage-block|manage-leave)"/);
  assert.doesNotMatch(html, /data-block-id=|data-leave-id=/);
});

test('management panel and drag/drop rescheduling share one client function and one endpoint', () => {
  const script = calendarOperationalMutationsClientScript();
  assert.doesNotThrow(() => new Function(script));
  assert.equal((script.match(/function rescheduleAppointment\(/g) || []).length, 1);
  assert.equal((script.match(/\/appointments\/'\+data\.id\+'\/reschedule/g) || []).length, 1);
  assert.match(script, /data-panel-action="appointment:reschedule"/);
  assert.match(script, /rescheduleAppointment\(data,form\.elements\.date\.value,form\.elements\.time\.value\)/);
  assert.match(script, /askReschedule\(card,date\)/);
  assert.match(script, /window\.location\.reload\(\)/, 'browser never treats optimistic state as authoritative');
  assert.doesNotMatch(script, /adminId|actorAdminId|google|whatsapp|provider/i);
});

test('route chain is same-origin JSON, session, CSRF, capability and session-derived actor only', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/routes/calendarOperationalMutations.js'), 'utf8');
  assert.match(source, /const mutationChain = \[sameOrigin, requireSession, requireCsrf, requireCapability\]/);
  assert.match(source, /adminId: req\.staffBrowserSession\.adminId/g);
  assert.doesNotMatch(source, /adminId:\s*req\.body|actorAdminId:\s*req\.(?:body|query|params)/);
  assert.match(source, /router\.post\('\/appointments\/:appointmentId\/reschedule', \.\.\.mutationChain/);
  assert.match(source, /router\.post\('\/appointments\/:appointmentId\/cancel', \.\.\.mutationChain/);
  assert.match(source, /router\.put\('\/staff\/:staffId\/schedule\/:dayOfWeek', \.\.\.mutationChain/);
});

test('stale reschedule rolls back before locks or writes', async () => {
  const fake = fakeDatabase(appointmentHandler());
  const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
  await assert.rejects(service.reschedule({
    adminId: 71, appointmentId: 592, expectedRevision: '2026-08-27T04:59:00.000Z',
    startsAt: '2026-09-10T06:00:00.000Z', requestId: 'stale_reschedule_1',
  }), error => error.code === 'CALENDAR_OPERATION_STALE_REVISION');
  assert.ok(fake.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!fake.calls.some(call => call.sql.startsWith('UPDATE appointments')));
  assert.ok(!fake.calls.some(call => call.sql.startsWith('INSERT INTO crm_audit_events')));
});

for (const [name, clinicHours, authoritativeSchedule, conflicts, expectedCode] of [
  ['clinic hours', async () => ({ covered: false }), async () => ({ covered: true }), [], 'CALENDAR_OPERATION_CLINIC_HOURS'],
  ['staff schedule or leave/exception', async () => ({ covered: true }), async () => ({ covered: false, allDayUnavailable: true }), [], 'CALENDAR_OPERATION_STAFF_SCHEDULE'],
  ['canonical appointment conflict', async () => ({ covered: true }), async () => ({ covered: true }), [{ conflict_type: 'appointment', id: 700 }], 'CALENDAR_OPERATION_CONFLICT'],
  ['canonical block conflict', async () => ({ covered: true }), async () => ({ covered: true }), [{ conflict_type: 'calendar_block', id: 701 }], 'CALENDAR_OPERATION_CONFLICT'],
]) {
  test(`final reschedule validation rejects ${name} without mutation`, async () => {
    const fake = fakeDatabase(appointmentHandler({ conflicts }));
    const service = createCalendarOperationalMutationService({ db: fake.db, clinicHours, authoritativeSchedule, now: () => new Date('2026-08-27T00:00:00Z') });
    await assert.rejects(service.reschedule({
      adminId: 71, appointmentId: 592, expectedRevision: REVISION,
      startsAt: '2026-09-10T06:00:00.000Z', requestId: `reject_${expectedCode.toLowerCase()}`,
    }), error => error.code === expectedCode);
    assert.ok(fake.calls.some(call => call.sql === 'ROLLBACK'));
    assert.ok(!fake.calls.some(call => call.sql.startsWith('UPDATE appointments')));
  });
}

test('safe reschedule commits appointment, lifecycle and before/after audit atomically', async () => {
  const fake = fakeDatabase(appointmentHandler());
  const service = createCalendarOperationalMutationService({
    db: fake.db,
    clinicHours: async () => ({ covered: true }),
    authoritativeSchedule: async () => ({ covered: true }),
    now: () => new Date('2026-08-27T00:00:00Z'),
  });
  const saved = await service.reschedule({
    adminId: 71, appointmentId: 592, expectedRevision: REVISION,
    startsAt: '2026-09-10T06:00:00.000Z', requestId: 'safe_reschedule_1',
  });
  assert.equal(saved.status, 'rescheduled');
  assert.ok(fake.calls.some(call => call.sql.startsWith('UPDATE appointments')));
  assert.ok(fake.calls.some(call => call.sql.startsWith('UPDATE appointment_lifecycle')));
  assert.ok(fake.calls.some(call => call.sql.startsWith('UPDATE payment_requests pr')));
  const audit = fake.calls.find(call => call.sql.startsWith('INSERT INTO crm_audit_events'));
  assert.equal(audit.params[0], 71);
  assert.match(audit.params[4], /"before"/);
  assert.match(audit.params[4], /"after"/);
  assert.ok(fake.calls.some(call => call.sql === 'COMMIT'));
});

test('idempotent reschedule replay commits no second domain write or audit', async () => {
  const requestId = 'replay_reschedule_1';
  const startsAt = '2026-09-10T06:00:00.000Z';
  const fingerprint = operationFingerprint('calendar.appointment_rescheduled', { appointmentId: 592, expectedRevision: REVISION, startsAt });
  const fake = fakeDatabase(async (sql) => {
    throw new Error(`Unexpected SQL after replay: ${sql}`);
  }, { replay: { entity_id: 592, metadata: { requestFingerprint: fingerprint } } });
  const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
  const replay = await service.reschedule({ adminId: 71, appointmentId: 592, expectedRevision: REVISION, startsAt, requestId });
  assert.deepEqual(replay, { status: 'idempotent_replay', entityId: 592 });
  assert.ok(!fake.calls.some(call => call.sql.includes('FROM appointments')));
  assert.ok(!fake.calls.some(call => call.sql.startsWith('INSERT INTO crm_audit_events')));
});

test('reassignment fails closed on incomplete service mapping and destination conflicts', async () => {
  for (const mode of ['mapping', 'conflict']) {
    const fake = fakeDatabase(appointmentHandler({
      destinationStaffId: 2,
      mappedRows: mode === 'mapping' ? [] : [{ service_id: 25 }],
      conflicts: mode === 'conflict' ? [{ conflict_type: 'calendar_block', id: 88 }] : [],
    }));
    const service = createCalendarOperationalMutationService({
      db: fake.db, clinicHours: async () => ({ covered: true }), authoritativeSchedule: async () => ({ covered: true }),
    });
    await assert.rejects(service.reassign({
      adminId: 71, appointmentId: 592, expectedRevision: REVISION,
      destinationStaffId: 2, requestId: `reassign_${mode}_1`,
    }), error => error.code === (mode === 'mapping' ? 'CALENDAR_OPERATION_SERVICE_MAPPING' : 'CALENDAR_OPERATION_CONFLICT'));
    assert.ok(!fake.calls.some(call => call.sql.startsWith('UPDATE appointment_staff')));
  }
});

test('cancellation requires exact confirmation and audits the authenticated operator without a sender', async () => {
  const serviceWithoutDbUse = createCalendarOperationalMutationService({ db: fakeDatabase(appointmentHandler()).db });
  await assert.rejects(serviceWithoutDbUse.cancel({
    adminId: 71, appointmentId: 592, expectedRevision: REVISION,
    confirmation: { confirmed: true, appointmentId: 591, revision: REVISION }, reason: 'Clinic decision', requestId: 'cancel_wrong_1',
  }), error => error.code === 'CALENDAR_OPERATION_CANCELLATION_CONFIRMATION');

  const fake = fakeDatabase(appointmentHandler());
  const service = createCalendarOperationalMutationService({ db: fake.db });
  const cancelled = await service.cancel({
    adminId: 71, appointmentId: 592, expectedRevision: REVISION,
    confirmation: { confirmed: true, appointmentId: 592, revision: REVISION }, reason: 'Clinic decision', requestId: 'cancel_exact_1',
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(fake.calls.some(call => call.sql.startsWith('INSERT INTO appointment_status_history')));
  assert.ok(fake.calls.some(call => call.sql.startsWith('UPDATE appointment_lifecycle')));
  const audit = fake.calls.find(call => call.sql.startsWith('INSERT INTO crm_audit_events'));
  assert.equal(audit.params[0], 71);
  assert.doesNotMatch(audit.params.at(-1), /phone|sender/i);
});

test('block and operational leave conflicts roll back without changing appointments', async () => {
  for (const kind of ['block', 'leave']) {
    const fake = fakeDatabase(async (sql) => {
      if (sql.includes("FROM staff") && sql.includes("resource_type='practitioner'")) return result([{ id: 1, display_name: 'Christel', scheduling_type: 'regular' }]);
      if (sql.includes('FROM appointments a') && sql.includes('JOIN appointment_staff')) return result([{ id: 592, starts_at: FUTURE_START, ends_at: FUTURE_END }]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
    const promise = kind === 'block'
      ? service.createBlock({ adminId: 71, staffId: 1, startsAt: FUTURE_START, endsAt: FUTURE_END, title: 'Admin', requestId: 'block_conflict_1' })
      : service.createLeave({ adminId: 71, staffId: 1, date: '2026-09-03', reason: 'Training', requestId: 'leave_conflict_1' });
    await assert.rejects(promise, error => error.code === (kind === 'block' ? 'CALENDAR_OPERATION_BLOCK_APPOINTMENT_CONFLICT' : 'CALENDAR_OPERATION_LEAVE_APPOINTMENT_CONFLICT'));
    assert.ok(fake.calls.some(call => call.sql === 'ROLLBACK'));
    assert.ok(!fake.calls.some(call => /^INSERT INTO (calendar_blocks|staff_schedule_exceptions)/.test(call.sql)));
    assert.ok(!fake.calls.some(call => call.sql.startsWith('UPDATE appointments')));
  }
});

test('block edit and operational-leave edit reject appointment conflicts before writes', async () => {
  for (const kind of ['block', 'leave']) {
    const fake = fakeDatabase(async (sql) => {
      if (sql.startsWith("SELECT * FROM calendar_blocks")) {
        return result([{ id: 31, staff_id: 1, location_id: 1, block_type: 'other', starts_at: FUTURE_START, ends_at: FUTURE_END, title: 'Admin', source: 'shiloh', updated_at: REVISION }]);
      }
      if (sql.startsWith('SELECT * FROM staff_schedule_exceptions')) {
        return result([{ id: 41, staff_id: 1, location_id: 1, exception_date: '2026-09-03', exception_type: 'unavailable', starts_local: null, ends_local: null, reason: 'Operational leave by Calendar admin #71: Training', updated_at: REVISION }]);
      }
      if (sql.includes("FROM staff") && sql.includes("resource_type='practitioner'")) return result([{ id: 1, display_name: 'Christel', scheduling_type: 'regular' }]);
      if (sql.includes('FROM appointments a') && sql.includes('JOIN appointment_staff')) return result([{ id: 592, starts_at: FUTURE_START, ends_at: FUTURE_END }]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
    const promise = kind === 'block'
      ? service.editBlock({ adminId: 71, blockId: 31, expectedRevision: REVISION, staffId: 1, locationId: 1, startsAt: FUTURE_START, endsAt: FUTURE_END, title: 'Admin', requestId: 'block_edit_conflict_1' })
      : service.editLeave({ adminId: 71, leaveId: 41, expectedRevision: REVISION, locationId: 1, date: '2026-09-03', reason: 'Training', requestId: 'leave_edit_conflict_1' });
    await assert.rejects(promise, error => error.code === (kind === 'block' ? 'CALENDAR_OPERATION_BLOCK_APPOINTMENT_CONFLICT' : 'CALENDAR_OPERATION_LEAVE_APPOINTMENT_CONFLICT'));
    assert.ok(fake.calls.some(call => call.sql === 'ROLLBACK'));
    assert.ok(!fake.calls.some(call => /^UPDATE (calendar_blocks|staff_schedule_exceptions)/.test(call.sql)));
  }
});

test('safe block and leave writes commit once with distinct audit provenance', async () => {
  for (const kind of ['block', 'leave']) {
    const fake = fakeDatabase(async (sql) => {
      if (sql.includes("FROM staff") && sql.includes("resource_type='practitioner'")) return result([{ id: 1, display_name: 'Christel', scheduling_type: 'regular' }]);
      if (sql.includes('FROM appointments a') && sql.includes('JOIN appointment_staff')) return result();
      if (sql.startsWith('SELECT id FROM calendar_blocks') || sql.startsWith('SELECT id FROM staff_schedule_exceptions')) return result();
      if (sql.startsWith('INSERT INTO calendar_blocks')) return result([{ id: 31, updated_at: NEXT_REVISION }]);
      if (sql.startsWith('INSERT INTO staff_schedule_exceptions')) return result([{ id: 41, updated_at: NEXT_REVISION }]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = createCalendarOperationalMutationService({ db: fake.db, now: () => new Date('2026-08-27T00:00:00Z') });
    const saved = kind === 'block'
      ? await service.createBlock({ adminId: 71, staffId: 1, startsAt: '2026-09-03T08:00:00.000Z', endsAt: '2026-09-03T09:00:00.000Z', title: 'Admin', requestId: 'block_safe_001' })
      : await service.createLeave({ adminId: 71, staffId: 1, date: '2026-09-03', reason: 'Training', requestId: 'leave_safe_001' });
    assert.equal(saved.status, 'created');
    assert.equal(fake.calls.filter(call => call.sql.startsWith('INSERT INTO crm_audit_events')).length, 1);
    if (kind === 'leave') {
      const insert = fake.calls.find(call => call.sql.startsWith('INSERT INTO staff_schedule_exceptions'));
      assert.match(insert.params[3], /^Operational leave by Calendar admin #71:/);
    }
    assert.ok(fake.calls.some(call => call.sql === 'COMMIT'));
  }
});

test('block and operational-leave removals commit without moving or cancelling appointments', async () => {
  for (const kind of ['block', 'leave']) {
    const fake = fakeDatabase(async (sql) => {
      if (sql.startsWith("SELECT * FROM calendar_blocks")) {
        return result([{ id: 31, staff_id: 1, location_id: 1, block_type: 'other', starts_at: FUTURE_START, ends_at: FUTURE_END, source: 'shiloh', updated_at: REVISION }]);
      }
      if (sql.startsWith('SELECT * FROM staff_schedule_exceptions')) {
        return result([{ id: 41, staff_id: 1, location_id: 1, exception_date: '2026-09-03', exception_type: 'unavailable', starts_local: null, ends_local: null, reason: 'Operational leave by Calendar admin #71: Training', updated_at: REVISION }]);
      }
      if (sql.startsWith('DELETE FROM calendar_blocks') || sql.startsWith('DELETE FROM staff_schedule_exceptions')) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = createCalendarOperationalMutationService({ db: fake.db });
    const removed = kind === 'block'
      ? await service.removeBlock({ adminId: 71, blockId: 31, expectedRevision: REVISION, requestId: 'block_remove_001' })
      : await service.removeLeave({ adminId: 71, leaveId: 41, expectedRevision: REVISION, requestId: 'leave_remove_001' });
    assert.equal(removed.status, 'removed');
    assert.ok(fake.calls.some(call => call.sql === 'COMMIT'));
    assert.ok(!fake.calls.some(call => call.sql.startsWith('UPDATE appointments')));
    assert.ok(!fake.calls.some(call => call.sql.startsWith('DELETE FROM appointments')));
  }
});

test('non-regular schedule narrowing that strands an appointment rolls back the tentative schedule', async () => {
  const windows = [{ id: 1, starts_local: '08:00:00', ends_local: '17:00:00', updated_at: REVISION }];
  const expectedRevision = scheduleStateRevision({ staffId: 1, dayOfWeek: 4, locationId: null, windows, closures: [] });
  const fake = fakeDatabase(async (sql) => {
    if (sql.includes("FROM staff") && sql.includes("resource_type='practitioner'")) return result([{ id: 1, display_name: 'Freelancer', scheduling_type: 'freelance' }]);
    if (sql.includes('FROM staff_working_hours')) return result(windows);
    if (sql.includes('FROM staff_recurring_day_closures')) return result();
    if (sql.startsWith('DELETE FROM') || sql.startsWith('INSERT INTO staff_working_hours')) return result();
    if (sql.includes('FROM appointments a') && sql.includes('FOR SHARE OF a')) return result([{ id: 592, location_id: 1, starts_at: FUTURE_START, ends_at: FUTURE_END }]);
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createCalendarOperationalMutationService({ db: fake.db, authoritativeSchedule: async () => ({ covered: false }) });
  await assert.rejects(service.setWorkingSchedule({
    adminId: 71, staffId: 1, dayOfWeek: 4, mode: 'window', startsLocal: '09:00', endsLocal: '12:00',
    expectedRevision, requestId: 'schedule_strand_1',
  }), error => error.code === 'CALENDAR_OPERATION_SCHEDULE_APPOINTMENT_CONFLICT' && error.details.appointments[0].id === 592);
  assert.ok(fake.calls.some(call => call.sql.startsWith('DELETE FROM staff_working_hours')));
  assert.ok(fake.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!fake.calls.some(call => call.sql === 'COMMIT'));
  assert.ok(!fake.calls.some(call => call.sql.startsWith('INSERT INTO crm_audit_events')));
});

test('safe non-regular schedule replacement commits atomically with revision and audit', async () => {
  const beforeWindows = [{ id: 1, starts_local: '08:00:00', ends_local: '17:00:00', updated_at: REVISION }];
  const afterWindows = [{ id: 2, starts_local: '09:00:00', ends_local: '16:00:00', updated_at: NEXT_REVISION }];
  const expectedRevision = scheduleStateRevision({ staffId: 1, dayOfWeek: 4, locationId: null, windows: beforeWindows, closures: [] });
  let windowReads = 0;
  const fake = fakeDatabase(async (sql) => {
    if (sql.includes("FROM staff") && sql.includes("resource_type='practitioner'")) return result([{ id: 1, display_name: 'Freelancer', scheduling_type: 'freelance' }]);
    if (sql.includes('FROM staff_working_hours')) return result(windowReads++ === 0 ? beforeWindows : afterWindows);
    if (sql.includes('FROM staff_recurring_day_closures')) return result();
    if (sql.startsWith('DELETE FROM') || sql.startsWith('INSERT INTO staff_working_hours')) return result();
    if (sql.includes('FROM appointments a') && sql.includes('FOR SHARE OF a')) return result();
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createCalendarOperationalMutationService({ db: fake.db, authoritativeSchedule: async () => ({ covered: true }) });
  const saved = await service.setWorkingSchedule({
    adminId: 71, staffId: 1, dayOfWeek: 4, mode: 'window', startsLocal: '09:00', endsLocal: '16:00',
    expectedRevision, requestId: 'schedule_safe_01',
  });
  assert.equal(saved.status, 'updated');
  assert.equal(saved.mode, 'window');
  assert.ok(fake.calls.some(call => call.sql === 'COMMIT'));
  assert.equal(fake.calls.filter(call => call.sql.startsWith('INSERT INTO crm_audit_events')).length, 1);
});

test('non-regular working-schedule closure and inheritance restoration use canonical schedule strands safely', async () => {
  for (const mode of ['closed', 'inherit']) {
    const beforeWindows = [{ id: 1, starts_local: '08:00:00', ends_local: '17:00:00', updated_at: REVISION }];
    const expectedRevision = scheduleStateRevision({ staffId: 1, dayOfWeek: 4, locationId: null, windows: beforeWindows, closures: [] });
    let windowReads = 0;
    let closureReads = 0;
    const fake = fakeDatabase(async (sql) => {
      if (sql.includes("FROM staff") && sql.includes("resource_type='practitioner'")) return result([{ id: 1, display_name: 'Freelancer', scheduling_type: 'freelance' }]);
      if (sql.includes('FROM staff_working_hours')) return result(windowReads++ === 0 ? beforeWindows : []);
      if (sql.includes('FROM staff_recurring_day_closures')) {
        closureReads += 1;
        return result(closureReads > 1 && mode === 'closed' ? [{ id: 3, updated_at: NEXT_REVISION }] : []);
      }
      if (sql.startsWith('DELETE FROM') || sql.startsWith('INSERT INTO staff_recurring_day_closures')) return result();
      if (sql.includes('FROM appointments a') && sql.includes('FOR SHARE OF a')) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = createCalendarOperationalMutationService({ db: fake.db, authoritativeSchedule: async () => ({ covered: true }) });
    const saved = await service.setWorkingSchedule({ adminId: 71, staffId: 1, dayOfWeek: 4, mode, expectedRevision, requestId: `schedule_${mode}_01` });
    assert.equal(saved.mode, mode);
    assert.equal(fake.calls.some(call => call.sql.startsWith('INSERT INTO staff_recurring_day_closures')), mode === 'closed');
    assert.ok(fake.calls.some(call => call.sql === 'COMMIT'));
  }
});

test('operator authority is re-read inside the transaction and changed/inactive authority fails closed', async () => {
  const calls = [];
  const client = {
    async query(text) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return result();
      if (sql.includes('calendarAuthorization:principal')) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const db = { query: client.query.bind(client), async connect() { return client; } };
  const service = createCalendarOperationalMutationService({ db, now: () => new Date('2026-08-27T00:00:00Z') });
  await assert.rejects(service.createBlock({
    adminId: 71, staffId: 1, startsAt: FUTURE_START, endsAt: FUTURE_END,
    title: 'Admin', requestId: 'inactive_operator_1',
  }), error => error.code === 'CALENDAR_OPERATION_FORBIDDEN');
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(!calls.some(sql => sql.startsWith('INSERT INTO calendar_blocks')));
});

test('operational leave is distinct and implementation introduces no Google or client/provider send', () => {
  assert.equal(isOperationalLeave({ exception_type: 'unavailable', starts_local: null, ends_local: null, reason: 'Operational leave by Calendar admin #71: Training' }), true);
  assert.equal(isOperationalLeave({ exception_type: 'unavailable', starts_local: null, ends_local: null, reason: 'Approved leave request #9: Training' }), false);
  const implementation = [
    'src/services/calendarOperationalMutations.js',
    'src/routes/calendarOperationalMutations.js',
    'src/presentation/calendarOperationalMutationsUx.js',
  ].map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  assert.doesNotMatch(implementation, /googleapis|googleCalendar|createEvent|deleteEvent|sendWhatsApp|sendTemplate|providerMessage|whatsapp\.js/i);
  assert.doesNotMatch(implementation, /INSERT INTO staff_leave_requests|UPDATE staff_leave_requests/i);
  assert.match(implementation, /source\)\s*[\s\S]*'shiloh'/i);
  assert.match(implementation, /ROLLBACK/);
});

test('Create Booking and mutations share capability/scope policy without named-person authorization', () => {
  const booking = fs.readFileSync(path.join(ROOT, 'src/services/calendarCreateBooking.js'), 'utf8');
  const mutations = fs.readFileSync(path.join(ROOT, 'src/services/calendarOperationalMutations.js'), 'utf8');
  const policy = fs.readFileSync(path.join(ROOT, 'src/services/calendarAuthorization.js'), 'utf8');
  assert.match(booking, /resolveCalendarAuthority/);
  assert.match(mutations, /resolveCalendarAuthority/);
  assert.match(policy, /CALENDAR_CAPABILITIES/);
  assert.doesNotMatch(`${booking}\n${mutations}\n${policy}`, /GOVERNED_PRACTITIONERS|OPERATIONAL_PRINCIPALS|JP_UNION_PRINCIPALS|jean-pierre|christel|abigail|marietjie|naomi/i);
});
