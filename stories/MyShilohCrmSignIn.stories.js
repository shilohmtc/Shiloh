import presentation from '../src/presentation/myShilohPwa.js';
const { renderMyShilohPage } = presentation;
function surface(signed = false, retired = false, available = false) {
  const html = renderMyShilohPage({
    crmAvailable: true,
    detailsRetired: retired,
    codeAvailable: available,
    smsAvailable: true,
    passkeysAvailable: true,
    whatsappNumber: '27830000000',
    client: signed ? { id: 900001, name: 'Synthetic Example', firstName: 'Synthetic' } : null,
    signInMethod: signed ? 'crm_details' : null,
    now: new Date('2026-10-09T06:00:00Z'),
  });
  const root = document.createElement('div');
  root.innerHTML =
    '<link rel="stylesheet" href="/my-shiloh/assets/app.css">' +
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  root.querySelector('[data-app-frame]').hidden = false;
  return root;
}
export default {
  title: 'Client/CRM detail sign-in',
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};
export const SignIn = { render: () => surface() };
export const LowerAssuranceProfile = { render: () => surface(true) };

export const RetiredDetails = { render: () => surface(false,true,true) };
export const CodeUnavailable = { render: () => surface(false,true,false) };
export const RetiredSignedIn = { render: () => surface(true,true,true) };
