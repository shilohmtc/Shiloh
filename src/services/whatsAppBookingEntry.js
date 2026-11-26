'use strict';

const { createHash } = require('node:crypto');
const { verifiedWhatsAppMessages } = require('./whatsAppBookingActions');

const SERVICE_WINDOW_SECONDS = 24 * 60 * 60;
const BOOKING_LINK = 'https://app.shilohmtc.co.za/my-shiloh/book';

const WELCOME_TEXT =
  'Welcome to Shiloh! To request an appointment, sign in or create your profile in your browser. Then you can choose a treatment and time. Reception will review your request before any deposit is due.\n\n' +
  BOOKING_LINK;

const GREETING_TEXT = 'Welcome to Shiloh! How can we help?';
const RECEPTION_TEXT = 'Please leave your message here so Reception can help.';
const GREETING_BUTTONS = Object.freeze([
  Object.freeze({ id: 'shiloh_booking_start', title: 'Book an appointment' }),
  Object.freeze({ id: 'shiloh_talk_to_reception', title: 'Talk to Reception' }),
]);

function messageChoice(message) {
  if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
    const id = message.interactive.button_reply?.id;
    if (id === GREETING_BUTTONS[0].id) return { kind: 'link', text: WELCOME_TEXT };
    if (id === GREETING_BUTTONS[1].id) return { kind: 'reception', text: RECEPTION_TEXT };
  }
  if (message.type !== 'text' || typeof message.text?.body !== 'string') return null;
  const text = message.text.body.trim();
  if (/^(?:hi|hello)[!.]?$/i.test(text)) return { kind: 'greeting', text: GREETING_TEXT };
  if (/^(?:book|book an appointment)$/i.test(text)) return { kind: 'link', text: WELCOME_TEXT };
  return null;
}

function bookingEntryReplies(raw, signature, configuration) {
  const now = Math.floor((configuration.now ?? Date.now()) / 1000);
  const replies = new Map();
  for (const message of verifiedWhatsAppMessages(raw, signature, configuration)) {
    if (
      typeof message.id !== 'string' ||
      !/^wamid\.[a-zA-Z0-9+/_=-]{1,240}$/.test(message.id) ||
      typeof message.timestamp !== 'string' ||
      !/^\d{10}$/.test(message.timestamp)
    )
      continue;
    const sentAt = Number(message.timestamp);
    if (sentAt > now || now - sentAt >= SERVICE_WINDOW_SECONDS) continue;
    const choice = messageChoice(message);
    if (!choice) continue;
    const key = createHash('sha256').update(message.id).digest('hex');
    replies.set(key, {
      ...choice,
      recipient: message.from,
      deduplicationKey: 'booking-entry:' + key,
      expiresAt: new Date((sentAt + SERVICE_WINDOW_SECONDS) * 1000).toISOString(),
    });
  }
  return [...replies.values()];
}

module.exports = {
  bookingEntryReplies,
  WELCOME_TEXT,
  GREETING_TEXT,
  GREETING_BUTTONS,
  RECEPTION_TEXT,
};
