const TEMPLATE_NAME = 'shiloh_workspace_booking_request_alert_v1';
const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_BODY = `Hi {{1}}, a new booking request is waiting in Shiloh Workspace. 🌿\n\n{{2}} request(s) currently need attention.\n\nOpen Workspace to review and respond.`;
const TEMPLATE_BUTTONS = Object.freeze(['Open Workspace']);

function buildWorkspaceBookingRequestAlertTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: { body_text: [['Christel', '3']] },
      },
      {
        type: 'BUTTONS',
        buttons: TEMPLATE_BUTTONS.map((text) => ({ type: 'QUICK_REPLY', text })),
      },
    ],
  };
}

function semanticButton(button = {}) {
  return { type: String(button.type || '').toUpperCase(), text: button.text ?? null };
}

function semanticComponents(components = []) {
  return (Array.isArray(components) ? components : []).map((component) => {
    const normalized = { type: String(component.type || '').toUpperCase() };
    if (component.format != null) normalized.format = String(component.format).toUpperCase();
    if (component.text != null) normalized.text = component.text;
    if (Array.isArray(component.buttons)) normalized.buttons = component.buttons.map(semanticButton);
    return normalized;
  });
}

function providerContractMatches(provider) {
  const expected = buildWorkspaceBookingRequestAlertTemplateDefinition();
  return Boolean(
    provider?.name === expected.name
    && provider?.language === expected.language
    && String(provider?.category || '').toUpperCase() === expected.category
    && JSON.stringify(semanticComponents(provider?.components)) === JSON.stringify(semanticComponents(expected.components))
  );
}

// Historical definition and comparison remain read-only evidence.
module.exports = {
  TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, TEMPLATE_BUTTONS,
  buildWorkspaceBookingRequestAlertTemplateDefinition, providerContractMatches,
};
