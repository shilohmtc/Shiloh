'use strict';

const { pageStyles } = require('./clientConsultationFormUx');

function renderMyShilohVoucherRecovery({ invalidMobile = false, verificationAvailable = false } = {}) {
  const canVerify = invalidMobile !== true && verificationAvailable === true;
  const heading = invalidMobile ? 'Check your mobile details' : 'Verify your mobile to view vouchers';
  const message = invalidMobile
    ? 'We could not confirm a usable verified mobile number for your voucher wallet. Open your My Shiloh profile to check your details. If you still cannot continue, contact Reception.'
    : 'To protect your vouchers, your Shiloh profile needs to be active and its mobile number verified.';
  const recovery = invalidMobile
    ? '<a class="voucher-action" href="/my-shiloh/#profile">Open Profile</a>'
    : canVerify
      ? '<p>Verify the mobile number on your profile using WhatsApp, then return to Gift vouchers. You choose whether to request a code on the next page.</p><a class="voucher-action voucher-action--primary" href="/my-shiloh/code-auth/">Verify with WhatsApp</a>'
      : '<p>WhatsApp verification is not available right now. Return to My Shiloh and try again later, or contact Reception for help.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Gift vouchers — My Shiloh</title><style>${pageStyles()}
    .voucher-recovery{max-width:580px;margin-inline:auto}.voucher-recovery p+p{margin-top:12px}.voucher-action{display:flex;align-items:center;justify-content:center;min-height:48px;margin:16px auto 0;padding:12px 18px;max-width:330px;border:1px solid var(--line-strong);border-radius:12px;background:var(--panel);color:var(--leaf-deep);font-weight:800;text-decoration:none}.voucher-action--primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.voucher-action:focus-visible{outline:3px solid var(--leaf);outline-offset:4px}
    </style></head><body><main class="page"><header class="brand"><div class="brand-mark"><span class="brand-dot" aria-hidden="true">S</span><span>Shiloh</span></div><span class="secure-note">My Shiloh</span></header><section class="unavailable voucher-recovery" data-voucher-recovery><h1>${heading}</h1><p>${message}</p>${recovery}<a class="voucher-action" href="/my-shiloh/">Back to My Shiloh</a></section></main></body></html>`;
}

module.exports = { renderMyShilohVoucherRecovery };
