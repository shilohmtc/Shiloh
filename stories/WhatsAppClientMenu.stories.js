import discovery from '../src/presentation/whatsappClientMenu.js';

const { clientHomeInteractive, welcomeVoucherReply } = discovery;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function messageMarkup(body) {
  return escapeHtml(body)
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function phoneFrame(content) {
  return `<style>
    *{box-sizing:border-box}body{margin:0;background:#0b141a;color:#e9edef;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wa-story{width:390px;max-width:100%;min-height:760px;padding:72px 14px 28px;background:radial-gradient(circle at 20% 15%,rgba(0,168,132,.08),transparent 34%),#0b141a}.wa-bubble{width:min(310px,92%);overflow:hidden;border-radius:0 14px 14px;background:#202c33;box-shadow:0 1px 1px rgba(0,0,0,.2)}.wa-copy{padding:12px 13px 9px;font-size:.94rem;line-height:1.45}.wa-actions{border-top:1px solid #39454c}.wa-action{display:grid;place-items:center;width:100%;min-height:48px;padding:9px 12px;border:0;border-bottom:1px solid #39454c;background:transparent;color:#00a884;font:inherit;font-weight:650}.wa-action:last-child{border-bottom:0}.wa-link{color:#53bdeb;overflow-wrap:anywhere}
  </style><main class="wa-story" aria-label="WhatsApp preview">${content}</main>`;
}

export default {
  title: 'WhatsApp/Client menu',
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' } },
};

export const WelcomeVoucherFirst = {
  render: () => {
    const menu = clientHomeInteractive();
    return phoneFrame(`<section class="wa-bubble" aria-label="Shiloh client menu"><div class="wa-copy">${messageMarkup(menu.body)}</div><div class="wa-actions">${menu.buttons.map((button) => `<button class="wa-action" type="button" data-action="${escapeHtml(button.id)}">${escapeHtml(button.title)}</button>`).join('')}</div></section>`);
  },
};

export const WelcomeVoucherReply = {
  render: () => phoneFrame(`<section class="wa-bubble" aria-label="My Shiloh welcome voucher"><div class="wa-copy">${messageMarkup(welcomeVoucherReply()).replace(/(https:\/\/[^<]+)/, '<span class="wa-link">$1</span>')}</div></section>`),
};
