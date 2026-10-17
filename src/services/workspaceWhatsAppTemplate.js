'use strict';

const { isDeepStrictEqual } = require('node:util');

const TEMPLATE_NAME = 'shiloh_workspace_verification';
const MAX_CODE_TTL_SECONDS = 300;

// No language or approved components are inferred from the owner-reported name.
// Both arguments must come from a reviewed contract and a fresh authenticated
// provider read. This module does not discover accounts or read credentials.
function inspectWorkspaceTemplate({ reviewed, inventory, wabaId } = {}) {
  const blocked = { ready: false, reason: 'template_not_verified' };
  if (!reviewed || !Array.isArray(inventory) || !wabaId || reviewed.wabaId !== wabaId ||
      reviewed.name !== TEMPLATE_NAME || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(reviewed.language || '') ||
      reviewed.category !== 'AUTHENTICATION' || !reviewed.id) return blocked;
  const matches = inventory.filter(item => item?.name === TEMPLATE_NAME && item.language === reviewed.language);
  if (matches.length !== 1) return blocked;
  const actual = matches[0];
  if (actual.status !== 'APPROVED' || actual.id !== reviewed.id || actual.category !== reviewed.category ||
      !isDeepStrictEqual(actual.components, reviewed.components) ||
      actual.message_send_ttl_seconds !== reviewed.message_send_ttl_seconds) return blocked;
  const components = actual.components;
  if (!Array.isArray(components) || components.some(c => !c || !['BODY', 'FOOTER', 'BUTTONS'].includes(c.type))) return blocked;
  const bodies = components.filter(c => c.type === 'BODY');
  const footers = components.filter(c => c.type === 'FOOTER');
  const groups = components.filter(c => c.type === 'BUTTONS');
  if (bodies.length !== 1 || footers.length > 1 || groups.length !== 1 ||
      !Array.isArray(groups[0].buttons) || groups[0].buttons.length !== 1) return blocked;
  const body = bodies[0];
  if (typeof body.text !== 'string' || (body.text.match(/\{\{[^}]+\}\}/g) || []).join(',') !== '{{1}}') return blocked;
  const button = groups[0].buttons[0];
  if (!button || button.otp_type !== 'COPY_CODE' || !['OTP', 'URL'].includes(button.type)) return blocked;
  if (button.type === 'URL' && button.url !== 'https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}') return blocked;
  const ttl = actual.message_send_ttl_seconds;
  const footerMinutes = footers[0]?.code_expiration_minutes;
  if ((ttl !== undefined && (!Number.isInteger(ttl) || ttl <= 0)) ||
      (footerMinutes !== undefined && (!Number.isInteger(footerMinutes) || footerMinutes <= 0))) return blocked;
  // Do not display an expiry longer than the application actually honors.
  if (footerMinutes !== undefined && footerMinutes * 60 > MAX_CODE_TTL_SECONDS) return blocked;
  const codeTtlSeconds = Math.min(MAX_CODE_TTL_SECONDS, ttl || MAX_CODE_TTL_SECONDS,
    (footerMinutes || MAX_CODE_TTL_SECONDS / 60) * 60);
  if (footerMinutes !== undefined && footerMinutes * 60 !== codeTtlSeconds) return blocked;
  return { ready: true, name: TEMPLATE_NAME, language: reviewed.language, codeTtlSeconds };
}

function buildWorkspaceOtpPayload({ template, mobile, code } = {}) {
  if (!template?.ready || template.name !== TEMPLATE_NAME || !template.language ||
      !/^27[6-8][0-9]{8}$/.test(mobile || '') || !/^[0-9]{6}$/.test(code || '')) {
    throw new Error('Workspace authentication payload is not ready');
  }
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: mobile, type: 'template',
    template: {
      name: TEMPLATE_NAME, language: { code: template.language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
}

// There is deliberately no built-in HTTP client, environment switch or secret
// lookup. A separately reviewed activation composition must supply the sender
// and authenticated inventory reader. Existing generic WhatsApp stays retired.
function createWorkspaceOtpDelivery({ enabled = false, reviewed = null, wabaId = null,
  readInventory = null, send = null } = {}) {
  const pin = reviewed ? structuredClone(reviewed) : null;
  const configured = () => enabled === true && !!pin && !!wabaId &&
    typeof readInventory === 'function' && typeof send === 'function';
  async function readiness() {
    if (!configured()) return { ready: false, reason: 'delivery_disabled' };
    try { return inspectWorkspaceTemplate({ reviewed: pin, wabaId, inventory: await readInventory() }); }
    catch (_) { return { ready: false, reason: 'template_not_verified' }; }
  }
  async function deliver({ mobile, code, codeTtlSeconds } = {}) {
    const template = await readiness();
    if (!template.ready || template.codeTtlSeconds !== codeTtlSeconds) return { ok: false, outcome: 'not_sent' };
    try {
      const result = await send(buildWorkspaceOtpPayload({ template, mobile, code }));
      const id = result?.messages?.[0]?.id;
      return typeof id === 'string' && /^wamid\.[A-Za-z0-9_+/=.:-]{1,250}$/.test(id)
        ? { ok: true, outcome: 'accepted', providerMessageId: id } : { ok: false, outcome: 'uncertain' };
    } catch (_) {
      // Provider exceptions may include the request, recipient, OTP or token.
      // Never return or log the raw exception; never retry an uncertain send.
      return { ok: false, outcome: 'uncertain' };
    }
  }
  return { configured, readiness, deliver };
}

module.exports = { TEMPLATE_NAME, inspectWorkspaceTemplate, buildWorkspaceOtpPayload, createWorkspaceOtpDelivery };
