'use strict';

const { pool } = require('../db/pool');
const { pendingRequestReceipt } = require('./whatsAppBookingRequestReceipt');
const { commitAcceptedClientBooking } = require('./clientBookingCommit');
const { verifiedBookingTaps } = require('./whatsAppBookingActions');

function createWhatsAppBookingIntake({
  db = pool,
  readReceipt = pendingRequestReceipt,
  commitBooking = commitAcceptedClientBooking,
} = {}) {
  return async function receiveBookingRequests(raw, signature, configuration) {
    const replies = [];
    for (const action of verifiedBookingTaps(raw, signature, configuration)) {
      const existing = await readReceipt(db, action);
      if (existing) {
        replies.push({ senderMobile: action.senderMobile, ...existing });
        continue;
      }

      const committed = await commitBooking(action.senderMobile, {
        crmV2ClientId: action.verifiedClientId,
        whatsappAcceptanceId: action.acceptanceId,
        whatsappReviewHash: action.reviewHash,
        enableMorningOffer: true,
      });
      // Another executor may have committed after our first read.
      const receipt =
        committed.status === 'pending_resolution' ? committed : await readReceipt(db, action);
      if (receipt) replies.push({ senderMobile: action.senderMobile, ...receipt });
    }
    return replies;
  };
}

module.exports = { createWhatsAppBookingIntake };
