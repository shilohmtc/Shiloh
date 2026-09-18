'use strict';

const { pool } = require('../db/pool');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { createClientBrowserSessionService } = require('../services/clientBrowserSession');
const { CANONICAL_ORIGIN } = require('./canonicalHostRedirect');
const logger = require('../lib/logger');

const LOGIN_PREFIX = 'MY SHILOH SIGN IN';

function maskPhone(phone = '') {
  const text = String(phone || '');
  return text.length > 4 ? `***${text.slice(-4)}` : '***';
}

function extractMyShilohLoginToken(message) {
  if (message?.type !== 'text') return null;
  const text = String(message.text?.body || '').trim();
  const match = text.match(/^MY SHILOH SIGN IN\s+([A-Za-z0-9_-]{43})$/i);
  return match ? match[1] : null;
}

function myShilohCompletionUrl(code, origin = CANONICAL_ORIGIN) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  return `${String(origin || CANONICAL_ORIGIN).replace(/\/$/, '')}/my-shiloh/#verify=${clean}`;
}

function createMyShilohWhatsAppAuthMiddleware({
  service = createClientBrowserSessionService({ db: pool }),
  sendMessage = sendWhatsAppMessage,
  log = logger,
} = {}) {
  return async function myShilohWhatsAppAuth(req, res, next) {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const token = extractMyShilohLoginToken(message);
    if (!token) return next();

    const from = String(message?.from || '').trim();
    if (!from) return res.sendStatus(200);
    try {
      const result = await service.verifyWhatsAppChallenge({
        whatsappToken: token,
        senderMobile: from,
      });
      log.info({
        from: maskPhone(from),
        verified: result.ok === true,
        code: result.ok ? null : result.code,
      }, 'Processed My Shiloh WhatsApp sign-in challenge');

      if (result.ok) {
        const finishUrl = myShilohCompletionUrl(result.completionCode);
        const spacedCode = String(result.completionCode || '').replace(/^(\d{3})(\d{3})$/, '$1 $2');
        await sendMessage(
          from,
          `You're verified 🌿\n\nFinish your secure My Shiloh sign-in:\n${finishUrl}\n\nOr return to My Shiloh and enter this one-time code: *${spacedCode}*\n\nIt expires with this sign-in request.`,
        );
      } else if (result.code === 'CLIENT_AUTH_PROFILE_UNAVAILABLE') {
        await sendMessage(
          from,
          `I couldn't connect this WhatsApp number to an active My Shiloh client profile yet. 🌿\n\nYou can keep chatting with Shiloh here, or return to My Shiloh after your client profile is active.`,
        );
      } else {
        await sendMessage(
          from,
          `That My Shiloh sign-in request is no longer available. Please return to My Shiloh and choose *Continue with WhatsApp* again.`,
        );
      }
      return res.sendStatus(200);
    } catch (error) {
      log.error({ err: error, from: maskPhone(from) }, 'My Shiloh WhatsApp sign-in failed');
      try {
        await sendMessage(
          from,
          `I couldn't verify My Shiloh right now. Please return to My Shiloh and try again in a moment.`,
        );
      } catch (sendError) {
        log.error({ err: sendError }, 'My Shiloh WhatsApp sign-in fallback failed');
      }
      return res.sendStatus(200);
    }
  };
}

const myShilohWhatsAppAuthMiddleware = createMyShilohWhatsAppAuthMiddleware();

module.exports = {
  LOGIN_PREFIX,
  extractMyShilohLoginToken,
  myShilohCompletionUrl,
  createMyShilohWhatsAppAuthMiddleware,
  myShilohWhatsAppAuthMiddleware,
};
