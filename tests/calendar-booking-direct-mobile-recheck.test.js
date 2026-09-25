const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../src/presentation/calendarCreateBookingUx');

function loadDirectConfirmationWithFakes({ finalMobile = '27821234567' } = {}) {
  const poolModule = require('../src/db/pool');
  const availabilityModule = require('../src/services/adminAvailability');
  const clinicHoursModule = require('../src/services/clinicHours');
  const confirmationModule = require('../src/services/customerBookingConfirmation');
  const policyAcceptanceModule = require('../src/services/bookingPolicyAcceptance');

  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('FROM admin_booking_sessions abs')) {
        return {
          rows: [{
            admin_id: 7,
            client_id: null,
            crm_v2_client_id: 42,
            source_client_name: 'Jane Doe',
            client_mobile_snapshot: '27821234567',
            staff_id: 3,
            service_id: 9,
            location_id: 1,
            starts_at: '2099-09-03T10:00:00.000Z',
            ends_at: '2099-09-03T11:00:00.000Z',
            state: 'confirm',
            staff_name: 'Practitioner',
            staff_status: 'active',
            service_name: 'Treatment',
            service_status: 'active',
            duration_minutes: 60,
            processing_time_minutes: 0,
            extra_time_minutes: 0,
            price: 500,
            variable_price: false,
            category_name: 'Massage',
            location_name: 'Shiloh',
            location_status: 'active',
          }],
          rowCount: 1,
        };
      }
      if (String(sql).includes('FROM staff_services')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (String(sql).includes('FROM crm_v2_clients')) {
        return {
          rows: [{ id: 42, name: 'Jane Doe', normalized_mobile: finalMobile, status: 'active' }],
          rowCount: 1,
        };
      }
      if (String(sql).includes('INSERT INTO appointments')) {
        return { rows: [{ id: 123, starts_at: params[3], ends_at: params[4], status: 'scheduled' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };

  const originals = {
    connect: poolModule.pool.connect,
    checkAuthoritativeSchedule: availabilityModule.checkAuthoritativeSchedule,
    getConflicts: availabilityModule.getConflicts,
    checkClinicHours: clinicHoursModule.checkClinicHours,
    queueCustomerBookingConfirmation: confirmationModule.queueCustomerBookingConfirmation,
    sendCustomerBookingConfirmationForAppointment: confirmationModule.sendCustomerBookingConfirmationForAppointment,
    ensureForAppointment: policyAcceptanceModule.ensureForAppointment,
  };

  poolModule.pool.connect = async () => db;
  availabilityModule.checkAuthoritativeSchedule = async () => ({ covered: true, partialUnavailable: false, allDayUnavailable: false, insideAvailableException: false });
  availabilityModule.getConflicts = async () => [];
  clinicHoursModule.checkClinicHours = async () => ({ covered: true });
  confirmationModule.queueCustomerBookingConfirmation = async () => ({ queued: true });
  confirmationModule.sendCustomerBookingConfirmationForAppointment = async () => ({ sent: true, deliveryStatus: 'sent' });
  policyAcceptanceModule.ensureForAppointment = async () => ({ policyVersion:'2026-09-25-v3', clinicPath:'/booking-policy/clinic-test', clientPath:'/booking-policy/client-test', clientMobile:'27821234567' });

  const modulePath = require.resolve('../src/services/calendarDirectBookingConfirmation');
  delete require.cache[modulePath];
  const direct = require(modulePath);

  function restore() {
    poolModule.pool.connect = originals.connect;
    availabilityModule.checkAuthoritativeSchedule = originals.checkAuthoritativeSchedule;
    availabilityModule.getConflicts = originals.getConflicts;
    clinicHoursModule.checkClinicHours = originals.checkClinicHours;
    confirmationModule.queueCustomerBookingConfirmation = originals.queueCustomerBookingConfirmation;
    confirmationModule.sendCustomerBookingConfirmationForAppointment = originals.sendCustomerBookingConfirmationForAppointment;
    policyAcceptanceModule.ensureForAppointment = originals.ensureForAppointment;
    delete require.cache[modulePath];
  }

  return { ...direct, calls, restore };
}

test('calendar booking review has direct Create booking with no acknowledgement ceremony', () => {
  const page = renderCalendarCreateBookingPage();
  const script = calendarCreateBookingClientScript();

  assert.match(page, /data-create-booking[^>]*>Create booking</);
  assert.doesNotMatch(page, /acknowledg/i);
  assert.doesNotMatch(page, /data-mobile-ack/);
  assert.doesNotMatch(script, /mobileAcknowledged/);
  assert.doesNotMatch(script, /mobile-acknowledgement/);
  assert.match(script, /review\.client\.mobile/);
  assert.match(script, /Final client\/mobile, authority, availability and conflict check/);
});

test('direct confirmation blocks a changed canonical mobile before appointment creation', async () => {
  const harness = loadDirectConfirmationWithFakes({ finalMobile: '27829876543' });
  try {
    const result = await harness.confirmCalendarV2BookingDirect({ id: 7, display_name: 'Admin' }, { source: 'shiloh_calendar' });
    assert.equal(result.status, 'client_mobile_changed');
    assert.equal(harness.calls.some((call) => call.sql.includes('INSERT INTO appointments')), false);
    assert.equal(harness.calls.some((call) => call.sql.includes('FROM crm_v2_clients') && call.sql.includes('FOR UPDATE')), true);
    assert.equal(harness.calls.some((call) => call.sql.includes('DELETE FROM admin_booking_sessions')), true);
  } finally {
    harness.restore();
  }
});

test('direct confirmation creates only after canonical mobile and scheduling checks remain valid', async () => {
  const harness = loadDirectConfirmationWithFakes();
  try {
    const result = await harness.confirmCalendarV2BookingDirect({ id: 7, display_name: 'Admin' }, { source: 'shiloh_calendar' });
    assert.equal(result.status, 'created');
    assert.equal(result.appointmentId, 123);
    assert.equal(harness.calls.some((call) => call.sql.includes('SELECT pg_advisory_xact_lock')), true);
    assert.equal(harness.calls.some((call) => call.sql.includes('INSERT INTO appointments')), true);
    const audit = harness.calls.find((call) => call.sql.includes('INSERT INTO crm_audit_events'));
    assert.ok(audit);
    assert.match(String(audit.params[2]), /"finalCanonicalMobileRechecked":true/);
    assert.doesNotMatch(String(audit.params[2]), /Acknowledged/);
  } finally {
    harness.restore();
  }
});