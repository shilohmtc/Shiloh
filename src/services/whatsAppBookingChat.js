'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { pool } = require('../db/pool');
const { verifiedWhatsAppBookingOwner } = require('./whatsAppBookingContinuation');
const { verifiedWhatsAppMessages } = require('./whatsAppBookingActions');

const BASE = 'https://app.shilohmtc.co.za/my-shiloh/code-auth/booking/open?request=';
const CLINIC_MOBILE = '27836835433';
const PREFIX = 'shiloh_chat.';
const MOBILE = /^27[678][0-9]{8}$/;
const TTL_SECONDS = 45 * 60;
const CHAT_TOKEN = /^shiloh_chat\.[A-Za-z0-9_-]{2,144}\.[A-Za-z0-9_-]{43}$/;
const WHEN = new Intl.DateTimeFormat('en-ZA', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Africa/Johannesburg',
});
const WAMID = /^wamid\.[A-Za-z0-9+/_=-]{1,240}$/;
const UNAVAILABLE =
  'This choice is no longer available. Return to your booking link to start again, or leave a message for Reception.';
const STEP_TITLES = {
  treatment: 'Choose a treatment',
  practitioner: 'Choose a practitioner',
  date: 'Choose a date',
  time: 'Choose a time',
};

function createWhatsAppBookingChat({ key, choices, nativeReview, db = pool, clock = Date.now }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof choices !== 'function') {
    throw new TypeError('A WhatsApp booking key and choice service are required');
  }
  const now = () => Math.floor(clock() / 1000);
  const mac = (mobile, body) =>
    createHmac('sha256', key)
      .update('booking-chat:v1:' + mobile + ':' + body)
      .digest('base64url');
  function token(mobile, claims) {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return PREFIX + body + '.' + mac(mobile, body);
  }
  function unpack(value, mobile) {
    if (typeof value !== 'string' || !CHAT_TOKEN.test(value) || !MOBILE.test(mobile)) return null;
    const [, body, signature] = value.split('.');
    if (!timingSafeEqual(Buffer.from(mac(mobile, body)), Buffer.from(signature))) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!Array.isArray(claims) || !Number.isSafeInteger(claims[1]) || claims[1] <= now())
        return null;
      return claims;
    } catch {
      return null;
    }
  }
  function startLink(mobile, sentAt) {
    if (
      !MOBILE.test(mobile) ||
      !Number.isInteger(sentAt) ||
      sentAt > now() ||
      sentAt + TTL_SECONDS <= now()
    )
      return null;
    return BASE + token(mobile, [0, sentAt + TTL_SECONDS]);
  }
  async function resumeLink(start, session) {
    if (!session?.crmV2ClientId) return null;
    const { rows } = await db.query(
      "SELECT normalized_mobile FROM crm_v2_clients WHERE id=$1 AND status='active'",
      [session.crmV2ClientId],
    );
    const mobile = rows[0]?.normalized_mobile;
    const claims = unpack(start, mobile);
    if (
      claims?.[0] !== 0 ||
      !(await verifiedWhatsAppBookingOwner(db, mobile, session.crmV2ClientId))
    )
      return null;
    const text = 'Continue booking ' + token(mobile, [1, claims[1], String(session.crmV2ClientId)]);
    return 'https://wa.me/' + CLINIC_MOBILE + '?text=' + encodeURIComponent(text);
  }

  async function deliverChoices({
    recipient,
    inboundId,
    inboundAt,
    expires,
    crmV2ClientId,
    serviceId,
    staffId,
    date,
    start,
    page,
    deliverMenu,
  }) {
    const reply = await choices({
      senderMobile: recipient,
      session: { crmV2ClientId },
      serviceId,
      staffId,
      date,
      startsAt: start,
      page: page ?? 0,
    });
    let content;
    if (reply.status === 'choices') {
      const rows = reply.choices.map(({ id, title }) => {
        const selection = {
          treatment: [id],
          practitioner: [serviceId, id],
          date: [serviceId, staffId, id],
          time: [serviceId, staffId, date, id],
        }[reply.kind];
        return {
          id: token(recipient, [1, expires, crmV2ClientId, ...selection]),
          title: [...title].slice(0, 24).join(''),
        };
      });
      if (reply.nextPage != null)
        rows.push({
          id: token(recipient, [
            1,
            expires,
            crmV2ClientId,
            serviceId ?? null,
            staffId ?? null,
            date ?? null,
            null,
            reply.nextPage,
          ]),
          title: 'More choices',
        });
      content = { type: 'list', text: STEP_TITLES[reply.kind], rows };
    } else if (reply.status === 'review' && nativeReview) {
      const action = nativeReview.issue({
        recipient,
        crmV2ClientId,
        serviceId,
        staffId,
        startsAt: reply.startsAt,
        reviewHash: reply.reviewHash,
        inboundAt,
        expires,
      });
      if (!action) return false;
      content = {
        type: 'review',
        action,
        inboundId,
        text: [
          'Treatment: ' + reply.service.name,
          'Practitioner: ' + reply.practitioner.name,
          'When: ' + WHEN.format(new Date(reply.startsAt)),
          'Price: R' + reply.price,
          'Deposit after staff approval: R' + reply.deposit,
          'Please read the Booking Policy & Terms above before accepting.',
        ].join('\n'),
      };
    } else if (reply.status === 'review') {
      content = {
        type: 'text',
        text:
          'Treatment: ' +
          reply.service.name +
          '\nPractitioner: ' +
          reply.practitioner.name +
          '\nWhen: ' +
          WHEN.format(new Date(reply.startsAt)) +
          '\nPrice: R' +
          reply.price +
          '\nDeposit after staff approval: R' +
          reply.deposit +
          '\nReview your appointment and booking terms: ' +
          BASE +
          reply.continuationToken,
      };
    } else if (reply.status === 'verification_required') {
      return false;
    } else {
      content = {
        type: 'text',
        text: UNAVAILABLE,
      };
    }
    await deliverMenu({
      recipient,
      expiresAt: new Date(expires * 1000).toISOString(),
      deduplicationKey: 'booking-menu:' + createHash('sha256').update(inboundId).digest('hex'),
      ...content,
    });
    return true;
  }

  // Called only with a server-verified, purpose-bound registration or booking proof.
  async function startVerified({ recipient, inboundId, expires, crmV2ClientId }, deliverMenu) {
    if (
      typeof recipient !== 'string' ||
      !MOBILE.test(recipient) ||
      typeof inboundId !== 'string' ||
      !WAMID.test(inboundId) ||
      !Number.isSafeInteger(expires) ||
      expires <= now() ||
      expires > now() + TTL_SECONDS ||
      !/^[1-9][0-9]{0,18}$/.test(String(crmV2ClientId ?? ''))
    )
      return false;
    return deliverChoices({
      recipient,
      inboundId,
      expires,
      crmV2ClientId: String(crmV2ClientId),
      deliverMenu,
    });
  }

  async function receive(raw, signature, configuration, deliverMenu) {
    const seen = new Set();
    for (const message of verifiedWhatsAppMessages(raw, signature, configuration)) {
      const value =
        message.type === 'text' && typeof message.text?.body === 'string'
          ? message.text.body.match(/^Continue booking (shiloh_chat\.[A-Za-z0-9_.-]+)$/)?.[1]
          : message.type === 'interactive' && message.interactive?.type === 'list_reply'
            ? message.interactive.list_reply?.id
            : null;
      const claims = unpack(value, message.from);
      if (
        claims?.[0] !== 1 ||
        !/^[1-9][0-9]{0,18}$/.test(claims[2] || '') ||
        typeof message.id !== 'string' ||
        !WAMID.test(message.id) ||
        seen.has(message.id)
      )
        continue;
      const sentAt = Number(message.timestamp);
      if (
        typeof message.timestamp !== 'string' ||
        !/^\d{10}$/.test(message.timestamp) ||
        sentAt > now() ||
        sentAt + TTL_SECONDS <= now()
      )
        continue;

      seen.add(message.id);
      const [, expires, crmV2ClientId, serviceId, staffId, date, start, page] = claims;
      await deliverChoices({
        recipient: message.from,
        inboundId: message.id,
        inboundAt: sentAt,
        expires,
        crmV2ClientId,
        serviceId,
        staffId,
        date,
        start,
        page,
        deliverMenu,
      });
    }
  }

  function acceptsStartLink(url, mobile) {
    return (
      typeof url === 'string' &&
      url.startsWith(BASE) &&
      unpack(url.slice(BASE.length), mobile)?.[0] === 0
    );
  }
  function acceptsMenuRow(id, mobile) {
    return unpack(id, mobile)?.[0] === 1;
  }
  return {
    startLink,
    startVerified,
    acceptsStartLink,
    acceptsMenuRow,
    resumeLink,
    receive,
    isStart: (value) => typeof value === 'string' && CHAT_TOKEN.test(value),
  };
}

module.exports = { createWhatsAppBookingChat, STEP_TITLES, UNAVAILABLE, BOOKING_REVIEW_URL: BASE };
