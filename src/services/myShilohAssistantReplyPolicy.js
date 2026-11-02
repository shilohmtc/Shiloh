'use strict';

const { localAppointmentDisplay } = require('./myShilohClientActions');

const REVIEW_ONLY_REPLY = 'Chat has not booked or confirmed an appointment. Please review your booking in Bookings; current availability, Shiloh approval and any required deposit still apply.';
const PREPARATION_FAILED_REPLY = 'I could not prepare that latest choice. Nothing has changed. Please choose another time or check Bookings before trying again.';

function requestsLastAppointment(message) {
  if (/\b(?:do not|don't|don’t|never|stop)\s+(?:book|rebook|repeat)\b/i.test(message)) return false;
  return /\b(?:book|rebook|repeat)\b/i.test(message)
    && /\b(?:my\s+)?last\s+(?:appointment|appoinment|booking|visit|treatment)\b/i.test(message);
}

function lastVisitReply(visit) {
  if (!visit?.found) return 'I could not find a completed individual visit in the history available here. Which treatment would you like, and on what new date and time?';
  if (visit.ambiguous || !visit.complete) return 'I cannot identify one complete last visit safely from the history available here. Which treatment would you like to repeat? Reception can help with a visit involving several treatments or practitioners.';
  const when = localAppointmentDisplay(visit.startsAt);
  if (visit.multiService || visit.services.length !== 1 || visit.practitioners.length !== 1) {
    return `Your most recent completed individual visit available here was on ${when.date} at ${when.time} (South African time), with ${visit.services.join(' + ')}. Which treatment would you like to repeat, and on what new date and time? Reception can help arrange the whole visit. Nothing is booked.`;
  }
  return `Your most recent completed individual visit available here was ${visit.services[0]} with ${visit.practitioners[0]} on ${when.date} at ${when.time} (South African time). Would you like to repeat that treatment? What new date and time would suit you? We will check the current price and availability before you review and submit. Nothing is booked.`;
}

function guardBookingClaims(reply, context = {}) {
  // The chat endpoint has no commit authority. Never take a model's completion
  // claim as evidence, including after an authoritative read of an existing visit.
  // Deliberately conservative: status questions can use the canonical Bookings UI.
  const text = String(reply || '').replace(/[’‘]/g, "'").replace(/[*_`]/g, '').toLowerCase();
  const booking = /\b(?:book(?:ed|ing)?|appointment|reserv(?:ed|ation)|reschedul\w*|cancel\w*)\b/;
  const completed = /\b(?:confirm(?:ed|ation)|success(?:ful(?:ly)?)?|complete[ds]?|done|booked|reserved|rescheduled|cancelled|canceled|secured|locked\s+in|all\s+set)\b/;
  const bareSuccess = /\b(?:you(?:'re| are)(?:\s+now)?\s+(?:all\s+set|booked\s+in)|i(?:'ve| have)\s+(?:booked|reserved|confirmed|rescheduled|cancelled|canceled)|booking\s+(?:is\s+)?successful)\b/;
  if (/\b(?:all set|consider it done|confirmed|booked|reserved|rescheduled|cancelled|canceled|scheduled|secured|locked in|see you)\b/.test(text) || bareSuccess.test(text) || (booking.test(text) && completed.test(text))) {
    const appointment = context.nextAppointment;
    if (appointment?.startsAt && Number.isFinite(Date.parse(appointment.startsAt))) {
      const when = localAppointmentDisplay(appointment.startsAt);
      const services = Array.isArray(appointment.services) ? appointment.services.join(' + ') : 'Appointment';
      return `${REVIEW_ONLY_REPLY} Existing visit shown in Bookings: ${services}, ${when.date} at ${when.time} (South African time).`;
    }
    return REVIEW_ONLY_REPLY;
  }
  return reply;
}

module.exports = { requestsLastAppointment, lastVisitReply, guardBookingClaims, REVIEW_ONLY_REPLY, PREPARATION_FAILED_REPLY };
