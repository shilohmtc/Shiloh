'use strict';

const { createHmac } = require('node:crypto');
const { createBoundedJsonRequest } = require('./workspaceWhatsAppProviders');

const {
  WELCOME_TEXT,
  BOOKING_LINK,
  GREETING_TEXT,
  GREETING_BUTTONS,
  RECEPTION_TEXT,
} = require('./whatsAppBookingEntry');
const { STEP_TITLES, UNAVAILABLE, BOOKING_REVIEW_URL } = require('./whatsAppBookingChat');
const { PENDING_REPLY } = require('./whatsAppBookingRequestReceipt');

const MOBILE = /^27[678][0-9]{8}$/;
const PROVIDER_ID = /^wamid\.[A-Za-z0-9+/_=-]{1,240}$/;
const KEYS = {
  welcome: /^booking-entry:[a-f0-9]{64}$/,
  greeting: /^booking-entry:[a-f0-9]{64}$/,
  reception: /^booking-entry:[a-f0-9]{64}$/,
  button: /^booking-request-button:[1-9][0-9]{0,18}$/,
  menu: /^booking-menu:[a-f0-9]{64}$/,
  pending: /^booking-pending:[1-9][0-9]{0,18}$/,
};

function messageBody(kind, input, chat, continuation) {
  if (kind === 'menu') {
    if (!chat) return null;
    if (
      input.type === 'list' &&
      Object.values(STEP_TITLES).includes(input.text) &&
      Array.isArray(input.rows) &&
      input.rows.length > 0 &&
      input.rows.length <= 10 &&
      input.rows.every(
        (row) =>
          typeof row.title === 'string' &&
          [...row.title].length > 0 &&
          [...row.title].length <= 24 &&
          chat.acceptsMenuRow(row.id, input.recipient),
      )
    ) {
      return {
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: input.text },
          action: {
            button: 'See options',
            sections: [
              { title: 'Booking', rows: input.rows.map(({ id, title }) => ({ id, title })) },
            ],
          },
        },
      };
    }
    if (input.type !== 'text' || typeof input.text !== 'string' || input.text.length > 1024)
      return null;
    if (input.text === UNAVAILABLE)
      return { type: 'text', text: { body: input.text, preview_url: false } };
    const marker = '\nReview your appointment and booking terms: ' + BOOKING_REVIEW_URL;
    const separator = input.text.indexOf(marker);
    if (
      !input.text.startsWith('Treatment: ') ||
      separator < 0 ||
      continuation?.selectedMobile(input.text.slice(separator + marker.length)) !== input.recipient
    )
      return null;
    return { type: 'text', text: { body: input.text, preview_url: false } };
  }
  if (kind === 'welcome' && chat && typeof input.text === 'string') {
    const prefix = WELCOME_TEXT.slice(0, -BOOKING_LINK.length);
    if (
      !input.text.startsWith(prefix) ||
      !chat.acceptsStartLink(input.text.slice(prefix.length), input.recipient)
    )
      return null;
    return { type: 'text', text: { body: input.text, preview_url: false } };
  }
  if (kind === 'button') {
    if (
      typeof input.action !== 'string' ||
      !/^request_appointment:[A-Za-z0-9_-]{1,140}\.[A-Za-z0-9_-]{43}$/.test(input.action)
    )
      return null;
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: 'Tap below to send your appointment request to Shiloh Reception for review.',
        },
        action: {
          buttons: [{ type: 'reply', reply: { id: input.action, title: 'Request appointment' } }],
        },
      },
    };
  }

  if (kind === 'greeting') {
    if (input.text !== GREETING_TEXT) return null;
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: GREETING_TEXT },
        action: { buttons: GREETING_BUTTONS.map((reply) => ({ type: 'reply', reply })) },
      },
    };
  }
  const text = { welcome: WELCOME_TEXT, reception: RECEPTION_TEXT, pending: PENDING_REPLY }[kind];
  if (input.text !== text) return null;
  return { type: 'text', text: { body: text, preview_url: false } };
}

function createWhatsAppBookingSender({
  enabled = false,
  db,
  provider,
  fingerprintKey,
  authorizeDelivery,
  chat,
  continuation,
  fetchImpl,
  clock = Date.now,
} = {}) {
  const request = createBoundedJsonRequest({ fetchImpl });
  const configured =
    enabled === true &&
    db?.query &&
    request &&
    typeof authorizeDelivery === 'function' &&
    Buffer.isBuffer(fingerprintKey) &&
    fingerprintKey.length === 32 &&
    /^[0-9]{1,30}$/.test(provider?.phoneNumberId || '') &&
    /^v[0-9]{1,3}\.[0-9]{1,2}$/.test(provider?.apiVersion || '') &&
    typeof provider.accessToken === 'string' &&
    /^[^\s]{1,4096}$/.test(provider.accessToken);

  async function deliver(kind, input = {}) {
    if (!configured) throw new Error('WhatsApp booking delivery is disabled');
    const { recipient, deduplicationKey } = input;
    if (
      typeof recipient !== 'string' ||
      !MOBILE.test(recipient) ||
      typeof deduplicationKey !== 'string' ||
      !KEYS[kind].test(deduplicationKey)
    ) {
      throw new Error('Invalid WhatsApp booking delivery');
    }
    const contents = messageBody(kind, input, chat, continuation);
    if (!contents) throw new Error('Invalid WhatsApp booking message');
    const body = JSON.stringify({ messaging_product: 'whatsapp', to: recipient, ...contents });
    // A callback retry may mint a new private link for the same reviewed selection.
    const comparable =
      kind === 'menu' && contents.type === 'text'
        ? body.replace(/request=[A-Za-z0-9_-]+(?="[^"]*$)/, 'request=[private]')
        : body;
    const fingerprint = createHmac('sha256', fingerprintKey).update(comparable).digest('hex');
    const lookup = async () =>
      (
        await db.query(
          'SELECT state,fingerprint FROM whatsapp_booking_deliveries WHERE delivery_key=$1',
          [deduplicationKey],
        )
      ).rows[0];
    function existing(row) {
      if (row?.state === 'accepted' && row.fingerprint === fingerprint)
        return { state: 'accepted', replayed: true };
      throw new Error('WhatsApp delivery needs review');
    }
    const prior = await lookup();
    if (prior) return existing(prior);

    // The caller supplies an authoritative signed-inbound service window and budget admission.
    const admission = await authorizeDelivery({ recipient, kind, deduplicationKey });
    const expiresAt = Math.min(
      Date.parse(admission?.serviceWindowEndsAt),
      input.expiresAt === undefined ? Infinity : Date.parse(input.expiresAt),
    );
    if (admission?.allowed !== true || !Number.isFinite(expiresAt) || expiresAt <= clock()) {
      throw new Error('WhatsApp booking delivery is outside its allowed window or budget');
    }
    const claimed = await db.query(
      `
      INSERT INTO whatsapp_booking_deliveries(delivery_key,fingerprint)
      VALUES($1,$2) ON CONFLICT(delivery_key) DO NOTHING RETURNING delivery_key`,
      [deduplicationKey, fingerprint],
    );
    if (claimed.rows.length !== 1) return existing(await lookup());

    let providerMessageId;
    try {
      if (expiresAt <= clock()) throw new Error('Expired delivery');
      const result = await request(
        'https://graph.facebook.com/' +
          provider.apiVersion +
          '/' +
          provider.phoneNumberId +
          '/messages',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + provider.accessToken,
            'Content-Type': 'application/json',
          },
          body,
        },
      );
      providerMessageId = result.body?.messages?.[0]?.id;
      if (!result.ok || result.body?.error || !PROVIDER_ID.test(providerMessageId || ''))
        throw new Error('Unconfirmed delivery');
    } catch {
      await db.query(
        "UPDATE whatsapp_booking_deliveries SET state='uncertain' WHERE delivery_key=$1",
        [deduplicationKey],
      );
      throw new Error('WhatsApp delivery needs review');
    }
    await db.query(
      "UPDATE whatsapp_booking_deliveries SET state='accepted',provider_message_id=$2 WHERE delivery_key=$1",
      [deduplicationKey, providerMessageId],
    );
    return { state: 'accepted', replayed: false };
  }

  return {
    deliverBookingMenu: (input) => deliver('menu', input),
    deliverBookingLink: (input) => deliver('welcome', input),
    deliverGreeting: (input) => deliver('greeting', input),
    deliverReceptionPrompt: (input) => deliver('reception', input),
    deliverRequestButton: (input) => deliver('button', input),
    deliverAcknowledgement: (input) => deliver('pending', input),
  };
}

module.exports = { createWhatsAppBookingSender };
