const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceAppointmentNotesService } = require('../src/services/workspaceAppointmentNotes');

function fixture({ projection = {}, scoped = false, staffId = 1, serviceId = 44, denied = false } = {}) {
  const queries = [];
  const db = { connect: async () => { throw Error('read-only projection must not open a write transaction'); }, query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('calendarAuthorization:principal')) return { rows: denied ? [] : [{ id: 71, admin_active: true, staff_id: scoped ? 1 : null, staff_status: 'active', business_role: 'owner', calendar_scope: scoped ? 'own_appointments' : 'all_business', service_scope: scoped ? 'own_services' : 'all_services', permissions: { 'appointment:view': true, 'calendar:booking:reschedule': true } }] };
    if (sql.includes('calendarAuthorization:services')) return { rows: [{ service_id: 44 }] };
    if (sql.includes('SELECT id, notes, updated_at')) return { rows: [{ id: 667, notes: '', updated_at: '2026-09-30T10:00:00Z' }] };
    if (sql.includes('FROM appointment_staff')) return { rows: [{ staff_id: staffId }] };
    if (sql.includes('FROM appointment_services')) return { rows: [{ service_id: serviceId }] };
    if (sql.includes('calendar:myShilohAvailability')) return { rows: [{ crm_v2_client_id: 912, client_id: null, client_status: 'active', status: 'scheduled', upcoming: true, ...projection }] };
    throw Error('Unexpected query: ' + sql);
  } };
  return { service: createWorkspaceAppointmentNotesService({ db }), queries };
}
for (const [name, projection, expected] of [
  ['linked upcoming scheduled', {}, 'available'], ['linked confirmed', { status: 'confirmed' }, 'available'],
  ['legacy identity', { client_id: 12 }, 'not_linked'], ['missing link', { crm_v2_client_id: null }, 'not_linked'],
  ['inactive client', { client_status: 'inactive' }, 'not_linked'], ['cancelled booking', { status: 'cancelled' }, 'not_current'],
  ['completed booking', { status: 'completed' }, 'not_current'], ['past booking', { upcoming: false }, 'not_current'],
]) test('app availability: ' + name, async () => {
  const { service, queries } = fixture({ projection });
  const result = await service.getMyShilohAvailability({ adminId: 71, appointmentId: 667 });
  assert.equal(result.status, expected);
  assert.equal(result.appointmentId, 667);
  assert.doesNotMatch(JSON.stringify(result), /delivered|opened|readAt|phone alert/i);
  assert.ok(queries.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql)));
});
for (const input of [{ denied: true }, { scoped: true, staffId: 2 }, { scoped: true, serviceId: 55 }]) {
  test('app availability refuses unauthorized or out-of-scope appointment ' + JSON.stringify(input), async () => {
    const { service, queries } = fixture(input);
    await assert.rejects(service.getMyShilohAvailability({ adminId: 71, appointmentId: 667 }), e => e.httpStatus === 403);
    assert.ok(!queries.some(({ sql }) => sql.includes('calendar:myShilohAvailability')));
  });
}
