'use strict';

const { pool } = require('../db/pool');
const booking = require('./myShilohBooking');
const { verifiedWhatsAppBookingOwner } = require('./whatsAppBookingContinuation');

const PAGE_SIZE = 9; // Keep one row for More.
const DATE_COUNT = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_LABEL = new Intl.DateTimeFormat('en-ZA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Africa/Johannesburg',
});

function list(kind, rows, page = 0) {
  const offset = page * PAGE_SIZE;
  return {
    status: rows.length > offset ? 'choices' : 'unavailable',
    kind,
    choices: rows.slice(offset, offset + PAGE_SIZE),
    nextPage: rows.length > offset + PAGE_SIZE ? page + 1 : null,
  };
}

function clinicDates(now) {
  const first = new Date(booking.localDate(now) + 'T12:00:00.000Z').getTime();
  return Array.from({ length: DATE_COUNT }, (_unused, day) => {
    const date = new Date(first + day * DAY_MS);
    return { id: booking.localDate(date), title: DATE_LABEL.format(date) };
  });
}

function createWhatsAppBookingChoices({
  db = pool,
  service = booking,
  continuation,
  authorizeOwner = verifiedWhatsAppBookingOwner,
  clock = Date.now,
} = {}) {
  if (typeof continuation?.issue !== 'function' || typeof continuation?.resume !== 'function') {
    throw new TypeError('Verified booking continuation required');
  }

  // Pass only a validated browser session or a server-verified, purpose-bound chat grant.
  // A WhatsApp sender number by itself does not establish the client identity.
  return async function choices({
    senderMobile,
    session,
    serviceId,
    staffId,
    date,
    startsAt,
    page = 0,
  } = {}) {
    const crmV2ClientId = session?.crmV2ClientId;
    if (!crmV2ClientId || !(await authorizeOwner(db, senderMobile, crmV2ClientId))) {
      return { status: 'verification_required' };
    }
    if (!Number.isSafeInteger(page) || page < 0) return { status: 'unavailable' };

    const services = await service.catalogue();
    if (serviceId == null)
      return list(
        'treatment',
        services.map((row) => ({ id: Number(row.id), title: row.name })),
        page,
      );
    if (!Number.isSafeInteger(serviceId) || !services.some((row) => Number(row.id) === serviceId)) {
      return { status: 'unavailable' };
    }

    const input = { serviceId, crmV2ClientId };
    const { practitioners } = await service.practitioners(input);
    if (staffId == null)
      return list(
        'practitioner',
        practitioners.map((row) => ({ id: row.id, title: row.name })),
        page,
      );
    if (!Number.isSafeInteger(staffId) || !practitioners.some((row) => row.id === staffId)) {
      return { status: 'unavailable' };
    }

    const now = new Date(clock());
    const days = clinicDates(now);
    if (date == null) return list('date', days);
    if (!days.some((row) => row.id === date)) return { status: 'unavailable' };
    const { slots } = await service.slots({ ...input, staffId, date });
    const future = slots.filter((slot) => Date.parse(slot.startsAt) > now.getTime());
    if (startsAt == null)
      return list(
        'time',
        future.map((slot) => ({
          id: slot.startsAt,
          title: slot.time,
        })),
        page,
      );
    if (!future.some((slot) => slot.startsAt === startsAt)) return { status: 'slot_unavailable' };

    const token = continuation.issue({ senderMobile, serviceId, staffId, startsAt });
    const review = await continuation.resume(token, session);
    if (review?.status !== 'review') return { status: review?.status || 'verification_required' };
    return { ...review, continuationToken: token };
  };
}

module.exports = { createWhatsAppBookingChoices };
