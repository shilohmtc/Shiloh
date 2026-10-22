const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  MAX_APPOINTMENT_NOTES_LENGTH,
  normalizeAppointmentNotes,
} = require('../src/services/appointmentNotes');
const {
  decorateCreateBookingNotes,
  calendarCreateBookingNotesClientScript,
  calendarManageAppointmentNotesClientScript,
} = require('../src/presentation/calendarAppointmentNotesUx');

test('appointment note normalization is bounded and blank-safe', () => {
  assert.equal(normalizeAppointmentNotes('  staff only  '), 'staff only');
  assert.equal(normalizeAppointmentNotes('   '), null);
  assert.equal(
    normalizeAppointmentNotes('x'.repeat(MAX_APPOINTMENT_NOTES_LENGTH)).length,
    MAX_APPOINTMENT_NOTES_LENGTH
  );
  assert.throws(
    () => normalizeAppointmentNotes('x'.repeat(MAX_APPOINTMENT_NOTES_LENGTH + 1)),
    error => error && error.code === 'APPOINTMENT_NOTES_TOO_LONG' && error.httpStatus === 400
  );
});

test('New Booking exposes an optional internal-only note and submits it only at confirmation', () => {
  const marker = '      </div>\n      <div class="actions"><button class="button" type="button" data-review-booking disabled>Review booking</button></div>';
  const html = decorateCreateBookingNotes(`<html><head></head><body>${marker}</body></html>`);
  assert.match(html, /Internal notes/);
  assert.match(html, /maxlength="4000"/);
  assert.match(html, /Internal only — not included in client confirmations or reminders\./);

  const client = calendarCreateBookingNotesClientScript();
  assert.ok(client.includes('body.notes=notes.value'));
  assert.ok(client.includes('/calendar\\/book\\/confirm'));
  assert.ok(client.includes('Internal notes'));
});

test('Manage Appointment uses revisioned, CSRF-backed canonical note updates', () => {
  const client = calendarManageAppointmentNotesClientScript();
  assert.ok(client.includes("method:'PATCH'"));
  assert.ok(client.includes('expectedRevision:revision'));
  assert.ok(client.includes('requestId:operationId()'));
  assert.ok(client.includes("'x-shiloh-csrf-token':token"));
  assert.ok(client.includes('Internal only — not included in client confirmations or reminders.'));
});

test('create flow persists notes through the canonical appointment row without passing note text to client confirmation', () => {
  const create = fs.readFileSync(require.resolve('../src/services/calendarCreateBooking'), 'utf8');
  const direct = fs.readFileSync(require.resolve('../src/services/calendarDirectBookingConfirmation'), 'utf8');
  const route = fs.readFileSync(require.resolve('../src/routes/calendarCreateBooking'), 'utf8');

  assert.match(create, /normalizeAppointmentNotes\(notes\)/);
  assert.match(create, /confirmBooking\(admin, \{ source: 'shiloh_calendar', notes: normalizedNotes,/);
  assert.match(direct, /title, notes, total_price/);
  assert.match(direct, /appointmentNotes/);
  assert.match(direct, /queueCustomerBookingConfirmation\(appointment\.id, \{ db \}\)/);
  assert.match(direct, /sendCustomerBookingConfirmationForAppointment\(appointment\.id\)/);
  assert.doesNotMatch(direct, /queueCustomerBookingConfirmation\([^\n]*appointmentNotes/);
  assert.doesNotMatch(direct, /sendCustomerBookingConfirmationForAppointment\([^\n]*appointmentNotes/);
  assert.match(route, /router\.post\('\/confirm', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /notes: req\.body\?\.notes/);
});

test('Manage Appointment notes remain scoped, stale-safe, idempotent and audited on appointments.notes', () => {
  const service = fs.readFileSync(require.resolve('../src/services/workspaceAppointmentNotes'), 'utf8');
  const route = fs.readFileSync(require.resolve('../src/routes/calendarOperationalMutations'), 'utf8');

  assert.match(service, /allowsAppointmentTarget/);
  assert.match(service, /SELECT id, notes, updated_at/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /CALENDAR_NOTES_STALE_REVISION/);
  assert.match(service, /UPDATE appointments[\s\S]*SET notes=\$2, updated_at=NOW\(\)/);
  assert.match(service, /calendar\.appointment_notes_updated/);
  assert.match(service, /requestFingerprint/);
  assert.match(service, /notesPresent/);
  assert.match(service, /noteLength/);
  assert.doesNotMatch(service, /queueCustomer|sendCustomer|WhatsApp|reminder/i);
  assert.match(route, /router\.patch\('\/appointments\/:appointmentId\/notes', sameOrigin, requireSession, requireCsrf/);
});
