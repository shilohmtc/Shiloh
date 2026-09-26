function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '\"':'&quot;' }[character]));
}

function renderPaymentStatusPage({ requestKey, request, whatsappNumber } = {}) {
  const state = String(request?.state || 'pending').toLowerCase();
  const paid = state === 'paid';
  const failed = ['failed', 'cancelled', 'expired', 'refunded'].includes(state);
  const title = paid ? 'Payment received' : failed ? 'Payment not confirmed' : 'Payment being confirmed';
  const body = paid
    ? 'Your payment has been verified by Ozow and recorded by Shiloh. You do not need to pay again.'
    : failed
      ? 'Shiloh has not recorded this payment. Please contact the clinic before trying again.'
      : 'We have received the payment response and are confirming it with Ozow. Please do not pay again while this page is being checked.';
  const refresh = !paid && !failed ? '<meta http-equiv="refresh" content="5">' : '';
  const digits = String(whatsappNumber || '').replace(/\D/g, '');
  const canRequest = failed && digits && Number.isSafeInteger(Number(request?.appointment_id)) && Number(request.appointment_id) > 0 && request?.appointment_status !== 'cancelled';
  const message = `Hi Shiloh, please help me with a new payment link for booking #${request?.appointment_id}. My previous link did not work. Please check the payment status first.`;
  const help = canRequest ? `<p><a class="help" href="https://wa.me/${digits}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">Request a new payment link on WhatsApp</a></p><p>Sending this message asks the clinic for help. It does not create a payment or a new booking.</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>${title} — Shiloh</title><style>body{margin:0;background:#f5f3ed;color:#173126;font-family:Inter,system-ui,-apple-system,sans-serif}.card{max-width:620px;margin:12vh auto;padding:32px;border:1px solid #d7dfd9;border-radius:16px;background:#fffdf9;box-shadow:0 12px 30px #17312612}p{line-height:1.55;color:#4e6259}.eyebrow{letter-spacing:.08em;font-size:.8rem;font-weight:800;color:#285642}strong{color:#173126}.help{display:inline-block;background:#294c3c;color:white;padding:14px 18px;border-radius:10px;font-weight:750;text-decoration:none;min-height:44px;box-sizing:border-box}.help:focus-visible{outline:3px solid #173126;outline-offset:3px}</style></head><body><main class="card"><p class="eyebrow">SHILOH PAYMENT</p><h1>${title}</h1><p>${body}</p><p><strong>Amount:</strong> R ${escapeHtml(request?.amount || '')}</p>${requestKey ? `<p>Reference: ${escapeHtml(requestKey)}</p>` : ''}${help}</main></body></html>`;
}

module.exports = { renderPaymentStatusPage };
