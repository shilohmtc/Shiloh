// Compatibility entry points for historical callers. Automated WhatsApp is
// permanently retired; no provider URL, credentials or network sender remains.
const { assertNonAuthMetaAllowed } = require('./metaSignInOnly');

async function sendWhatsAppMessage() { assertNonAuthMetaAllowed(); }
async function sendWhatsAppSignInMessage() { assertNonAuthMetaAllowed(); }
async function sendWhatsAppReplyButtons() { assertNonAuthMetaAllowed(); }
async function sendWhatsAppCtaUrl() { assertNonAuthMetaAllowed(); }
async function sendWhatsAppList() { assertNonAuthMetaAllowed(); }
async function sendWhatsAppTemplate() { assertNonAuthMetaAllowed(); }

module.exports = { sendWhatsAppMessage, sendWhatsAppSignInMessage, sendWhatsAppReplyButtons,
  sendWhatsAppCtaUrl, sendWhatsAppList, sendWhatsAppTemplate };
