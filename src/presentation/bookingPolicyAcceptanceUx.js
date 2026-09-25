'use strict';

const { webPolicyHtml, escapeHtml } = require('./paymentPolicyUx');

function formatAppointmentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function outcomeBlock(outcome = {}) {
  if (!outcome || outcome.state !== 'accepted') return '';
  const payment = outcome.paymentPath
    ? `<a class="primary-action" href="${escapeHtml(outcome.paymentPath)}">${escapeHtml(outcome.depositAmount ? `Continue to secure deposit payment · R${outcome.depositAmount}` : 'Continue to secure payment')}</a>`
    : '';
  const message = outcome.confirmationState === 'sent'
    ? 'Your terms are accepted and Shiloh has continued your booking confirmation.'
    : outcome.depositRequired
      ? (outcome.paymentPath
        ? 'Your terms are accepted. The next step is your booking deposit.'
        : 'Your terms are accepted. Shiloh is preparing the secure deposit step.')
      : 'Your terms are accepted. Shiloh will continue your booking from here.';
  return `<section class="accepted-card" aria-live="polite"><span class="accepted-mark" aria-hidden="true">✓</span><div><h2>Terms accepted</h2><p>${escapeHtml(message)}</p>${payment}</div></section>`;
}

function renderBookingPolicyAcceptancePage({ request, outcome = null } = {}) {
  const accepted = request?.accepted === true || outcome?.state === 'accepted';
  const clinicDevice = request?.channel === 'clinic_device';
  const policy = webPolicyHtml(request?.policyText || '');
  const heading = accepted ? 'Thank you' : 'Review Shiloh’s Booking Policy & Terms';
  const intro = clinicDevice
    ? 'Please review these terms yourself before your future appointment is secured. A Shiloh team member may hand you this device, but the acknowledgement below is yours to make.'
    : 'Please review Shiloh’s Booking Policy & Terms for your future appointment. Your acknowledgement is recorded separately from any payment.';
  const appointment = formatAppointmentDate(request?.startsAt);
  const form = accepted ? '' : `
    <form method="post" action="/booking-policy/${escapeHtml(request?.requestKey || '')}/accept">
      <div class="acceptance">
        <label><input type="checkbox" name="accept" value="yes" required><span>I have read and accept Shiloh’s Booking Policy &amp; Terms.</span></label>
        <button type="submit">Accept Booking Policy &amp; Terms</button>
      </div>
    </form>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)} — Shiloh</title>
<style>
:root{--ink:#173126;--leaf:#285642;--muted:#61736a;--line:#d7dfd9;--soft:#f5f3ed;--panel:#fffdf9;--mint:#edf4ee}
*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font-family:Inter,system-ui,-apple-system,sans-serif}.card{width:min(760px,calc(100% - 32px));margin:28px auto;padding:30px;border:1px solid var(--line);border-radius:22px;background:var(--panel);box-shadow:0 12px 34px #17312612}.eyebrow{margin:0 0 8px;letter-spacing:.09em;font-size:.76rem;font-weight:850;color:var(--leaf)}h1{margin:0;font-size:clamp(1.7rem,4vw,2.25rem);line-height:1.12;letter-spacing:-.025em}.intro{margin:12px 0 0;color:var(--muted);line-height:1.58}.booking-summary{display:grid;gap:4px;margin:20px 0;padding:15px 16px;border-radius:14px;background:var(--mint)}.booking-summary small{color:var(--muted);font-weight:750}.booking-summary strong{font-size:1rem}.policy-shell{border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden}.policy-head{padding:18px 18px 14px;border-bottom:1px solid var(--line);background:#fafbf8}.policy-head h2{margin:0;font-size:1.18rem}.policy{padding:4px 18px 20px;color:#40584d;line-height:1.6}.policy h2{margin:22px 0 8px;padding-top:18px;border-top:1px solid #e9ede9;color:var(--ink);font-size:1.03rem}.policy h2:first-child{border-top:0;padding-top:8px}.policy p{margin:8px 0}.policy ul{margin:8px 0 10px;padding-left:21px}.policy li{margin:6px 0}.policy-preamble{margin-top:22px;padding-top:18px;border-top:1px solid #e9ede9}.policy-preamble h2{margin:0 0 8px;padding:0;border:0;color:var(--ink);font-size:1.03rem}.policy-preamble p{margin:0}.acceptance{margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:16px;background:#fafbf8}.acceptance label{display:flex;gap:12px;align-items:flex-start;min-height:48px;font-weight:780;line-height:1.45;cursor:pointer}.acceptance input{width:22px;height:22px;margin:1px 0 0;accent-color:var(--leaf);flex:0 0 auto}.acceptance button,.primary-action{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;margin-top:14px;border:0;border-radius:999px;padding:14px 18px;background:var(--leaf);color:#fff;font:inherit;font-size:1rem;font-weight:850;text-decoration:none;cursor:pointer}.acceptance button:focus-visible,.acceptance input:focus-visible,.primary-action:focus-visible{outline:3px solid #91b09f;outline-offset:3px}.accepted-card{display:flex;gap:13px;align-items:flex-start;margin:18px 0;padding:18px;border:1px solid #bfd2c5;border-radius:16px;background:var(--mint)}.accepted-mark{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:999px;background:var(--leaf);color:#fff;font-weight:900}.accepted-card h2{margin:2px 0 5px;font-size:1.1rem}.accepted-card p{margin:0;color:#40584d;line-height:1.5}.foot{margin:14px 0 0;text-align:center;color:var(--muted);font-size:.82rem;line-height:1.45}
@media(max-width:560px){body{background:var(--panel)}.card{width:100%;min-height:100vh;margin:0;padding:20px 16px 28px;border:0;border-radius:0;box-shadow:none}.policy-head{padding:16px 15px 12px}.policy{padding:2px 15px 18px}}
</style>
</head><body><main class="card" data-booking-policy-acceptance>
<p class="eyebrow">SHILOH · FUTURE BOOKING</p>
<h1>${escapeHtml(heading)}</h1>
<p class="intro">${escapeHtml(intro)}</p>
<section class="booking-summary" aria-label="Booking summary"><small>Appointment</small><strong>Booking #${escapeHtml(request?.appointmentId || '')}${appointment ? ` · ${escapeHtml(appointment)}` : ''}</strong><small>Policy version ${escapeHtml(request?.policyVersion || '')}</small></section>
${outcomeBlock(outcome)}
<section class="policy-shell" aria-labelledby="policy-heading"><div class="policy-head"><h2 id="policy-heading">Booking Policy &amp; Terms</h2></div><div class="policy">${policy}</div></section>
${form}
<p class="foot">Your policy acknowledgement and any payment are recorded separately by Shiloh.</p>
</main></body></html>`;
}

module.exports = { formatAppointmentDate, outcomeBlock, renderBookingPolicyAcceptancePage };
