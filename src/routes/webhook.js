const express = require("express");
const router = express.Router();

const logger = require('../lib/logger');
const { processWhatsAppStatusWebhook } = require("../controllers/whatsappStatusWebhookController");

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && process.env.VERIFY_TOKEN && token === process.env.VERIFY_TOKEN) {
    (req.log || logger).info('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  (req.log || logger).warn('WhatsApp webhook verification rejected');
  return res.sendStatus(403);
});
router.post(
  "/webhook",
  processWhatsAppStatusWebhook,
  // Delivery receipts remain; conversations belong to human Reception.
  // My Shiloh and Workspace authenticate with passkeys and SMS setup.
  (_req, res) => res.sendStatus(200),
);

module.exports = router;
