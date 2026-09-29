const axios = require('axios');

const GRAPH_VERSION = 'v23.0';
const LEGACY_TEMPLATE_NAME = 'shiloh_birthday_wish_v1';
const TEMPLATE_NAME = 'shiloh_birthday_wish_v2';
const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'MARKETING';
const TEMPLATE_BODY = 'Happy birthday, {{1}}! 🎂 Wishing you a beautiful day from all of us at Shiloh Massage Therapy and Aesthetic Clinic. Thank you for being part of our community. 🌿';
const TEMPLATE_FOOTER = 'Reply BIRTHDAY OFF any time to stop birthday wishes.';

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

function buildBirthdayTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: { body_text: [['Christel']] },
      },
      {
        type: 'FOOTER',
        text: TEMPLATE_FOOTER,
      },
    ],
  };
}

async function getJson(path, params) {
  const response = await axios.get(graphUrl(path), { ...graphConfig(), params });
  return response.data;
}

async function discoverFromPhoneNumberField(phoneNumberId) {
  try {
    const data = await getJson(phoneNumberId, { fields: 'id,whatsapp_business_account' });
    const wabaId = data?.whatsapp_business_account?.id || data?.whatsapp_business_account;
    return wabaId ? String(wabaId) : null;
  } catch (_) {
    return null;
  }
}

async function discoverBusinessIds() {
  const ids = [];
  try {
    const me = await getJson('me', { fields: 'id,business' });
    if (me?.business?.id) ids.push(String(me.business.id));
  } catch (_) {}
  try {
    const businesses = await getJson('me/businesses', { fields: 'id,name' });
    for (const business of businesses?.data || []) if (business?.id) ids.push(String(business.id));
  } catch (_) {}
  return [...new Set(ids)];
}

async function findWabaContainingPhone(businessId, edge, phoneNumberId) {
  try {
    const wabas = await getJson(`${businessId}/${edge}`, { fields: 'id,name' });
    for (const waba of wabas?.data || []) {
      if (!waba?.id) continue;
      try {
        const phones = await getJson(`${waba.id}/phone_numbers`, { fields: 'id,display_phone_number,verified_name' });
        if ((phones?.data || []).some((phone) => String(phone.id) === String(phoneNumberId))) return String(waba.id);
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

async function discoverWabaId() {
  if (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) return String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  if (!phoneNumberId) throw new Error('PHONE_NUMBER_ID is not configured');
  if (!process.env.WHATSAPP_TOKEN) throw new Error('WHATSAPP_TOKEN is not configured');

  const direct = await discoverFromPhoneNumberField(phoneNumberId);
  if (direct) return direct;

  const businessIds = await discoverBusinessIds();
  for (const businessId of businessIds) {
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      const wabaId = await findWabaContainingPhone(businessId, edge, phoneNumberId);
      if (wabaId) return wabaId;
    }
  }
  return null;
}

async function listTemplates(wabaId) {
  return getJson(`${wabaId}/message_templates`, {
    fields: 'id,name,status,category,language,components',
    limit: 250,
  });
}

function sanitizeTemplate(template) {
  if (!template) return null;
  return {
    id: template.id || null,
    name: template.name,
    status: template.status || null,
    category: template.category || null,
    language: template.language || null,
    components: template.components || [],
  };
}

async function getBirthdayTemplateStatus() {
  const wabaId = await discoverWabaId();
  if (!wabaId) {
    return {
      ok: false,
      reason: 'waba_not_discovered',
      templateName: TEMPLATE_NAME,
      legacyTemplateName: LEGACY_TEMPLATE_NAME,
      configuredTemplateName: null,
    };
  }
  const templates = await listTemplates(wabaId);
  const target = (templates?.data || []).find((item) => item?.name === TEMPLATE_NAME) || null;
  const legacy = (templates?.data || []).find((item) => item?.name === LEGACY_TEMPLATE_NAME) || null;
  return {
    ok: true,
    wabaId,
    templateName: TEMPLATE_NAME,
    legacyTemplateName: LEGACY_TEMPLATE_NAME,
    configuredTemplateName: null,
    template: sanitizeTemplate(target),
    legacyTemplate: sanitizeTemplate(legacy),
    definition: buildBirthdayTemplateDefinition(),
  };
}

module.exports = {
  LEGACY_TEMPLATE_NAME,
  TEMPLATE_NAME,
  TEMPLATE_LANGUAGE,
  TEMPLATE_CATEGORY,
  TEMPLATE_BODY,
  TEMPLATE_FOOTER,
  buildBirthdayTemplateDefinition,
  discoverWabaId,
  getBirthdayTemplateStatus,
};
