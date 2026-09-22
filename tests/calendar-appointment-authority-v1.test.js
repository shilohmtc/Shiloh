const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  evaluateCalendarAuthority,
  operationsForAuthority,
} = require('../src/services/calendarAuthorization');
const { calendarAppointmentDetailsClientScript } = require('../src/presentation/calendarAppointmentDetailsUx');
const {
  appointmentDetailHref,
  decorateClientAppointmentHistory,
  decorateWorkspaceAppointmentLinks,
} = require('../src/presentation/calendarAppointmentDetailLinks');
const {
  renderCalendarRetrospectiveBookingPage,
  calendarRetrospectiveBookingClientScript,
} = require('../src/presentation/calendarRetrospectiveBookingV1Ux');

const EDIT_PERMISSIONS = {
  'appointment:view': true,
  'calendar:booking:reschedule': true,
  'calendar:booking:cancel': true,
  'calendar:booking:reassign': true,
  'appointment:adjust_end': true,
};

function authority(name, permissions = EDIT_PERMISSIONS) {
  return evaluateCalendarAuthority({
    id: 10,
    display_name: name,
    admin_active: true,
    staff_id: null,
    staff_status: null,
    business_role: 'booking_operator',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions,
  });
}

test('Calendar view and edit remain separate canonical authorities', () => {
  const reader = authority('Any active Calendar viewer', { 'appointment:view': true });
  assert.ok(reader);
  assert.deepEqual(operationsForAuthority(reader), []);
  const editor = authority('Any appointment editor');
  assert.equal(editor.capabilities.includes('appointment:adjust_end'), true);
  assert.deepEqual(operationsForAuthority(editor), [
    'appointment:reschedule',
    'appointment:cancel',
    'appointment:reassign',
  ]);
});

test('Christel and Reception can share the same capability/scope tuple without name branches', () => {
  const christel = authority('Christel');
  const reception = authority('Reception');
  assert.deepEqual(
    { calendarScope: christel.calendarScope, serviceScope: christel.serviceScope, capabilities: christel.capabilities },
    { calendarScope: reception.calendarScope, serviceScope: reception.serviceScope, capabilities: reception.capabilities },
  );
});

test('JP test elevation is removable by canonical permission data only', () => {
  const elevated = authority('JP', EDIT_PERMISSIONS);
  assert.equal(operationsForAuthority(elevated).length, 3);
  assert.equal(elevated.capabilities.includes('appointment:adjust_end'), true);
  const reverted = authority('JP', { 'appointment:view': true });
  assert.deepEqual(operationsForAuthority(reverted), []);
  assert.equal(reverted.capabilities.includes('appointment:adjust_end'), false);
});

test('every visible canonical appointment is enhanced for read-only details independently of edit attributes', () => {
  const script = calendarAppointmentDetailsClientScript();
  assert.match(script, /event-card\[data-kind="appointment"\]\[data-canonical="true"\]/);
  assert.match(script, /appointmentDetailsReady/);
  assert.match(script, /setAttribute\('role','button'\)/);
  assert.match(script, /setAttribute\('tabindex','0'\)/);
  assert.match(script, /min-height:44px/);
  assert.match(script, /appointmentManagementTarget==='true'/);
  assert.match(script, /URLSearchParams\(window\.location\.search\)/);
  assert.match(script, /openRequested\(\)/);
});

test('Client History and Workspace converge on the canonical Calendar appointment detail deep link', () => {
  const href = appointmentDetailHref({ appointmentId: 42, startsAt: '2026-09-11T07:30:00.000Z' });
  assert.equal(href, '/calendar/read-only?view=day&date=2026-09-11&appointment=42&staff=all');

  const clientBase = '<section><article class="history-row"><div>History appointment</div></article></section>';
  const clientHtml = decorateClientAppointmentHistory(clientBase, [{ id: 42, starts_at: '2026-09-11T07:30:00.000Z' }]);
  assert.match(clientHtml, /data-appointment-detail-link="42"/);
  assert.match(clientHtml, /appointment=42&amp;staff=all/);
  assert.match(clientHtml, /min-height:44px/);
  assert.doesNotMatch(clientHtml, /<article class="history-row"/);

  const dashboardBase = '<article class="appointment" data-dashboard-appointment="42" data-operational-date-key="2026-09-11"><div class="appointment-actions"><a class="button" href="/calendar/read-only?view=week&amp;date=2026-09-11&amp;staff=all">Open / manage</a></div></article>';
  const dashboardHtml = decorateWorkspaceAppointmentLinks(dashboardBase);
  assert.match(dashboardHtml, /data-appointment-detail-link="42"/);
  assert.match(dashboardHtml, /view=week&amp;date=2026-09-11/);
  assert.match(dashboardHtml, /staff=all&amp;appointment=42/);
  assert.match(dashboardHtml, />Open \/ manage</);
});

test('authorized edit handoff remains the existing canonical operational Manage surface', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendarAppointmentEndTime.js'), 'utf8');
  assert.match(routeSource, /renderOperationalClient\(\)/);
  assert.match(routeSource, /renderNotesClient\(\)/);
  assert.match(routeSource, /renderEndTimeClient\(\)/);
  const detailSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'presentation', 'calendarAppointmentDetailsUx.js'), 'utf8');
  assert.match(detailSource, /detailsEditBypass/);
  assert.match(detailSource, /card\.click\(\)/);
});

test('past appointment UX exposes Custom service and Add New Appointment from production renderer', () => {
  const html = renderCalendarRetrospectiveBookingPage({ options: { staff: [], services: [] } });
  const script = calendarRetrospectiveBookingClientScript();
  assert.match(html, />Custom service</);
  assert.match(html, /data-custom-service-field/);
  assert.match(html, /does not create a Shiloh service or catalogue entry/);
  assert.match(html, /data-add-past/);
  assert.match(script, /customServiceName/);
  assert.match(script, /window\.location\.reload/);
});

test('custom historical service persistence never creates a canonical service record', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'calendarRetrospectiveBookingV1.js'), 'utf8');
  assert.match(source, /appointment_services\(appointment_id,service_id/);
  assert.match(source, /VALUES\(\$1,NULL,1,\$2,NULL,\$3\)/);
  assert.match(source, /catalogueServiceCreated: false/);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+services/i);
  assert.doesNotMatch(source, /UPDATE\s+services/i);
});

test('custom service remains bounded by canonical record-past and all-business service authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'calendarRetrospectiveBookingV1.js'), 'utf8');
  assert.match(source, /CALENDAR_CAPABILITIES\.BOOKING_CREATE/);
  assert.match(source, /CALENDAR_CAPABILITIES\.RECORD_PAST/);
  assert.match(source, /authority\.serviceScope !== 'all_services'/);
  assert.match(source, /calendarScopeAllowsBookingTarget/);
  assert.match(source, /retrospectiveClientAllows/);
});

test('custom historical write revalidates canonical context after practitioner lock before insert', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'calendarRetrospectiveBookingV1.js'), 'utf8');
  const recordIndex = source.indexOf('async function record');
  const staffLockIndex = source.indexOf('SELECT pg_advisory_xact_lock($1::bigint)', recordIndex);
  const revalidationIndex = source.indexOf('const context = await customContext(payload.adminId, payload, client);', staffLockIndex);
  const insertIndex = source.indexOf('INSERT INTO appointments', revalidationIndex);
  assert.ok(recordIndex >= 0);
  assert.ok(staffLockIndex > recordIndex);
  assert.ok(revalidationIndex > staffLockIndex);
  assert.ok(insertIndex > revalidationIndex);
});
