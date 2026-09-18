const express = require("express");
const router = express.Router();

const {
  verifyWebhook,
  receiveWebhook,
} = require("../controllers/webhookController");
const { processWhatsAppStatusWebhook } = require("../controllers/whatsappStatusWebhookController");
const { myShilohWhatsAppAuthMiddleware } = require("../middleware/myShilohWhatsAppAuth");
const { staffWhatsAppPasskeyBootstrapMiddleware } = require("../middleware/staffWhatsAppPasskeyBootstrap");

router.get("/webhook", verifyWebhook);
router.post(
  "/webhook",
  processWhatsAppStatusWebhook,
  myShilohWhatsAppAuthMiddleware,
  staffWhatsAppPasskeyBootstrapMiddleware,
  receiveWebhook,
);

module.exports = router;
