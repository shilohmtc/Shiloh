'use strict';

const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { pool } = require('../db/pool');
const booking = require('./myShilohBooking');
const { quoteWhatsAppBooking } = require('./whatsAppBookingQuote');

const PURPOSE = Buffer.from('shiloh:whatsapp-booking-continuation:v1');
const TTL_MS = 45 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{70,420}$/;
const MOBILE = /^27[678][0-9]{8}$/;

function validSelection(value) {
  return (
    typeof value?.senderMobile === 'string' &&
    MOBILE.test(value.senderMobile) &&
    Number.isSafeInteger(value.serviceId) &&
    value.serviceId > 0 &&
    Number.isSafeInteger(value.staffId) &&
    value.staffId > 0 &&
    typeof value.startsAt === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.startsAt) &&
    Number.isFinite(Date.parse(value.startsAt)) &&
    new Date(value.startsAt).toISOString() === value.startsAt
  );
}

function createWhatsAppBookingContinuation({
  key,
  db = pool,
  service = booking,
  clock = Date.now,
}) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new TypeError('Booking continuation key required');

  function issue(selection) {
    if (!validSelection(selection) || Date.parse(selection.startsAt) <= clock()) {
      throw new TypeError('Booking continuation requires a future selected slot');
    }
    const { senderMobile, serviceId, staffId, startsAt } = selection;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(PURPOSE);
    const data = Buffer.concat([
      cipher.update(
        JSON.stringify({
          senderMobile,
          serviceId,
          staffId,
          startsAt,
          expires: clock() + TTL_MS,
        }),
      ),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }

  function open(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const data = Buffer.from(token, 'base64url');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)).setAAD(PURPOSE);
      decipher.setAuthTag(data.subarray(12, 28));
      const selection = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]),
      );
      if (
        !validSelection(selection) ||
        !Number.isSafeInteger(selection.expires) ||
        selection.expires <= clock() ||
        Date.parse(selection.startsAt) <= clock()
      )
        return null;
      return selection;
    } catch {
      return null;
    }
  }

  // Authenticate using the existing browser registration and session before calling this method.
  async function resume(token, session) {
    const selection = open(token);
    if (!selection || !session?.crmV2ClientId) return null;
    const { senderMobile, serviceId, staffId, startsAt } = selection;
    const crmV2ClientId = session.crmV2ClientId;
    const identity = await db.query(
      `
      SELECT c.id FROM crm_v2_clients c
      WHERE c.id=$1 AND c.normalized_mobile=$2 AND c.status='active'
        AND c.profile_status='registered' AND c.mobile_verified_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM crm_v2_clients other WHERE other.id<>c.id AND other.status='active' AND other.normalized_mobile=$2
        )
        AND NOT EXISTS (
          SELECT 1 FROM client_contacts contact WHERE contact.normalized_value=$2
            AND lower(contact.contact_type) IN ('phone','telephone','mobile','whatsapp')
        )`,
      [crmV2ClientId, senderMobile],
    );
    if (identity.rows.length !== 1) return null;

    const inputs = { crmV2ClientId, serviceId, staffId };
    const availability = await service.slots({
      ...inputs,
      date: booking.localDate(new Date(startsAt)),
    });
    if (!availability.slots.some((slot) => Date.parse(slot.startsAt) === Date.parse(startsAt))) {
      return { status: 'slot_unavailable' };
    }
    const [review, policy] = await Promise.all([
      service.review({ ...inputs, startsAt }),
      service.policy(),
    ]);
    const quote = quoteWhatsAppBooking({
      serviceId,
      staffId,
      startsAt,
      total: review.total,
      pricingHash: review.quoteHash,
      policy,
      now: new Date(clock()),
    });
    if (!quote) return null;
    return {
      status: 'review',
      service: availability.service,
      practitioner: availability.practitioner,
      startsAt,
      ...quote,
    };
  }

  return { issue, resume, selectedMobile: (token) => open(token)?.senderMobile || null };
}

module.exports = { createWhatsAppBookingContinuation };
