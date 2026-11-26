'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const BOOKING_ACTION_TTL_SECONDS = 15 * 60;
const MOBILE = /^27[678][0-9]{8}$/;
const ID = /^[1-9][0-9]{0,18}$/;
const REVIEW = /^[A-Za-z0-9_-]{43}$/;
const TAP = /^request_appointment:([A-Za-z0-9_-]{1,140})\.([A-Za-z0-9_-]{43})$/;

function validId(id) {
  return typeof id === 'string' && ID.test(id) && BigInt(id) <= 9223372036854775807n;
}

function mac(secret, bytes) {
  return createHmac('sha256', secret).update(bytes).digest();
}

// Issue only after browser verification, quote review and explicit policy acceptance.
function issueBookingAction(
  { acceptanceId, verifiedClientId, senderMobile, reviewHash },
  { secret, now = Date.now() },
) {
  if (
    !secret ||
    !validId(acceptanceId) ||
    !validId(verifiedClientId) ||
    typeof reviewHash !== 'string' ||
    !REVIEW.test(reviewHash) ||
    typeof senderMobile !== 'string' ||
    !MOBILE.test(senderMobile)
  )
    throw new TypeError('Invalid booking action authority');
  const expires = Math.floor(now / 1000) + BOOKING_ACTION_TTL_SECONDS;
  const body = Buffer.from(
    [acceptanceId, verifiedClientId, expires, reviewHash].join(':'),
  ).toString('base64url');
  const signature = mac(secret, 'request_appointment:' + senderMobile + ':' + body).toString(
    'base64url',
  );
  return 'request_appointment:' + body + '.' + signature;
}

function bookingAction(id, senderMobile, secret, now) {
  const match = typeof id === 'string' && TAP.exec(id);
  if (!match || !secret) return null;
  const [, body, signature] = match;
  const expected = mac(secret, 'request_appointment:' + senderMobile + ':' + body).toString(
    'base64url',
  );
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const fields = Buffer.from(body, 'base64url').toString('utf8').split(':');
  const [acceptanceId, verifiedClientId, expires, reviewHash] = fields;
  if (
    fields.length !== 4 ||
    !validId(acceptanceId) ||
    !validId(verifiedClientId) ||
    !REVIEW.test(reviewHash) ||
    !/^\d{10}$/.test(expires) ||
    Number(expires) <= Math.floor(now / 1000)
  )
    return null;
  return { acceptanceId, verifiedClientId, senderMobile, reviewHash };
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

// Verify the original callback bytes before interpreting messages from the configured number.
function* verifiedWhatsAppMessages(
  raw,
  header,
  { providerSecret, phoneNumberId, allowedSender } = {},
) {
  if (
    !providerSecret ||
    !phoneNumberId ||
    !Buffer.isBuffer(raw) ||
    !raw.length ||
    raw.length > MAX_BODY_BYTES ||
    typeof header !== 'string' ||
    !/^sha256=[0-9a-f]{64}$/.test(header)
  )
    return;

  if (!timingSafeEqual(mac(providerSecret, raw), Buffer.from(header.slice(7), 'hex'))) return;
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return;
  }
  if (payload?.object !== 'whatsapp_business_account') return;
  for (const entry of list(payload.entry)) {
    for (const change of list(entry?.changes)) {
      const value = change?.value;
      if (
        change?.field !== 'messages' ||
        value?.messaging_product !== 'whatsapp' ||
        value.metadata?.phone_number_id !== phoneNumberId
      )
        continue;
      for (const message of list(value.messages)) {
        if (
          typeof message?.from === 'string' &&
          MOBILE.test(message.from) &&
          (allowedSender === undefined || message.from === allowedSender)
        )
          yield message;
      }
    }
  }
}

function verifiedBookingTaps(raw, header, configuration = {}) {
  const { actionSecret, now = Date.now() } = configuration;
  if (!actionSecret) return [];
  const actions = new Map();
  for (const message of verifiedWhatsAppMessages(raw, header, configuration)) {
    if (message.type !== 'interactive' || message.interactive?.type !== 'button_reply') continue;
    const action = bookingAction(
      message.interactive.button_reply?.id,
      message.from,
      actionSecret,
      now,
    );
    if (action) actions.set(action.acceptanceId, action);
  }
  return [...actions.values()];
}

module.exports = {
  issueBookingAction,
  verifiedBookingTaps,
  verifiedWhatsAppMessages,
  BOOKING_ACTION_TTL_SECONDS,
};
