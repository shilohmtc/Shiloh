const axios = require('axios');
const logger = require('../lib/logger');
const { assertTemplateSendAllowed } = require('./metaTemplateContracts');
const { sanitizeProviderText } = require('./whatsappStatusCallback');
const { assertNonAuthMetaAllowed } = require('./metaSignInOnly');
const {
  STAFF_AUTH_TEMPLATE_NAME,
  STAFF_AUTH_TEMPLATE_LANGUAGE,
} = require('./staffAuthTemplateDefinition');

const GRAPH_VERSION = 'v23.0';
const CHALLENGE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;

function sanitizedMetaFailure(error) {
  const provider = error?.response?.data?.error || {};
  return {
    status: error?.response?.status || null,
    providerCode: sanitizeProviderText(provider.code, 60),
    providerTitle: sanitizeProviderText(provider.error_user_title || provider.type, 120),
    providerMessage: sanitizeProviderText(provider.error_user_msg || provider.message, 180),
  };
}

async function sendStaffAuthTemplate(destination, code, options = {}) {
  assertNonAuthMetaAllowed();
  const env = options.env || process.env;
  const log = options.log || logger;
  const post = options.post || axios.post.bind(axios);
  const assertAllowed = options.assertAllowed || assertTemplateSendAllowed;
  const to = String(destination || '').replace(/\D/g, '');
  const challenge = String(code || '').trim().toUpperCase();

  if (!/^\d{10,15}$/.test(to) || !CHALLENGE_PATTERN.test(challenge)) {
    throw new Error('invalid staff authentication template payload');
  }
  if (!env.PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN) {
    throw new Error('staff authentication WhatsApp provider configuration unavailable');
  }

  await assertAllowed(STAFF_AUTH_TEMPLATE_NAME, STAFF_AUTH_TEMPLATE_LANGUAGE);

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: STAFF_AUTH_TEMPLATE_NAME,
      language: { code: STAFF_AUTH_TEMPLATE_LANGUAGE },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: challenge }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: challenge }],
        },
      ],
    },
  };

  try {
    const response = await post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${env.PHONE_NUMBER_ID}/messages`,
      body,
      {
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    const messageId = sanitizeProviderText(response?.data?.messages?.[0]?.id, 250);
    log.info({ messageId, templateName: STAFF_AUTH_TEMPLATE_NAME }, 'Staff authentication WhatsApp template accepted');
    return response?.data;
  } catch (error) {
    log.error(sanitizedMetaFailure(error), 'Staff authentication WhatsApp template rejected');
    const failure = new Error('staff authentication WhatsApp provider rejected template delivery');
    failure.code = 'STAFF_AUTH_PROVIDER_REJECTED';
    throw failure;
  }
}

module.exports = {
  CHALLENGE_PATTERN,
  sanitizedMetaFailure,
  sendStaffAuthTemplate,
};
