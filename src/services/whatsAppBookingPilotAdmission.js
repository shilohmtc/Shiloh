'use strict';

const { createHmac } = require('node:crypto');
const { verifiedWhatsAppMessages } = require('./whatsAppBookingActions');
const WINDOW_MS = 24 * 60 * 60 * 1000;

function createWhatsAppBookingPilotAdmission({
  db,
  recipient,
  key,
  maximumAttempts,
  slot = 1,
  clock = Date.now,
}) {
  if (
    !db?.query ||
    (slot !== 1 && slot !== 2) ||
    typeof recipient !== 'string' ||
    !/^27[678][0-9]{8}$/.test(recipient) ||
    !Buffer.isBuffer(key) ||
    key.length !== 32 ||
    !Number.isInteger(maximumAttempts) ||
    maximumAttempts < 1 ||
    maximumAttempts > 20
  ) {
    throw new TypeError('Pilot recipient, delivery cap and database are required');
  }
  const hash = createHmac('sha256', key)
    .update('booking-pilot:' + recipient)
    .digest('hex');

  async function recordInbound(raw, signature, configuration) {
    let windowEndsAt = 0;
    const now = clock();
    for (const message of verifiedWhatsAppMessages(raw, signature, {
      ...configuration,
      allowedSender: recipient,
    })) {
      if (typeof message.timestamp !== 'string' || !/^\d{10}$/.test(message.timestamp)) continue;
      const sentAt = Number(message.timestamp) * 1000;
      if (sentAt > now || sentAt + WINDOW_MS <= now) continue;
      windowEndsAt = Math.max(windowEndsAt, sentAt + WINDOW_MS);
    }
    if (!windowEndsAt) return false;
    const result = await db.query(
      `
      INSERT INTO whatsapp_booking_pilot_admission(slot,recipient_hash,window_ends_at)
      SELECT $3::smallint,$1,$2
      WHERE NOT EXISTS (
        SELECT 1 FROM whatsapp_booking_pilot_admission WHERE recipient_hash=$1 AND slot<>$3::smallint
      )
      ON CONFLICT(slot) DO UPDATE SET window_ends_at=GREATEST(whatsapp_booking_pilot_admission.window_ends_at,EXCLUDED.window_ends_at)
      WHERE whatsapp_booking_pilot_admission.recipient_hash=EXCLUDED.recipient_hash
      RETURNING slot`,
      [hash, new Date(windowEndsAt), slot],
    );
    return result.rows.length === 1;
  }

  async function authorizeDelivery({ recipient: target }) {
    if (target !== recipient) return { allowed: false };
    const { rows } = await db.query(
      `
      UPDATE whatsapp_booking_pilot_admission SET reserved_attempts=reserved_attempts+1
      WHERE slot=$4 AND recipient_hash=$1 AND window_ends_at>$2 AND reserved_attempts<$3
      RETURNING window_ends_at`,
      [hash, new Date(clock()), maximumAttempts, slot],
    );
    return rows.length === 1
      ? { allowed: true, serviceWindowEndsAt: rows[0].window_ends_at }
      : { allowed: false };
  }

  return { allowedSender: recipient, recordInbound, authorizeDelivery };
}

module.exports = { createWhatsAppBookingPilotAdmission };
