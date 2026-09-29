const DELIVERY_FLAG = 'SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED';

function isStaffBrowserWhatsAppDeliveryEnabled(env = process.env) {
  // Keep the old configuration key recognizable, but never enable this retired route.
  void env;
  return false;
}

function createStaffBrowserChallengeDispatcher({ env = process.env, sendMessage = null, sendTemplate = null } = {}) {
  if (!isStaffBrowserWhatsAppDeliveryEnabled(env)) return null;

  // sendMessage is retained only as an injected compatibility seam for existing unit tests.
  // Production never imports or falls back to the generic free-form WhatsApp sender.
  const templateSend = sendTemplate || (sendMessage ? null : require('./staffAuthWhatsApp').sendStaffAuthTemplate);
  if (!sendMessage && typeof templateSend !== 'function') throw new Error('staff browser WhatsApp template provider is unavailable');

  return async function dispatchStaffBrowserChallenge({ destination, code, expiresAt } = {}) {
    const to = String(destination || '').trim();
    const challenge = String(code || '').trim().toUpperCase();
    const expiry = new Date(expiresAt).getTime();
    if (!/^\+?\d{10,15}$/.test(to)
      || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/.test(challenge)
      || !Number.isFinite(expiry)
      || expiry <= Date.now()) {
      throw new Error('invalid staff browser authentication delivery payload');
    }

    if (sendMessage) {
      const expiryMinutes = Math.max(1, Math.ceil((expiry - Date.now()) / 60000));
      const message = `Your Shiloh staff sign-in code is ${challenge}. It expires in about ${expiryMinutes} minutes. If you did not request this, ignore this message.`;
      return sendMessage(to, message);
    }

    return templateSend(to, challenge);
  };
}

module.exports = {
  DELIVERY_FLAG,
  isStaffBrowserWhatsAppDeliveryEnabled,
  createStaffBrowserChallengeDispatcher,
};
