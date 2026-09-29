const express = require("express");
const router = express.Router();

const { processWhatsAppStatusWebhook } = require("../controllers/whatsappStatusWebhookController");

router.post(
  "/webhook",
  processWhatsAppStatusWebhook,
  // Delivery receipts remain; conversations belong to human Reception.
  // My Shiloh and Workspace authenticate with passkeys and SMS setup.
  (_req, res) => res.sendStatus(200),
);

module.exports = router;
