import presentation from '../src/presentation/workspaceWhatsAppUx.js';
export default { title:'Workspace/WhatsApp authentication draft' };
function render(admin=false,smsFallback=false,recoveryEnabled=true,enrollment=false) {
  const html=presentation.workspaceWhatsAppPage({admin,smsFallback,recoveryEnabled,enrollment});
  return `<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body>([\s\S]*?)<\/body>/)[1]}`;
}
export const SignIn={render:()=>render()};
export const ActiveWorkspaceStaff={render:()=>render(false,false,false)};
export const BoundedStaffPilot={render:()=>render(false,false,false)};
export const AdministratorApproval={render:()=>render(true)};

export const SmsFallbackEnabled={render:()=>render(false,true).replace('id="verify" hidden','id="verify"').replace('id="sms-fallback" hidden','id="sms-fallback"')};

import client from '../src/presentation/clientCodeUx.js';
import invitation from '../src/presentation/authInvitations.js';
const documentBody=html=>`<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1]}`;
export const ClientCodeSignIn={render:()=>documentBody(client.clientCodePage({sms:true}))};
export const ClientRegistration={render:()=>documentBody(client.clientCodePage({sms:true})).replace('id="profile" hidden','id="profile"')};
export const OptionalInvitations={render:()=>documentBody(invitation.authInvitationPage({audience:'staff',base:'/calendar/staff-auth/whatsapp'})).replace('id="passkey-invite" hidden','id="passkey-invite"').replace('id="notification-invite" hidden','id="notification-invite"').replace('id="continue" hidden','id="continue"').replace('Opening Workspace…','These choices are optional. You can continue now.')};

// Protected own-account setup, reached from My passkeys after sign-in.
export const OwnAccountPasskeySetup={render:()=>render(false,false,false,true)};
export const OwnAccountVerificationNeeded={render:()=>render(false,false,false,true)
  .replace('id="status" role="status" aria-live="polite"></p>','id="status" role="status" aria-live="polite">Your recent verification is no longer available. Request a WhatsApp code to continue.</p>')
  .replace('id="send">Save a passkey','id="send">Send WhatsApp code')};

export const OpeningWorkspace={render:()=>documentBody(invitation.authInvitationPage({audience:'staff',base:'/calendar/staff-auth/whatsapp'}))};

export const ClientAccountHelp={render:()=>documentBody(client.clientCodePage())};

import setup from '../src/presentation/workspaceAccountSetup.js';
const setupStory=passkey=>`<style>${setup.workspaceAccountSetupStyles()}</style><main><h1>Workspace</h1>${setup.workspaceAccountSetupCard().replace('data-workspace-setup hidden','data-workspace-setup').replace('data-workspace-setup-passkey hidden',passkey?'data-workspace-setup-passkey':'data-workspace-setup-passkey hidden').replace('data-workspace-setup-notifications>',passkey?'data-workspace-setup-notifications hidden>':'data-workspace-setup-notifications>')
.replace('Optional notifications</p>',passkey?'Save a passkey</p>':'Optional notifications</p>').replace('Workspace notifications</h2>',passkey?'Make next time easier.</h2>':'Workspace notifications</h2>').replace('Get updates from Workspace on this device.</p>',passkey?'Save a passkey for quicker sign-in with your fingerprint, face or screen lock.</p>':'Get updates from Workspace on this device.</p>')}</main>`;
export const WorkspaceNotificationCard={render:()=>setupStory(false)};
export const WorkspacePasskeyCard={render:()=>setupStory(true)};

// Existing form reached only after fresh proof; no legacy records are displayed.
export const LegacyOnlyRegistration={render:()=>documentBody(client.clientCodePage())
  .replace('id="start"','id="start" hidden')
  .replace('id="profile" hidden','id="profile"')
  .replace('id="status" data-auth-status role="status" aria-live="polite"></p>','id="status" data-auth-status role="status" aria-live="polite">Number verified. Please complete your details.</p>')};
