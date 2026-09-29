const express = require("express");
const router = express.Router();

const logger = require('../lib/logger');
const { processWhatsAppStatusWebhook } = require("../controllers/whatsappStatusWebhookController");
const { myShilohWhatsAppAuthMiddleware } = require("../middleware/myShilohWhatsAppAuth");

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    (req.log || logger).info('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  (req.log || logger).warn('WhatsApp webhook verification rejected');
  return res.sendStatus(403);
});
router.post(
  "/webhook",
  processWhatsAppStatusWebhook,
  myShilohWhatsAppAuthMiddleware,
  // Preserve client authentication fallback and delivery receipts. Staff
  // device enrollment now requires administrator-approved SMS verification.
  (_req, res) => res.sendStatus(200),
);

module.exports = router;
