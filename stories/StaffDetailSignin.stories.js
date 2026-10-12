import accessUx from '../src/presentation/staffCalendarAccessUx.js';
import detailUx from '../src/presentation/staffDetailSigninUx.js';
import passkeyUx from '../src/presentation/staffPasskeyUx.js';
function surface(setup = false) {
  const html = setup
    ? detailUx.setupPage(
        {
          targetId: 900001,
          displayName: 'Synthetic Example',
          revision: 'a'.repeat(64),
          mobile: '27820000001',
        },
        accessUx.styles(),
      )
    : accessUx
        .renderStaffCalendarAccessPage()
        .replace('<main class="card">', `<main class="card">${detailUx.signinPanel()}`)
        .replace(
          /<section class="section" data-shiloh-whatsapp-handoff-guidance>[\s\S]*?<\/section>/,
          passkeyUx.signinPanel().replace('Continue with device sign-in', 'Use a saved passkey'),
        )
        .replace('Use your saved Shiloh passkey to continue.', '');
  return (
    `<style>${[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')}</style>` +
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '')
  );
}
export default {
  title: 'Staff/Detail sign-in',
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};
export const SignIn = { render: () => surface() };
export const AccountSetup = { render: () => surface(true) };
