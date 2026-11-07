import recovery from '../src/presentation/myShilohVoucherRecovery.js';

export default { title: 'My Shiloh/Voucher recovery', parameters: { layout: 'fullscreen' } };
function page(options) {
  const documentPage = new DOMParser().parseFromString(recovery.renderMyShilohVoucherRecovery(options), 'text/html');
  const root = document.createElement('div');
  for (const style of documentPage.querySelectorAll('style')) root.append(style.cloneNode(true));
  root.insertAdjacentHTML('beforeend', documentPage.body.innerHTML);
  return root;
}
export const VerificationAvailable = { render: () => page({ verificationAvailable: true }) };
export const VerificationUnavailable = { render: () => page({ verificationAvailable: false }) };
export const InvalidMobile = { render: () => page({ invalidMobile: true, verificationAvailable: true }) };
