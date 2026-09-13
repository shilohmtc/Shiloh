const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');
const { TEMPLATE_NAME: REMINDER_TEMPLATE_NAME, buildReminderActionTemplateDefinition } = require('./reminderActionTemplateProvisioning');

const GRAPH_VERSION = 'v23.0';
const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'UTILITY';
const DEFINITIONS = Object.freeze({
  reminder_actions: { name: REMINDER_TEMPLATE_NAME, env: 'WHATSAPP_REMINDER_ACTIONS_TEMPLATE', build: buildReminderActionTemplateDefinition },
  reschedule_confirmation: { name: 'shiloh_reschedule_confirmation_v1', env: 'WHATSAPP_RESCHEDULE_CONFIRMATION_TEMPLATE', body: 'Hi {{1}}, your Shiloh appointment has been rescheduled. 🌿\n\n✨ Service: {{2}}\n👤 With: {{3}}\n📅 New date: {{4}}\n🕐 New time: {{5}}\n\nReply RESCHEDULE or CANCEL if you need another change.', example: [['Christel', 'HIFU', 'Marietjie', 'Friday, 21 August 2026', '10:00']] },
  reschedule_approval_request: { name: 'shiloh_reschedule_approval_request_v1', env: 'WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE', body: 'Reschedule approval required.\n\nClient: {{1}}\nTreatment: {{2}}\nCurrent appointment: {{3}}\nRequested change: {{4}}\nBooking #{{5}}\n\nThe client’s current appointment remains unchanged unless you approve this request.', example: [['Juvan Botha', 'Sports Massage', 'Thu, 20 Aug 2026, 14:00', 'Fri, 21 Aug 2026, 15:00', '576']], buttons: ['Approve', 'Decline'] },
  reschedule_declined: { name: 'shiloh_reschedule_declined_v1', env: 'WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE', body: 'Hi {{1}}, your requested appointment change was not approved.\n\n✨ Service: {{2}}\n📅 Requested: {{3}}\n✅ Current appointment: {{4}}\nBooking #{{5}}\n\nYour current appointment remains unchanged. You can choose another available time whenever you are ready. 🌿', example: [['Juvan Botha', 'Sports Massage', 'Fri, 21 Aug 2026, 15:00', 'Thu, 20 Aug 2026, 14:00', '576']], buttons: ['Choose another time'] },
  cancellation_confirmation: { name: 'shiloh_cancellation_confirmation_v1', env: 'WHATSAPP_CANCELLATION_CONFIRMATION_TEMPLATE', body: 'Hi {{1}}, your Shiloh appointment has been cancelled.\n\n✨ Service: {{2}}\n📅 Date: {{3}}\n🕐 Time: {{4}}\nBooking #{{5}}\n\nReply BOOK if you would like to make another appointment. 🌿', example: [['Christel', 'HIFU', 'Friday, 21 August 2026', '10:00', '567']] },
  booking_update: { name: 'shiloh_booking_update_v1', env: 'WHATSAPP_BOOKING_UPDATE_TEMPLATE', body: 'Hi {{1}}, your Shiloh appointment has been updated. 🌿\n\n✨ Service: {{2}}\n👤 With: {{3}}\n📅 Date: {{4}}\n🕐 Time: {{5}}\n💰 Booked price: {{6}}\nBooking #{{7}}\n\nThis is your latest confirmation. Reply RESCHEDULE or CANCEL if you need another change.', example: [['Christel', 'Sports Massage — Package Session', 'Christel', 'Friday, 21 August 2026', '14:30–15:20', 'R0.00', '570']] },
  booking_approval_request: { lifecycle: 'retired', name: 'shiloh_booking_approval_request_v1', env: null, body: 'Booking approval required.\n\nClient: {{1}}\nTreatment: {{2}}\nWith: {{3}}\nTime: {{4}}\nBooking #{{5}}\n\nThis time is being held until an authorized approver approves or declines the request.', example: [['Pa Derik', 'MediHeel Pedicure', 'Christel', 'Friday, 21 August 2026 at 10:00', '567']], buttons: ['Approve', 'Decline'] },
  booking_declined: { name: 'shiloh_booking_declined_v1', env: 'WHATSAPP_BOOKING_DECLINED_TEMPLATE', body: 'Hi {{1}}, your Shiloh booking request could not be confirmed.\n\n✨ Service: {{2}}\n📅 Requested time: {{3}}\nBooking #{{4}}\n\nThe held time has been released and nothing is booked. You can choose another available time whenever you are ready. 🌿', example: [['Pa Derik', 'MediHeel Pedicure', 'Friday, 21 August 2026 at 10:00', '567']], buttons: ['Book another time'] },
  booking_approval_outcome: { lifecycle: 'retired', name: 'shiloh_booking_approval_outcome_v1', env: null, body: 'Booking request update.\n\n{{1}} — {{2}} — {{3}}\n{{4}} has {{5}} the request.\nBooking #{{6}}\n\nThe first valid decision is final for this request.', example: [['Client Name', 'Treatment', 'Friday, 21 August 2026 at 10:00', 'Christel', 'approved', '567']] },
  appointment_followup_actions: { name: 'shiloh_appointment_followup_v2', env: 'WHATSAPP_FOLLOWUP_ACTIONS_TEMPLATE', body: 'Hi {{1}}, thank you for visiting Shiloh for {{2}}. 🌿\n\nHow was your experience? Please choose a rating from 1 to 5 below.', example: [['Christel', 'Swedish Massage']], buttons: ['1', '2', '3', '4', '5'] },
});
function graphUrl(path) { return `https://graph.facebook.com/${GRAPH_VERSION}/${String(path).replace(/^\//, '')}`; }
function graphConfig() { return { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 15000 }; }
function buildDefinition(key) {
  const item = DEFINITIONS[key]; if (!item) throw new Error(`Unknown lifecycle template: ${key}`);
  if (typeof item.build === 'function') return item.build();
  const components = [{ type: 'BODY', text: item.body, example: { body_text: item.example } }];
  if (item.buttons) components.push({ type: 'BUTTONS', buttons: item.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) });
  return { name: item.name, language: TEMPLATE_LANGUAGE, category: TEMPLATE_CATEGORY, components };
}
function sanitize(template) { return template ? { id: template.id || null, name: template.name || null, status: template.status || null, category: template.category || null, language: template.language || null } : null; }
function isSafeToEnable(provider, configuredTemplateName, expectedTemplateName) { return Boolean(provider && provider.status === 'APPROVED' && provider.name === expectedTemplateName && configuredTemplateName === expectedTemplateName); }
async function listProviderTemplates(wabaId) { const response = await axios.get(graphUrl(`${wabaId}/message_templates`), { ...graphConfig(), params: { fields: 'id,name,status,category,language,components', limit: 250 } }); return response.data?.data || []; }
async function getClientLifecycleTemplateStatus() {
  const wabaId = await discoverWabaId(); if (!wabaId) return { ok: false, reason: 'waba_not_discovered', templates: [] };
  const providerTemplates = await listProviderTemplates(wabaId);
  const templates = Object.entries(DEFINITIONS).map(([key, item]) => { const provider = sanitize(providerTemplates.find((candidate) => candidate?.name === item.name) || null); const configuredTemplateName = item.env ? process.env[item.env] || null : null; const lifecycle = item.lifecycle || 'current'; return { key, lifecycle, templateName: item.name, configuredTemplateName, provider, safeToEnable: lifecycle === 'current' && isSafeToEnable(provider, configuredTemplateName, item.name), definition: buildDefinition(key) }; });
  return { ok: true, wabaId, templates };
}
async function submitClientLifecycleTemplate(key) {
  const item = DEFINITIONS[key]; if (!item) throw new Error(`Unknown lifecycle template: ${key}`);
  if (item.lifecycle === 'retired') throw new Error(`Retired lifecycle template cannot be submitted: ${key}`);
  const status = await getClientLifecycleTemplateStatus(); if (!status.ok) return status;
  const existing = status.templates.find((template) => template.key === key)?.provider;
  if (existing) return { ...status, key, submitted: false, reason: 'already_exists', provider: existing };
  const response = await axios.post(graphUrl(`${status.wabaId}/message_templates`), buildDefinition(key), graphConfig());
  return { ok: true, wabaId: status.wabaId, key, templateName: item.name, submitted: true, provider: { id: response.data?.id || null, status: response.data?.status || null, category: response.data?.category || TEMPLATE_CATEGORY } };
}
module.exports = { DEFINITIONS, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, buildDefinition, isSafeToEnable, getClientLifecycleTemplateStatus, submitClientLifecycleTemplate };
