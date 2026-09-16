const COPY = Object.freeze({
  success: {
    title: 'Payment response received',
    body: 'Ozow has returned you to Shiloh. The payment will only be marked received after Shiloh verifies Ozow’s server notification.',
  },
  cancelled: {
    title: 'Payment cancelled',
    body: 'No payment was marked received. You can close this window and try again when you are ready.',
  },
  error: {
    title: 'Payment could not be completed',
    body: 'Ozow returned an error. No payment was marked received. Please return to Shiloh and try again or use another payment method.',
  },
});

function renderPaymentReturnPage({ status = 'success', returnPath = '/' } = {}) {
  const copy = COPY[status] || COPY.error;
  const safeReturnPath = /^\/calendar\/payments\/appointments\/\d+$/.test(String(returnPath)) ? String(returnPath) : '/';
  const returnLabel = safeReturnPath === '/' ? 'Return to Shiloh' : 'Return to booking payment';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title} — Shiloh</title><style>body{margin:0;background:#f5f3ed;color:#173126;font-family:Inter,system-ui,-apple-system,sans-serif}.card{max-width:620px;margin:12vh auto;padding:32px;border:1px solid #d7dfd9;border-radius:16px;background:#fffdf9;box-shadow:0 12px 30px #17312612}p{line-height:1.55;color:#4e6259}a{display:inline-flex;margin-top:12px;padding:12px 16px;border-radius:9px;background:#285642;color:#fff;text-decoration:none;font-weight:800}</style></head><body><main class="card"><p>SHILOH PAYMENT</p><h1>${copy.title}</h1><p>${copy.body}</p><a href="${safeReturnPath}">${returnLabel}</a></main></body></html>`;
}

module.exports = { renderPaymentReturnPage };
