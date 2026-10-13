const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'appointmentChange.js'), 'utf8');
const availabilitySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientRescheduleAvailability.js'), 'utf8');

test('appointment change intents remain isolated from onboarding state', () => {
  assert.match(source, /INSERT INTO appointment_change_intents/);
  assert.doesNotMatch(source, /INSERT INTO client_onboarding_sessions\(phone,action/);
});

test('legacy appointment-change helper carries forward the existing booking', () => {
  assert.match(source, /if\(rows\.length===1\)return\{appointment:rows\[0\]\}/);
  assert.match(source, /What new day or date would you prefer\?/);
});

test('reschedule date enters authoritative daypart and slot selection instead of asking the client to guess an exact time', () => {
  assert.match(availabilitySource, /listAvailableSlots/);
  assert.match(availabilitySource, /reschedule_daypart_morning/);
  assert.match(availabilitySource, /reschedule_daypart_afternoon/);
  assert.match(availabilitySource, /reschedule_daypart_evening/);
  assert.match(availabilitySource, /reschedule_slot_/);
  assert.match(availabilitySource, /service_id/);
  assert.match(availabilitySource, /Shiloh's canonical scheduling records/);
});

test('authoritative reschedule slot is rechecked before the existing atomic confirmation path is entered', () => {
  assert.match(availabilitySource, /authoritativeSlots\(a,intent\.preferred_date,daypart\)/);
  assert.match(availabilitySource, /preferred_time:time,status:'awaiting_confirmation'/);
  assert.match(availabilitySource, /Nothing has changed yet/);
});

test('client reschedule locks the practitioner and revalidates authoritative availability before mutation', () => {
  const begin = source.indexOf("await db.query('BEGIN')", source.indexOf('async function rescheduleCanonical'));
  const advisory = source.indexOf('pg_advisory_xact_lock', begin);
  const finalClinic = source.indexOf('const finalClinic=', advisory);
  const finalSchedule = source.indexOf('const finalSchedule=', finalClinic);
  const finalConflict = source.indexOf('const finalConflict=', finalSchedule);
  const update = source.indexOf('UPDATE appointments SET starts_at=', finalConflict);
  assert.ok(begin >= 0 && advisory > begin);
  assert.ok(finalClinic > advisory && finalSchedule > finalClinic);
  assert.ok(finalConflict > finalSchedule);
  assert.ok(update > finalConflict);
});

test('concurrent appointment movement fails closed instead of overwriting newer state', () => {
  assert.match(source, /new Date\(locked\.rows\[0\]\.starts_at\).*new Date\(a\.starts_at\)/s);
  assert.match(source, /new Date\(locked\.rows\[0\]\.ends_at\).*new Date\(a\.ends_at\)/s);
  assert.match(source, /status:'changed'/);
});

test('failed canonical reschedule rolls back without external compensation', () => {
  const fn = source.match(/async function rescheduleCanonical[\s\S]*?async function processAppointmentChangeMessage/);
  assert.ok(fn);
  assert.match(fn[0], /ROLLBACK/);
  assert.doesNotMatch(fn[0], /updateBookingEvent|appointment_calendar_events|calendar compensation/);
});
