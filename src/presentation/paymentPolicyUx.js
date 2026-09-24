function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function renderPaymentPolicyPage({ requestKey, request, policyText, policyVersion } = {}) {
  const key = escapeHtml(requestKey);
  const amount = escapeHtml(Number(request?.amount || 0).toFixed(2));
  const payerName = escapeHtml(request?.payer_name || 'there');
  const policy = escapeHtml(policyText || '').replace(/\n/g, '<br>');
  const appointment = request?.appointment_id
    ? `<p><strong>Booking:</strong> #${escapeHtml(request.appointment_id)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review Shiloh deposit policy</title>
<style>
body{margin:0;background:#f5f3ed;color:#173126;font-family:Inter,system-ui,-apple-system,sans-serif}
.card{max-width:680px;margin:5vh auto;padding:28px;border:1px solid #d7dfd9;border-radius:18px;background:#fffdf9;box-shadow:0 12px 30px #17312612}
.eyebrow{letter-spacing:.08em;font-size:.78rem;font-weight:800;color:#285642}
.policy{margin:20px 0;padding:18px;border:1px solid #d7dfd9;border-radius:12px;background:#f8faf6;line-height:1.55;color:#40584d;max-height:48vh;overflow:auto}
.notice{padding:14px;border-radius:10px;background:#edf4ee;line-height:1.5}.steps{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}.step{padding:12px;border:1px solid #d7dfd9;border-radius:11px;background:#fff}.step strong{display:block;margin-bottom:4px}.step span{color:#60746b;font-size:.9rem;line-height:1.4}@media(max-width:560px){.card{margin:0;min-height:100vh;border-radius:0;padding:22px 16px}.steps{grid-template-columns:1fr}}
label{display:flex;gap:10px;align-items:flex-start;margin:18px 0;font-weight:700;line-height:1.45}
input{width:20px;height:20px;accent-color:#285642;flex:0 0 auto}
button{width:100%;border:0;border-radius:999px;padding:15px;background:#285642;color:#fff;font-size:1rem;font-weight:800;cursor:pointer}
small{color:#60746b}
</style>
</head>
<body>
<main class="card">
<p class="eyebrow">SHILOH DEPOSIT · STEP 1 OF 2</p>
<h1>Before you pay, review the Booking Policy &amp; Terms</h1>
<p>Hi ${payerName}. You are still on Shiloh. No payment is taken on this page.</p>\n<div class="steps" aria-label="Deposit payment steps"><div class="step"><strong>1. Review &amp; accept</strong><span>Read Shiloh’s Booking Policy &amp; Terms below and confirm that you accept them.</span></div><div class="step"><strong>2. Pay securely</strong><span>After acceptance, Shiloh takes you to Ozow to complete the deposit.</span></div></div>
<div class="notice"><strong>Deposit due: R${amount}</strong><br>Your appointment is confirmed only after Shiloh verifies the required deposit.</div>
${appointment}
<section class="policy" aria-label="Shiloh Booking Policy and Terms">${policy}</section>
<form method="post" action="/pay/${key}/accept">
<label><input type="checkbox" name="accept" value="yes" required> I have read and accept Shiloh’s Booking Policy &amp; Terms.</label>
<button type="submit">I accept — continue to secure payment</button>
</form>
<p><small>Policy version: ${escapeHtml(policyVersion || '')}</small></p>
</main>
</body>
</html>`;
}

module.exports = { escapeHtml, renderPaymentPolicyPage };
