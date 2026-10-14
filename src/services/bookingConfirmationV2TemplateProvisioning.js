const definitions = require('../messageDefinitions/bookingConfirmationV2');
const { TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_HEADER, TEMPLATE_BODY, TEMPLATE_FOOTER, TEMPLATE_BUTTONS, buildBookingConfirmationV2TemplateDefinition, semanticButton, semanticComponents, providerContractMatches, renderBookingConfirmationV2Body } = definitions;
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
  let url = graphUrl(`${wabaId}/message_templates`);
  let params = { fields: 'id,name,status,category,language,components', limit: 100 };
  const templates = [];
  do {
    const response = await axios.get(url, { ...graphConfig(), params });
    templates.push(...(response.data?.data || []));
    url = response.data?.paging?.next || null;
    params = undefined;
  } while (url);
  return templates;
}

function sanitizeTemplate(template, duplicateCount = 0) {
  if (!template) return null;
  return {
    name: template.name || null,
    status: template.status || null,
    category: template.category || null,
    language: template.language || null,
    duplicateCount,
    exact: providerContractMatches(template),
    components: semanticComponents(template.components),
  };
}

async function getBookingConfirmationV2TemplateStatus() {
  const wabaId = await discoverWabaId();
  if (!wabaId) return { ok: false, reason: 'waba_not_discovered', templateName: TEMPLATE_NAME };

  const templates = await listTemplates(wabaId);
  const variants = templates
    .filter((item) => item?.name === TEMPLATE_NAME && item?.language === TEMPLATE_LANGUAGE)
    .sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
  const duplicateCount = Math.max(variants.length - 1, 0);
  return {
    ok: true,
    wabaId,
    templateName: TEMPLATE_NAME,
    template: sanitizeTemplate(variants[0] || null, duplicateCount),
    duplicateCount,
    definition: buildBookingConfirmationV2TemplateDefinition(),
  };
}

module.exports = { ...definitions, getBookingConfirmationV2TemplateStatus };
