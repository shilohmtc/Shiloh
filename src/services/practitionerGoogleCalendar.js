const {
  calendarEnabled,
  checkCalendarAvailabilityOnCalendar,
  createBookingEventOnCalendar,
  getBookingEventOnCalendar,
  updateBookingEventOnCalendar,
  cancelBookingEventOnCalendar,
  deterministicEventId,
} = require('./googleBookingCalendar');
const { prepareCalendarWrite } = require('./clientBookingCalendarRecovery');

const ENV_BY_STAFF = Object.freeze({
  christel: 'GOOGLE_CHRISTEL_CALENDAR_ID',
  abigail: 'GOOGLE_ABIGAIL_CALENDAR_ID',
});

function normalizeStaffName(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function practitionerCalendarId(staffName) {
  const envName = ENV_BY_STAFF[normalizeStaffName(staffName)];
  if (!envName) return null;
  return String(process.env[envName] || '').trim() || null;
}

function requirePractitionerCalendarId(staffName) {
  const normalized = normalizeStaffName(staffName);
  const envName = ENV_BY_STAFF[normalized];
  if (!envName) return null;
  const calendarId = practitionerCalendarId(staffName);
  if (!calendarId && calendarEnabled()) {
    throw new Error(`${envName} is required for ${staffName} practitioner calendar synchronization.`);
  }
  return calendarId;
}

function eventIdForAppointment(appointmentId) {
  if (!appointmentId) throw new Error('appointmentId is required for practitioner calendar synchronization.');
  return deterministicEventId(`shiloh-appointment:${appointmentId}`);
}

async function checkPractitionerCalendarAvailability({ staffName, startsAt, endsAt, ignoreEventId = null }) {
  if (!calendarEnabled()) return { enabled: false, configured: false, available: true, conflicts: [] };
  const calendarId = requirePractitionerCalendarId(staffName);
  if (!calendarId) return { enabled: true, configured: false, available: true, conflicts: [] };
  const result = await checkCalendarAvailabilityOnCalendar(calendarId, {
    startsAt,
    endsAt,
    staffName: null,
    ignoreEventId,
  });
  return { ...result, configured: true, calendarId };
}

async function createPractitionerBookingEvent(data) {
  if (!calendarEnabled()) return { enabled: false, configured: false, event: null };
  const calendarId = requirePractitionerCalendarId(data.staffName);
  if (!calendarId) return { enabled: true, configured: false, event: null };
  const eventId = eventIdForAppointment(data.appointmentId);
  await prepareCalendarWrite({
    provider: 'practitioner_google',
    calendarId,
    eventId,
    appointmentId: data.appointmentId,
    staffName: data.staffName,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    cancelEvent: cancelBookingEventOnCalendar,
  });
  const result = await createBookingEventOnCalendar(calendarId, data);
  return { ...result, configured: true, calendarId };
}

async function syncPractitionerBookingEvent(data) {
  if (!calendarEnabled()) return { enabled: false, configured: false, event: null };
  const calendarId = requirePractitionerCalendarId(data.staffName);
  if (!calendarId) return { enabled: true, configured: false, event: null };
  const eventId = eventIdForAppointment(data.appointmentId);
  const existing = await getBookingEventOnCalendar(eventId, calendarId);
  if (!existing) {
    const created = await createBookingEventOnCalendar(calendarId, data);
    return { ...created, configured: true, calendarId, createdMissingMirror: true };
  }
  const updated = await updateBookingEventOnCalendar(calendarId, { ...data, eventId });
  return { ...updated, configured: true, calendarId };
}

async function cancelPractitionerBookingEvent({ appointmentId, staffName }) {
  if (!calendarEnabled()) return { enabled: false, configured: false, cancelled: false };
  const calendarId = requirePractitionerCalendarId(staffName);
  if (!calendarId) return { enabled: true, configured: false, cancelled: false };
  const eventId = eventIdForAppointment(appointmentId);
  const result = await cancelBookingEventOnCalendar(eventId, calendarId);
  return { ...result, configured: true, calendarId, eventId };
}

async function cancelPractitionerBookingEvents({ appointmentId, staffNames = [] }) {
  const unique = [...new Set(staffNames.map((name) => String(name || '').trim()).filter(Boolean))];
  const results = [];
  for (const staffName of unique) {
    if (!ENV_BY_STAFF[normalizeStaffName(staffName)]) continue;
    results.push({ staffName, ...(await cancelPractitionerBookingEvent({ appointmentId, staffName })) });
  }
  return results;
}

module.exports = {
  ENV_BY_STAFF,
  normalizeStaffName,
  practitionerCalendarId,
  requirePractitionerCalendarId,
  eventIdForAppointment,
  checkPractitionerCalendarAvailability,
  createPractitionerBookingEvent,
  syncPractitionerBookingEvent,
  cancelPractitionerBookingEvent,
  cancelPractitionerBookingEvents,
};
