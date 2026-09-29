const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accessStepMarkup,
  decorateStaffListOnboardingHtml,
  workspaceStaffOnboardingClientScript,
} = require('../src/presentation/workspaceStaffOnboardingUx');

function baseCreateHtml() {
  return '<!doctype html><html><head></head><body><section class="panel create-panel" data-staff-management><span class="eyebrow">Staff profile</span><h2>Add staff profile</h2><p class="status-message" data-staff-operation-status></p><form data-staff-create-form><div class="create-grid"><button class="button primary" type="submit">Add staff</button></div></form><p class="footer-note">Adds the staff profile only. It does not create Workspace access, sign-in setup or service assignments.</p></section></body></html>';
}

test('#802 guided onboarding decorates only authorized Staff creation and preserves Phone touch sizing', () => {
  const html = decorateStaffListOnboardingHtml(baseCreateHtml(), {
    manageAllowed: true,
    accessManageAllowed: true,
  });

  assert.match(html, /data-staff-onboarding-form/);
  assert.doesNotMatch(html, /data-staff-create-form/);
  assert.match(html, /<h2>Add staff<\/h2>/);
  assert.match(html, /Workspace access/);
  assert.match(html, /Practitioner access/);
  assert.match(html, /Staff WhatsApp mobile/);
  assert.match(html, /I verified this is the new staff member’s current WhatsApp number/);
  assert.match(html, /data-onboarding-identity hidden/);
  assert.match(html, /\[data-onboarding-identity\]\[hidden\]\{display:none!important\}/);
  assert.match(html, /Workspace → Services/);
  assert.match(html, /\/calendar\/team\/onboarding\.js/);
  assert.match(html, /min-height:44px/);
  assert.doesNotMatch(html, /appointment:view|staff_access:manage|staff_admin_accounts/);
});

test('#802 does not expose access identity controls without canonical access-management authority', () => {
  const html = decorateStaffListOnboardingHtml(baseCreateHtml(), {
    manageAllowed: true,
    accessManageAllowed: false,
  });

  assert.match(html, /data-onboarding-access-unavailable/);
  assert.match(html, /operator with Staff access authority/);
  assert.doesNotMatch(html, /name="whatsappNumber"/);
  assert.doesNotMatch(html, /name="workspaceAccess"/);
});

test('#802 does not decorate a view-only Staff page', () => {
  const source = baseCreateHtml();
  assert.equal(decorateStaffListOnboardingHtml(source, {
    manageAllowed: false,
    accessManageAllowed: true,
  }), source);
});

test('#802 access step uses human presets rather than a capability matrix', () => {
  const html = accessStepMarkup(true);
  assert.match(html, /No Workspace access/);
  assert.match(html, /Practitioner access/);
  assert.doesNotMatch(html, /capability|appointment:view|booking:update|schedule:manage/);
});

test('#802 client composes existing Staff create and Access enable mutations with independent request ids and returned revision', () => {
  const script = workspaceStaffOnboardingClientScript();

  assert.match(script, /post\('\/create'/);
  assert.match(script, /created\.staffId\+'\/access\/enable'/);
  assert.match(script, /expectedRevision:created\.revision/);
  assert.match(script, /requestId:requestId\(\)/);
  assert.match(script, /identityConfirmed:true/);
  assert.match(script, /The Staff profile was created, but Workspace access was not enabled/);
  assert.match(script, /Open staff profile/);
  assert.doesNotMatch(script, /\/access\/policy|workspace-access\/.*preset|device-signin-setup/);
});

test('#802 Ready guidance directs staff to administrator-approved SMS setup', () => {
  const script = workspaceStaffOnboardingClientScript();
  assert.match(script, /Open Staff access for this person/);
  assert.match(script, /sends an SMS setup code/);
  assert.match(script, /private setup link/);
  assert.match(script, /recorded mobile/);
  assert.doesNotMatch(script, /TOTP secret|recovery code|passkey private|setupUrl/);
});
