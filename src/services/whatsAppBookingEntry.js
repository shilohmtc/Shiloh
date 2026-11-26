'use strict';

const { createHash } = require('node:crypto');
const { verifiedWhatsAppMessages } = require('./whatsAppBookingActions');

const SERVICE_WINDOW_SECONDS = 24 * 60 * 60;
const BOOKING_LINK = 'https://app.shilohmtc.co.za/my-shiloh/book';

function bookingLinkReplies(raw, signature, configuration) {
  const now = Math.floor((configuration.now ?? Date.now()) / 1000);
  const replies = new Map();
  for (const message of verifiedWhatsAppMessages(raw, signature, configuration)) {
    if (
      message.type !== 'text' ||
      typeof message.text?.body !== 'string' ||
      !/^book an appointment$/i.test(message.text.body.trim()) ||
      typeof message.id !== 'string' ||
      !/^wamid\.[a-zA-Z0-9+/_=-]{1,240}$/.test(message.id) ||
      typeof message.timestamp !== 'string' ||
      !/^\d{10}$/.test(message.timestamp)
    )
      continue;
    const sentAt = Number(message.timestamp);
    if (sentAt > now || now - sentAt >= SERVICE_WINDOW_SECONDS) continue;
    const key = createHash('sha256').update(message.id).digest('hex');
    replies.set(key, {
      recipient: message.from,
      text:
        'Welcome to Shiloh! To request an appointment, sign in or create your profile in your browser. Then you can choose a treatment and time. Reception will review your request before any deposit is due.\n\n' +
        BOOKING_LINK,
      deduplicationKey: 'booking-entry:' + key,
      expiresAt: new Date((sentAt + SERVICE_WINDOW_SECONDS) * 1000).toISOString(),
    });
  }
  return [...replies.values()];
}

module.exports = { bookingLinkReplies };
