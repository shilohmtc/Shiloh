const express = require("express");
const router = express.Router();

const {
  verifyWebhook,
  receiveWebhook,
} = require("../controllers/webhookController");
const { processWhatsAppStatusWebhook } = require("../controllers/whatsappStatusWebhookController");
const { myShilohWhatsAppAuthMiddleware } = require("../middleware/myShilohWhatsAppAuth");
const { staffWhatsAppPasskeyBootstrapMiddleware } = require("../middleware/staffWhatsAppPasskeyBootstrap");
const { metaSignInOnly } = require('../services/metaSignInOnly');

router.get("/webhook", verifyWebhook);
router.post(
  "/webhook",
  processWhatsAppStatusWebhook,
  myShilohWhatsAppAuthMiddleware,
  staffWhatsAppPasskeyBootstrapMiddleware,
  (req, res, next) => metaSignInOnly() ? res.sendStatus(200) : next(),
  receiveWebhook,
);

module.exports = router;
