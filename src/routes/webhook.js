'use strict';

const express = require('express');
const {
  createWhatsAppStatusWebhookController,
  processWhatsAppStatusWebhook,
} = require('../controllers/whatsappStatusWebhookController');
const logger = require('../lib/logger');
const { createWhatsAppBookingIntake } = require('../services/whatsAppBookingIntake');

const { bookingLinkReplies } = require('../services/whatsAppBookingEntry');

function createWebhookRouter({
  booking = null,
  receiveBooking = createWhatsAppBookingIntake(),
  deliverAcknowledgement,
  deliverBookingLink,
  persistStatuses,
} = {}) {
  const router = express.Router();
  if (
    booking &&
    (!booking.providerSecret ||
      !booking.actionSecret ||
      !booking.phoneNumberId ||
      typeof deliverAcknowledgement !== 'function')
  ) {
    throw new TypeError(
      'WhatsApp booking requires provider authentication and an acknowledgement sender',
    );
  }
  if (!booking) {
    router.post(
      '/webhook',
      express.json({ limit: '2mb' }),
      persistStatuses
        ? createWhatsAppStatusWebhookController({ persistStatuses })
        : processWhatsAppStatusWebhook,
      (_req, res) => res.sendStatus(200),
    );
    return router;
  }

  const parseJson = express.json({
    limit: '2mb',
    verify(req, _res, bytes) {
      req.whatsAppRawBody = bytes;
    },
  });
  const recordStatus = createWhatsAppStatusWebhookController({
    persistStatuses,
    continueAfterStatuses: true,
  });
  router.post('/webhook', parseJson, recordStatus, async (req, res) => {
    try {
      if (deliverBookingLink) {
        for (const reply of bookingLinkReplies(
          req.whatsAppRawBody,
          req.get('X-Hub-Signature-256'),
          booking,
        )) {
          await deliverBookingLink(reply);
        }
      }
      const replies = await receiveBooking(
        req.whatsAppRawBody,
        req.get('X-Hub-Signature-256'),
        booking,
      );
      for (const reply of replies) {
        // The delivery service must persist this key across process and provider retries.
        await deliverAcknowledgement({
          recipient: reply.senderMobile,
          text: reply.reply,
          deduplicationKey: 'booking-pending:' + reply.appointmentId,
        });
      }
      return res.sendStatus(200);
    } catch {
      (req.log || logger).warn('WhatsApp booking intake or acknowledgement failed safely');
      return res.sendStatus(503);
    }
  });
  return router;
}

module.exports = createWebhookRouter();
module.exports.createWebhookRouter = createWebhookRouter;
