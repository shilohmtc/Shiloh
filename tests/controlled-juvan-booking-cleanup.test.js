const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  FINAL_STATUSES,
  CLEANUP_REASON,
  canCleanControlledJuvanBookings,
  appointmentDigest,
  paginatePreview,
  terminalizeRelatedState,
  cancelOperationalAppointments,
  cleanupAppointmentCalendars,
  cleanControlledJuvanBookings,
} = require('../src/services/controlledJuvanBookingCleanup');

function appointment(overrides = {}) {
  return {
    id: 700,
    status: 'confirmed',
    startsAt: '2026-08-25T08:00:00.000Z',
    endsAt: '2026-08-25T09:00:00.000Z',
    serviceName: 'Sports Massage',
    staff: [{ staffId: 1, staffName: 'Christel' }],
    sharedCalendar: { calendarId: 'shared-calendar', eventId: 'shared-event', syncStatus: 'synced' },
    retryOnly: false,
    ...overrides,
  };
}

test('preview digest is bound to the current controlled client pointer and exact appointment truth', () => {
  const base = [appointment()];
  assert.equal(appointmentDigest(845, base), appointmentDigest(845, base));
  assert.notEqual(appointmentDigest(845, base), appointmentDigest(846, base));
  assert.notEqual(appointmentDigest(845, base), appointmentDigest(845, [appointment({ status: 'scheduled' })]));
  assert.notEqual(appointmentDigest(845, base), appointmentDigest(845, [appointment({ staff: [{ staffId: 2, staffName: 'Abigail' }] })]));
});

test('booking cleanup independently preserves exact JP-only authorization', async () => {
  const exact = { display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' };
  assert.equal(canCleanControlledJuvanBookings(exact), true);
  assert.equal(canCleanControlledJuvanBookings({ ...exact, display_name: 'Christel' }), false);
  assert.equal(canCleanControlledJuvanBookings({ ...exact, service_scope: 'own_services' }), false);
  const blocked = await cleanControlledJuvanBookings({
    admin: { ...exact, display_name: 'Christel' },
    expectedClientId: 999,
    expectedDigest: '0123456789abcdefabcd',
    resolveBoundJuvan: async () => { throw new Error('must not resolve identity'); },
    deps: { pool: { connect: async () => { throw new Error('must not connect'); } } },
  });
  assert.equal(blocked.status, 'unauthorized');
});

test('all non-final appointments are rendered across bounded WhatsApp preview pages', () => {
  const rows = Array.from({ length: 8 }, (_, index) => appointment({ id: 700 + index, serviceName: `Complete canonical service ${index + 1}` }));
  const pages = paginatePreview(
    { id: 845, display_name: 'Juvan Botha' },
    [{ contact_type: 'whatsapp', normalized_value: '27760891564' }],
    rows
  );
  const combined = pages.join('\n');
  for (const row of rows) assert.match(combined, new RegExp(`Appointment #${row.id}`));
  assert.equal(pages.every((page) => page.length <= 1000), true);
  assert.match(combined, /Status: confirmed/);
  assert.match(combined, /Service: Complete canonical service 1/);
  assert.match(combined, /Practitioner: Christel/);
  assert.match(combined, /When:/);
  assert.match(combined, /Calendar:/);
});

test('canonical cleanup cancels only non-final operational appointments and preserves every row', async () => {
  const calls = [];
  const db = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/UPDATE appointments/.test(sql)) return { rowCount: 1, rows: [{ id: params[0], status: 'cancelled' }] };
    return { rowCount: 1, rows: [] };
  } };
  const rows = [
    appointment({ id: 701, status: 'scheduled' }),
    appointment({ id: 702, status: 'confirmed' }),
    appointment({ id: 703, status: 'unknown' }),
    appointment({ id: 704, status: 'completed', retryOnly: true }),
    appointment({ id: 705, status: 'no_show', retryOnly: true }),
    appointment({ id: 706, status: 'cancelled', retryOnly: true }),
  ];
  const result = await cancelOperationalAppointments(db, 999, 4, rows);
  assert.deepEqual(result.cancelled, [701, 702, 703]);
  assert.deepEqual(result.preservedForRetry, [704, 705, 706]);
  assert.deepEqual([...FINAL_STATUSES], ['cancelled', 'completed', 'no_show']);
  assert.equal(calls.filter(({ sql }) => /UPDATE appointments/.test(sql)).length, 3);
  assert.equal(calls.filter(({ sql }) => /appointment_status_history/.test(sql)).length, 3);
  assert.equal(calls.filter(({ sql }) => /admin\.controlled_demo_appointment_cancelled/.test(sql)).length, 3);
  assert.equal(calls.some(({ sql }) => /DELETE FROM appointments|DELETE FROM appointment_status_history/.test(sql)), false);
  assert.equal(calls.every(({ params }) => !params.includes(845)), true);
});

test('pending approvals, reschedules, lifecycle, and notifications are terminalized without customer delivery', async () => {
  const calls = [];
  const db = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/to_regclass/.test(sql)) return { rowCount: 1, rows: [{ table_name: 'present' }] };
    return { rowCount: 2, rows: [] };
  } };
  const counts = await terminalizeRelatedState(db, [701, 702], 4);
  assert.deepEqual(counts, { approvals: 2, reschedules: 2, lifecycle: 2, notifications: 2 });
  const source = fs.readFileSync('src/services/controlledJuvanBookingCleanup.js', 'utf8');
  assert.match(source, /appointment_booking_approvals[\s\S]*status='declined'/);
  assert.match(source, /appointment_reschedule_requests[\s\S]*status='superseded'/);
  assert.match(source, /appointment_lifecycle[\s\S]*status='cancelled'/);
  assert.match(source, /customer_change_notifications[\s\S]*status='suppressed'/);
  assert.doesNotMatch(source, /sendWhatsAppMessage|sendWhatsAppTemplate|queueCustomerChangeNotification/);
  assert.match(source, /noClientMessage: true/);
});

test('Calendar cleanup removes shared deterministic and every assigned-practitioner mirror', async () => {
  const oldShared = process.env.GOOGLE_BOOKING_CALENDAR_ID;
  process.env.GOOGLE_BOOKING_CALENDAR_ID = 'current-shared';
  const shared = [];
  const practitioners = [];
  const mappings = [];
  const result = await cleanupAppointmentCalendars([
    appointment({
      id: 710,
      staff: [{ staffId: 1, staffName: 'Christel' }, { staffId: 2, staffName: 'Abigail' }],
    }),
  ], {
    calendarEnabled: () => true,
    cancelBookingEventOnCalendar: async (eventId, calendarId) => { shared.push({ eventId, calendarId }); return { cancelled: true }; },
    cancelPractitionerBookingEvent: async (input) => { practitioners.push(input); return { enabled: true, configured: true, cancelled: true }; },
    markSharedCalendarMapping: async (...args) => mappings.push(args),
  });
  if (oldShared === undefined) delete process.env.GOOGLE_BOOKING_CALENDAR_ID;
  else process.env.GOOGLE_BOOKING_CALENDAR_ID = oldShared;
  assert.equal(result[0].status, 'cancelled');
  assert.equal(shared.length, 2, 'known mapping and current deterministic shared target are both removed');
  assert.deepEqual(practitioners.map((item) => item.staffName), ['Christel', 'Abigail']);
  assert.deepEqual(mappings[0].slice(0, 2), [710, 'cancelled']);
});

test('provider failure and unknown practitioner remain unresolved for safe retry', async () => {
  const oldShared = process.env.GOOGLE_BOOKING_CALENDAR_ID;
  process.env.GOOGLE_BOOKING_CALENDAR_ID = 'current-shared';
  const result = await cleanupAppointmentCalendars([
    appointment({ id: 711, staff: [{ staffId: null, staffName: 'SHILOH MTC' }] }),
  ], {
    calendarEnabled: () => true,
    cancelBookingEventOnCalendar: async () => { throw new Error('provider unavailable'); },
    cancelPractitionerBookingEvent: async () => ({ cancelled: true }),
    markSharedCalendarMapping: async () => {},
  });
  if (oldShared === undefined) delete process.env.GOOGLE_BOOKING_CALENDAR_ID;
  else process.env.GOOGLE_BOOKING_CALENDAR_ID = oldShared;
  assert.equal(result[0].status, 'unresolved');
  assert.equal(result[0].unresolvedMirrors.some((item) => item.startsWith('shared:')), true);
  assert.equal(result[0].unresolvedMirrors.includes('practitioner:SHILOH MTC:unrecognized'), true);
});

test('Calendar cleanup is safely idempotent when every deterministic mirror is already absent', async () => {
  const oldShared = process.env.GOOGLE_BOOKING_CALENDAR_ID;
  process.env.GOOGLE_BOOKING_CALENDAR_ID = 'current-shared';
  let calls = 0;
  const deps = {
    calendarEnabled: () => true,
    cancelBookingEventOnCalendar: async () => { calls += 1; return { cancelled: true, alreadyMissing: true }; },
    cancelPractitionerBookingEvent: async () => { calls += 1; return { enabled: true, configured: true, cancelled: true, alreadyMissing: true }; },
    markSharedCalendarMapping: async () => {},
  };
  const row = appointment({ id: 712, sharedCalendar: null, staff: [{ staffId: 1, staffName: 'Christel' }] });
  const first = await cleanupAppointmentCalendars([row], deps);
  const retry = await cleanupAppointmentCalendars([row], deps);
  if (oldShared === undefined) delete process.env.GOOGLE_BOOKING_CALENDAR_ID;
  else process.env.GOOGLE_BOOKING_CALENDAR_ID = oldShared;
  assert.equal(first[0].status, 'cancelled');
  assert.equal(retry[0].status, 'cancelled');
  assert.equal(calls, 4);
});

test('confirmation fails closed when the current-pointer appointment preview has changed', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (/FROM appointments a/.test(sql)) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const result = await cleanControlledJuvanBookings({
    admin: { id: 4, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' },
    expectedClientId: 845,
    expectedDigest: '0123456789abcdefabcd',
    resolveBoundJuvan: async () => ({ status: 'ready', client: { id: 846, display_name: 'Juvan Botha' } }),
    deps: { pool: { connect: async () => db } },
  });
  assert.equal(result.status, 'preview_changed');
  assert.equal(calls.some((sql) => /UPDATE appointments|UPDATE clients|DELETE FROM client_contacts/.test(sql)), false);
});

test('cleanup has no fixed Juvan client ID or one-shot environment switch', () => {
  const source = fs.readFileSync('src/services/controlledJuvanBookingCleanup.js', 'utf8');
  assert.doesNotMatch(source, /client_id\s*=\s*845|clientId\s*:\s*845|DUMMY_TEST_CLIENT_ID|CLEANUP_ON_START/);
  assert.doesNotMatch(source, /LOWER\(TRIM\([^)]*display_name[^)]*\)\).*juvan/i);
  assert.match(source, /expectedClientId/);
  assert.match(source, /expectedDigest/);
  assert.match(source, /preview_changed/);
});

test('retry path is durable through cleanup-authored status history and idempotent Calendar deletion', () => {
  const source = fs.readFileSync('src/services/controlledJuvanBookingCleanup.js', 'utf8');
  assert.match(source, /history\.changed_by LIKE \$2/);
  assert.match(source, /history\.reason=\$3/);
  assert.match(source, /retryOnly: FINAL_STATUSES\.has/);
  assert.match(source, /alreadyMissing/);
  assert.match(source, /calendar_partial/);
});
