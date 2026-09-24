'use strict';

const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');
const { buildPaymentTemplateDefinition } = require('./paymentTemplateDefinitions');

const GRAPH_VERSION = 'v23.0';
const TEMPLATE_KEY = 'payment_deposit_request_v2';
const TEMPLATE_NAME = 'shiloh_payment_deposit_request_v2';

function graphUrl(path) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${String(path).replace(/^\//, '')}`;
}

function graphConfig() {
  return {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  };
}

async function listProviderTemplates(wabaId) {
  const response = await axios.get(graphUrl(`${wabaId}/message_templates`), {
    ...graphConfig(),
    params: { fields: 'id,name,status,category,language,components', limit: 250 },
  });
  return response.data?.data || [];
}

async function ensurePaymentDepositTemplateV2() {
  const wabaId = await discoverWabaId();
  if (!wabaId) return { ok: false, submitted: false, reason: 'waba_not_discovered', provider: null };
  const templates = await listProviderTemplates(wabaId);
  const existing = templates.find(item => item?.name === TEMPLATE_NAME && item?.language === 'en') || null;
  if (existing) {
    return {
      ok: true,
      submitted: false,
      reason: 'already_exists',
      provider: {
        id: existing.id || null,
        name: existing.name,
        status: existing.status || null,
        category: existing.category || null,
        language: existing.language || null,
      },
    };
  }

  const response = await axios.post(
    graphUrl(`${wabaId}/message_templates`),
    buildPaymentTemplateDefinition(TEMPLATE_KEY),
    graphConfig(),
  );
  return {
    ok: true,
    submitted: true,
    reason: 'submitted',
    provider: {
      id: response.data?.id || null,
      name: TEMPLATE_NAME,
      status: response.data?.status || 'PENDING',
      category: 'UTILITY',
      language: 'en',
    },
  };
}

module.exports = {
  GRAPH_VERSION,
  TEMPLATE_KEY,
  TEMPLATE_NAME,
  graphUrl,
  ensurePaymentDepositTemplateV2,
};
