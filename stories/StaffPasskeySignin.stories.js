import passkeyUx from '../src/presentation/staffPasskeyUx.js';

const { signinPanel } = passkeyUx;

function surface({ linked = false } = {}) {
  let panel = signinPanel();
  if (!linked) {
    panel = panel
      .replace('Continue with device sign-in', 'Use existing passkey')
      .replace('data-shiloh-passkey-status aria-live="polite" hidden></div>',
        'data-shiloh-passkey-status aria-live="polite" data-state="device-unlinked">This browser is not linked yet. If this phone already has a Shiloh passkey, tap Use existing passkey. If that does not work, use one fresh private setup link from Shiloh.</div>');
  }
  return `
  <style>
    :root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f7f5ef;--panel:#fffdf9;--line:#dfe5df;--leaf:#496b5a;--leaf-soft:#e7eee9}
    *{box-sizing:border-box}
    body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .signin-story{min-height:100vh;display:grid;place-items:center;padding:20px}
    .signin-card{width:min(520px,100%);padding:24px;border:1px solid var(--line);border-radius:20px;background:var(--panel);box-shadow:0 10px 34px rgba(32,50,43,.08)}
    .eyebrow{margin:0 0 6px;color:var(--muted);font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.12em}
    h1{margin:0 0 8px;font-size:1.7rem}
    .intro{margin:0;color:var(--muted);line-height:1.5}
    .actions{margin-top:20px}
    .button{width:100%;min-height:50px;border:1px solid var(--leaf);border-radius:999px;background:var(--leaf);color:#fff;font:inherit;font-weight:800;cursor:pointer}
    .status{margin-top:14px;padding:14px;border-radius:14px;background:var(--leaf-soft);color:#314f41;line-height:1.5}
    @media(max-width:560px){.signin-story{padding:12px}.signin-card{padding:20px 16px;border-radius:17px}}
  </style>
  <main class="signin-story" data-passkey-signin-story>
    <section class="signin-card">
      <p class="eyebrow">Shiloh Workspace</p>
      <h1 data-shiloh-passkey-heading>Secure staff sign-in</h1>
      <p class="intro">Use the passkey already saved on this phone. Shiloh still verifies the device before opening Workspace.</p>
      ${panel}
    </section>
  </main>`;
}

export default {
  title:'Staff/Passkey sign-in',
  parameters:{ layout:'fullscreen', a11y:{ test:'error' } },
};

export const BrowserHandoff = {
  render:() => surface({ linked:false }),
};

export const LinkedDevice = {
  render:() => surface({ linked:true }),
};
