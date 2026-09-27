'use strict';

const { sendWhatsAppSignInMessage } = require('../services/whatsapp');
const staffWhatsAppPasskeyBootstrap = require('../services/staffWhatsAppPasskeyBootstrap');

function isGreetingOnly(text = '') {
  return /^(hi|hello|hey|good morning|good afternoon|good evening|howzit|hiya)[!. ]*$/i.test(String(text).trim());
}

function inboundText(message = {}) {
  if (message.type === 'text') return String(message.text?.body || '').trim();
  return '';
}

function unavailableReply(displayName = '') {
  const name = String(displayName || '').trim();
  return `${name ? `Hi ${name}. ` : ''}Shiloh Workspace setup cannot be started from this number right now. Please ask your Shiloh administrator to check your Workspace access.`;
}

function createStaffWhatsAppPasskeyBootstrapMiddleware({
  bootstrapService = staffWhatsAppPasskeyBootstrap,
  sendMessage = sendWhatsAppSignInMessage,
} = {}) {
  if (!bootstrapService || typeof bootstrapService.issueBootstrap !== 'function') throw new Error('staff WhatsApp passkey bootstrap service is required');
  if (typeof sendMessage !== 'function') throw new Error('WhatsApp send function is required');

  return async function staffWhatsAppPasskeyBootstrapMiddleware(req, res, next) {
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      if (!value?.messages?.length) return next();
      const message = value.messages[0] || {};
      const from = String(message.from || '').trim();
      const text = inboundText(message);
      if (!from || !isGreetingOnly(text)) return next();

      const result = await bootstrapService.issueBootstrap({ whatsapp: from });
      if (!result?.handled) return next();

      if (!result.ok || result.eligible !== true) {
        await sendMessage(from, unavailableReply(result?.displayName));
        return res.sendStatus(200);
      }
      if (result.rateLimited) {
        await sendMessage(from, `Hi ${result.displayName || 'there'}. A Shiloh setup link was requested recently. Please wait a few minutes and send “Hi” again if you still need a new link.`);
        return res.sendStatus(200);
      }
      if (!result.url) {
        await sendMessage(from, unavailableReply(result.displayName));
        return res.sendStatus(200);
      }

      await sendMessage(
        from,
        `Hi ${result.displayName || 'there'} 👋\nYour Shiloh Workspace access is ready.\n\nSet up Shiloh securely on this phone:\n${result.url}\n\nThis private link expires shortly and works once.`
      );
      return res.sendStatus(200);
    } catch (error) {
      (req.log || console).error?.({ err: error }, 'Staff WhatsApp passkey bootstrap failed closed');
      return next();
    }
  };
}

const staffWhatsAppPasskeyBootstrapMiddleware = createStaffWhatsAppPasskeyBootstrapMiddleware();

module.exports = {
  isGreetingOnly,
  inboundText,
  unavailableReply,
  createStaffWhatsAppPasskeyBootstrapMiddleware,
  staffWhatsAppPasskeyBootstrapMiddleware,
};
