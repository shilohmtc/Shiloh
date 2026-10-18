import presentation from '../src/presentation/workspaceWhatsAppUx.js';
export default { title:'Workspace/WhatsApp authentication draft' };
function render(admin=false,smsFallback=false,recoveryEnabled=true) {
  const html=presentation.workspaceWhatsAppPage({admin,smsFallback,recoveryEnabled});
  return `<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body>([\s\S]*?)<\/body>/)[1]}`;
}
export const SignIn={render:()=>render()};
export const BoundedStaffPilot={render:()=>render(false,false,false)};
export const AdministratorApproval={render:()=>render(true)};

export const SmsFallbackEnabled={render:()=>render(false,true).replace('id="verify" hidden','id="verify"').replace('id="sms-fallback" hidden','id="sms-fallback"')};

import client from '../src/presentation/clientCodeUx.js';
import invitation from '../src/presentation/authInvitations.js';
const documentBody=html=>`<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body>([\s\S]*?)<\/body>/)[1]}`;
export const ClientCodeSignIn={render:()=>documentBody(client.clientCodePage({sms:true}))};
export const ClientRegistration={render:()=>documentBody(client.clientCodePage({sms:true})).replace('id="profile" hidden','id="profile"')};
export const OptionalInvitations={render:()=>documentBody(invitation.authInvitationPage({audience:'staff',base:'/calendar/staff-auth/whatsapp'})).replace('id="passkey-invite" hidden','id="passkey-invite"').replace('id="notification-invite" hidden','id="notification-invite"')};

// Same enrollment form after the production /enroll script selects own-account setup.
export const OwnAccountPasskeySetup={render:()=>render(false,false,false)
  .replace('<option value="enroll">','<option value="enroll" selected>')
  .replace('<label for="mobile">','<label for="mobile" hidden>')
  .replace('id="mobile" name="mobile"','id="mobile" hidden name="mobile"')
  .replace('id="setup-help" hidden','id="setup-help"')};
