const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');

const GRAPH_VERSION = 'v23.0';
const TEMPLATE_NAME = 'shiloh_booking_confirmation_v1';
const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_BODY = `Hi {{1}}, your Shiloh appointment is confirmed. 🌿

✨ Service: {{2}}
👤 With: {{3}}
📅 Date: {{4}}
🕐 Time: {{5}}

Add to calendar:
Google Calendar: {{6}}
Apple / Outlook / phone: {{7}}

Need to make a change? Reply RESCHEDULE or CANCEL.
We look forward to seeing you. 🌿`;

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

function buildBookingConfirmationTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: {
          body_text: [[
            'Christel',
            'HIFU',
            'Abigail',
            'Friday, 14 August 2026',
            '10:00–10:30',
            'https://calendar.google.com/calendar/render?example=1',
            'https://shiloh.example/calendar/example.ics',
          ]],
        },
      },
    ],
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

async function submitBookingConfirmationTemplate() {
  const status = await getBookingConfirmationTemplateStatus();
  if (!status.ok) return status;
  if (status.template) return { ...status, submitted: false, reason: 'already_exists' };

  const response = await axios.post(
    graphUrl(`${status.wabaId}/message_templates`),
    buildBookingConfirmationTemplateDefinition(),
    graphConfig()
  );

  return {
    ok: true,
    wabaId: status.wabaId,
    templateName: TEMPLATE_NAME,
    configuredTemplateName: status.configuredTemplateName,
    submitted: true,
    provider: {
      id: response.data?.id || null,
      status: response.data?.status || null,
      category: response.data?.category || TEMPLATE_CATEGORY,
    },
  };
}

module.exports = {
  TEMPLATE_NAME,
  TEMPLATE_LANGUAGE,
  TEMPLATE_CATEGORY,
  TEMPLATE_BODY,
  buildBookingConfirmationTemplateDefinition,
  getBookingConfirmationTemplateStatus,
  submitBookingConfirmationTemplate,
};
