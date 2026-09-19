'use strict';

const { generateReply } = require('./ai');
const { clearSession } = require('./memory');
const clientContext = require('./myShilohClientContext');

const MAX_MESSAGE_CHARS = 1000;
const MESSAGE_WINDOW_MS = 60 * 1000;
const MESSAGE_WINDOW_LIMIT = 12;

class MyShilohAssistantError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'MyShilohAssistantError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeMessage(value) {
  if (typeof value !== 'string') {
    throw new MyShilohAssistantError('MY_SHILOH_MESSAGE_INVALID', 'Please type a message for Shiloh.', 422);
  }
  const message = value.replace(/\r\n?/g, '\n').trim();
  if (!message) {
    throw new MyShilohAssistantError('MY_SHILOH_MESSAGE_EMPTY', 'Please type a message for Shiloh.', 422);
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new MyShilohAssistantError(
      'MY_SHILOH_MESSAGE_TOO_LONG',
      'Please shorten your message and try again.',
      422,
    );
  }
  return message;
}

function conversationKey(sessionId) {
  const id = positiveId(sessionId);
  if (!id) throw new MyShilohAssistantError('MY_SHILOH_SESSION_INVALID', 'Your secure session is unavailable.', 401);
  const key = `myshiloh:${id}`;
  if (key.length > 32) throw new MyShilohAssistantError('MY_SHILOH_SESSION_INVALID', 'Your secure session is unavailable.', 401);
  return key;
}

function firstName(value = '') {
  return String(value || '').trim().split(/\s+/)[0] || 'Client';
}

function createMessageLimiter({
  now = () => Date.now(),
  windowMs = MESSAGE_WINDOW_MS,
  limit = MESSAGE_WINDOW_LIMIT,
} = {}) {
  const windows = new Map();

  function allow(key) {
    const timestamp = Number(now());
    const current = windows.get(key);
    if (!current || timestamp - current.startedAt >= windowMs) {
      windows.set(key, { startedAt: timestamp, count: 1 });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  function clear(key) {
    windows.delete(key);
  }

  return { allow, clear };
}

function createMyShilohAssistantService({
  ai = generateReply,
  contextService = clientContext,
  clearConversationSession = clearSession,
  limiter = createMessageLimiter(),
} = {}) {
  if (!contextService || typeof contextService.getContext !== 'function') {
    throw new Error('My Shiloh client context service is required');
  }
  if (typeof ai !== 'function') throw new Error('Shiloh AI service is required');

  async function reply({ sessionId, crmV2ClientId, message } = {}) {
    const key = conversationKey(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) {
      throw new MyShilohAssistantError('MY_SHILOH_CLIENT_INVALID', 'Your secure client profile is unavailable.', 401);
    }
    const cleanMessage = normalizeMessage(message);
    if (!limiter.allow(key)) {
      throw new MyShilohAssistantError(
        'MY_SHILOH_ASSISTANT_RATE_LIMITED',
        'Shiloh is receiving messages a little too quickly. Please try again shortly.',
        429,
      );
    }

    const context = await contextService.getContext({ crmV2ClientId: clientId });
    if (!context?.client) {
      throw new MyShilohAssistantError(
        'MY_SHILOH_CLIENT_UNAVAILABLE',
        'Your secure client profile is temporarily unavailable.',
        404,
      );
    }

    const replyText = await ai(key, cleanMessage, {
      conversationKey: key,
      profileOverride: { name: firstName(context.client.name) },
      clientContext: context,
      surface: 'my_shiloh',
    });

    const safeReply = String(replyText || '').trim();
    if (!safeReply) {
      throw new MyShilohAssistantError(
        'MY_SHILOH_ASSISTANT_EMPTY',
        'Shiloh could not answer that just now. Please try again.',
        503,
      );
    }

    return {
      reply: safeReply,
      contextVersion: String(context.version || 'my_shiloh_client_context_v1'),
    };
  }

  async function clearConversation({ sessionId } = {}) {
    const key = conversationKey(sessionId);
    limiter.clear(key);
    try {
      await clearConversationSession(key);
    } catch (_) {
      // Client sign-out remains authoritative even if conversation cleanup is unavailable.
    }
  }

  return {
    reply,
    clearConversation,
  };
}

const service = createMyShilohAssistantService();

module.exports = {
  MAX_MESSAGE_CHARS,
  MESSAGE_WINDOW_MS,
  MESSAGE_WINDOW_LIMIT,
  MyShilohAssistantError,
  positiveId,
  normalizeMessage,
  conversationKey,
  firstName,
  createMessageLimiter,
  createMyShilohAssistantService,
  ...service,
};
