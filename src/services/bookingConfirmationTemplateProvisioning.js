const definitions = require('../messageDefinitions/bookingConfirmation');
const { TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, buildBookingConfirmationTemplateDefinition } = definitions;
const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');

const GRAPH_VERSION = 'v23.0';

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

async function listTemplates(wabaId) {
  const response = await axios.get(graphUrl(`${wabaId}/message_templates`), {
    ...graphConfig(),
    params: { fields: 'id,name,status,category,language,components', limit: 250 },
  });
  return response.data;
}

function sanitizeTemplate(template) {
  if (!template) return null;
  return {
    id: template.id || null,
    name: template.name || null,
    status: template.status || null,
    category: template.category || null,
    language: template.language || null,
  };
}

async function getBookingConfirmationTemplateStatus() {
  const wabaId = await discoverWabaId();
  if (!wabaId) {
    return {
      ok: false,
      reason: 'waba_not_discovered',
      templateName: TEMPLATE_NAME,
      configuredTemplateName: process.env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE || null,
    };
  }

  const templates = await listTemplates(wabaId);
  const target = (templates?.data || []).find((item) => item?.name === TEMPLATE_NAME) || null;
  return {
    ok: true,
    wabaId,
    templateName: TEMPLATE_NAME,
    configuredTemplateName: process.env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE || null,
    template: sanitizeTemplate(target),
    definition: buildBookingConfirmationTemplateDefinition(),
  };
}

module.exports = { ...definitions, getBookingConfirmationTemplateStatus };
