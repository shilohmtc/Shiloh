'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { BOOKING_POLICY_TEXT } = require('../config/bookingPolicyAuthority');
const { verifiedWhatsAppMessages } = require('./whatsAppBookingActions');

const PREFIX = 'shiloh_review.';
const MOBILE = /^27[678][0-9]{8}$/;
const WAMID = /^wamid\.[A-Za-z0-9+/_=-]{1,240}$/;
const ID = /^[1-9][0-9]{0,18}$/;
const HASH = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^shiloh_review\.([A-Za-z0-9_-]{50,190})\.([A-Za-z0-9_-]{43})$/;
const LIFETIME_SECONDS = 15 * 60;
const TERMS = BOOKING_POLICY_TEXT.split('\n\nTo continue with this booking request,')[0];

function createWhatsAppBookingNativeReview({ key, continuation, submit, clock = Date.now }) {
  const now = () => Math.floor(clock() / 1000);
  const mac = (mobile, body) =>
    createHmac('sha256', key)
      .update(PREFIX + mobile + ':' + body)
      .digest('base64url');

  function issue({
    recipient,
    crmV2ClientId,
    serviceId,
    staffId,
    startsAt,
    reviewHash,
    expires,
    inboundAt,
  }) {
    const start = Date.parse(startsAt);
    if (
      !MOBILE.test(recipient) ||
      !ID.test(String(crmV2ClientId)) ||
      !HASH.test(reviewHash) ||
      !Number.isSafeInteger(serviceId) ||
      serviceId <= 0 ||
      !Number.isSafeInteger(staffId) ||
      staffId <= 0 ||
      !Number.isSafeInteger(start) ||
      start <= clock() ||
      !Number.isSafeInteger(expires) ||
      !Number.isSafeInteger(inboundAt) ||
      inboundAt > now()
    )
      return null;
    const deadline = Math.min(expires, inboundAt + LIFETIME_SECONDS);
    if (deadline <= now()) return null;
    const body = Buffer.from(
      [crmV2ClientId, serviceId, staffId, start, reviewHash, deadline].join(':'),
    ).toString('base64url');
    return PREFIX + body + '.' + mac(recipient, body);
  }

  function read(value, mobile) {
    const matched = typeof value === 'string' && TOKEN.exec(value);
    if (!matched || !MOBILE.test(mobile)) return null;
    const [, body, signature] = matched;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(mac(mobile, body)))) return null;
    const [id, service, staff, start, hash, deadline] = Buffer.from(body, 'base64url')
      .toString('utf8')
      .split(':');
    const expires = Number(deadline);
    if (expires <= now() || Number(start) <= clock()) return null;
    return {
      id,
      serviceId: Number(service),
      staffId: Number(staff),
      startsAt: new Date(Number(start)).toISOString(),
      hash,
      expires,
    };
  }

  async function receive(raw, signature, configuration, deliverRequestButton) {
    const processed = new Set();
    for (const message of verifiedWhatsAppMessages(raw, signature, configuration)) {
      if (
        message.type !== 'interactive' ||
        message.interactive?.type !== 'button_reply' ||
        typeof message.id !== 'string' ||
        !WAMID.test(message.id) ||
        typeof message.timestamp !== 'string' ||
        !/^\d{10}$/.test(message.timestamp) ||
        Number(message.timestamp) > now() ||
        Number(message.timestamp) + LIFETIME_SECONDS <= now() ||
        processed.has(message.id)
      )
        continue;
      const selection = read(message.interactive.button_reply?.id, message.from);
      if (!selection) continue;
      processed.add(message.id);
      const token = continuation.issue({
        senderMobile: message.from,
        serviceId: selection.serviceId,
        staffId: selection.staffId,
        startsAt: selection.startsAt,
      });
      const result = await submit({
        token,
        session: { crmV2ClientId: selection.id },
        reviewHash: selection.hash,
        policyAccepted: true,
      });
      if (result.status !== 'ready' || result.recipient !== message.from) continue;
      await deliverRequestButton({
        recipient: result.recipient,
        action: result.action,
        expiresAt: result.expiresAt,
        deduplicationKey: 'booking-request-button:' + result.acceptanceId,
      });
    }
  }
  return { issue, read, receive };
}

function termsDelivery(input) {
  return {
    recipient: input.recipient,
    expiresAt: input.expiresAt,
    deduplicationKey: 'booking-terms:' + createHash('sha256').update(input.inboundId).digest('hex'),
    text: TERMS,
  };
}

module.exports = { createWhatsAppBookingNativeReview, termsDelivery, TERMS };
