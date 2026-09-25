import presentation from '../src/presentation/staffPasskeyBootstrapUx.js';

const { bootstrapPage } = presentation;

function productionSurface(html, { stalled = false } = {}) {
  const styles = [...String(html).matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  let body = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  body = body.replace(/<script[\s\S]*?<\/script>/g, '');
  if (stalled) {
    body = body
      .replace('data-bootstrap-choices>', 'data-bootstrap-choices hidden>')
      .replace('class="status"', 'class="status show error"')
      .replace('data-bootstrap-status></div>', 'data-bootstrap-status>Android did not finish device verification. Close any passkey prompt, then tap Try again. If this phone was already set up for Shiloh, open sign-in instead.</div>')
      .replace('class="action" type="button" data-bootstrap-retry', 'class="action show" type="button" data-bootstrap-retry')
      .replace('class="action secondary" type="button" data-bootstrap-signin', 'class="action secondary show" type="button" data-bootstrap-signin');
  }
  return `<style>${styles}.passkey-bootstrap-story{min-height:100vh}</style><div class="passkey-bootstrap-story" data-passkey-bootstrap-story>${body}</div>`;
}

export default {
  title: 'Staff/Passkey bootstrap',
  parameters: { layout:'fullscreen', a11y:{ test:'error' } },
};

export const ChooseSetupMode = {
  render: () => productionSurface(bootstrapPage()),
};

export const AndroidVerificationStalled = {
  render: () => productionSurface(bootstrapPage(), { stalled:true }),
};
