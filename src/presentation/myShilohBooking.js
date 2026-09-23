'use strict';

const { groupPublicCatalogue, sanitizePublicCatalogue } = require('../services/publicPresentation');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function serviceCards(catalogue = []) {
  const groups = groupPublicCatalogue(sanitizePublicCatalogue(catalogue));
  if (!groups.size) return '<div class="empty">No online-bookable treatments are available right now. Please ask Shiloh for help.</div>';
  return [...groups.entries()].map(([category, rows]) => `
    <section class="category">
      <div class="category-head"><span>Treatments</span><h2>${escapeHtml(category)}</h2></div>
      <div class="service-grid">
        ${rows.map(service => `<button class="service-card" type="button"
          data-book-service
          data-service-id="${escapeHtml(service.id)}"
          data-service-name="${escapeHtml(service.name)}"
          data-service-duration="${escapeHtml(service.duration || '')}"
          data-service-price="${escapeHtml(service.price || '')}">
          <span class="service-name">${escapeHtml(service.name)}</span>
          <span class="service-meta"><small>${escapeHtml(service.duration || '')}</small><strong>${escapeHtml(service.price || '')}</strong></span>
          <span class="choose">Choose treatment <b aria-hidden="true">→</b></span>
        </button>`).join('')}
      </div>
    </section>`).join('');
}

function cleanPolicyText(value = '') {
  return String(value || '').replaceAll('*', '');
}

function renderMyShilohBookingPage({
  catalogue = [],
  clientFirstName = 'there',
  csrfToken = '',
  bookingPolicyText = '',
  depositPolicy = null,
  welcomeVoucherMode = false,
  minimumBookingValue = 450,
} = {}) {
  const rate = Number(depositPolicy?.rateBasisPoints || 5000) / 100;
  const freeHours = Number(depositPolicy?.freeNoticeHours || 48);
  const partialHours = Number(depositPolicy?.partialNoticeHours || 24);
  const partialForfeit = Number(depositPolicy?.partialForfeitBasisPoints || 5000) / 100;
  const lateForfeit = Number(depositPolicy?.lateForfeitBasisPoints || 10000) / 100;
  const voucherNote = welcomeVoucherMode
    ? `<div class="notice notice--voucher"><strong>Your R100 welcome voucher is included in this journey.</strong> Only qualifying treatments of R${escapeHtml(Number(minimumBookingValue).toFixed(0))} or more are shown. After Shiloh confirms the appointment, return to your voucher to apply the R100.</div>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#465746">
<link rel="manifest" href="/my-shiloh/manifest.webmanifest">
<link rel="apple-touch-icon" href="/my-shiloh/assets/apple-touch-icon-180.png">
<title>Book an appointment | My Shiloh</title>
<style>
:root{--ink:#23342d;--muted:#66736c;--paper:#fffdfa;--cream:#f8f4ec;--leaf:#244c3d;--sage:#e7eee7;--line:#d9dfd8;--gold:#96703b;--danger:#8a413b}*{box-sizing:border-box}html{background:var(--cream)}body{margin:0;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}.shell{width:min(820px,calc(100% - 28px));margin:auto}.top{position:sticky;top:0;z-index:20;background:rgba(248,244,236,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}.top .shell{min-height:66px;display:flex;align-items:center;justify-content:space-between;gap:12px}.back{display:inline-flex;align-items:center;min-height:44px;color:var(--leaf);font-weight:850;text-decoration:none}.brand{font-family:Georgia,"Times New Roman",serif;font-size:18px}.intro{padding:28px 0 18px}.eyebrow,.category-head span,.step-kicker{text-transform:uppercase;letter-spacing:.15em;font-size:10px;font-weight:850;color:var(--gold)}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em}h1{font-size:clamp(36px,8vw,52px);line-height:1.02;margin:8px 0 12px}.intro p{margin:0;color:var(--muted)}.progress{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:20px 0}.progress span{padding:9px 8px;border:1px solid var(--line);border-radius:12px;text-align:center;font-size:11px;font-weight:800;color:var(--muted);background:var(--paper)}.progress span.is-active{background:var(--leaf);color:white;border-color:var(--leaf)}.notice{padding:13px 15px;border:1px solid #d8e2d7;background:var(--sage);border-radius:15px;font-size:12px;margin:12px 0}.notice--voucher{background:#fff6df;border-color:#ead9af}.category{padding:24px 0;border-top:1px solid var(--line)}.category h2{font-size:28px;margin:4px 0 14px}.service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.service-card,.option,.slot{appearance:none;width:100%;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:17px;padding:16px;text-align:left;font:inherit;min-height:76px;cursor:pointer;box-shadow:0 7px 22px rgba(35,52,45,.04)}.service-card:hover,.service-card:focus-visible,.option:hover,.option:focus-visible,.slot:hover,.slot:focus-visible{border-color:#9eb0a4;outline:3px solid rgba(36,76,61,.12);outline-offset:1px}.service-name{display:block;font-family:Georgia,"Times New Roman",serif;font-size:20px}.service-meta{display:flex;justify-content:space-between;gap:8px;margin-top:7px;color:var(--muted)}.service-meta strong{color:var(--leaf)}.choose{display:flex;justify-content:space-between;margin-top:13px;color:var(--leaf);font-weight:850;font-size:12px}.step{padding:24px 0 90px}.step[hidden]{display:none}.step-head{margin-bottom:16px}.step-head h2{font-size:31px;margin:5px 0 7px}.step-head p{margin:0;color:var(--muted)}.options,.slots{display:grid;gap:9px}.option strong,.slot strong{display:block}.option small,.slot small{display:block;color:var(--muted);margin-top:3px}.option .badge{display:inline-flex;margin-top:8px;padding:4px 7px;border-radius:999px;background:var(--sage);font-size:10px;font-weight:850;color:var(--leaf)}.date-card,.review-card,.success-card{border:1px solid var(--line);border-radius:18px;background:var(--paper);padding:18px}.date-card label{display:grid;gap:6px;font-weight:800}.date-card input{min-height:48px;border:1px solid #bdc8c0;border-radius:11px;padding:10px 12px;font:inherit;font-size:16px;background:white}.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;border:0;border-radius:12px;padding:0 16px;font:inherit;font-weight:850;text-decoration:none;cursor:pointer}.button--primary{background:var(--leaf);color:white}.button--soft{background:var(--sage);color:var(--leaf)}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.status{min-height:22px;margin:10px 0;color:var(--muted);font-size:13px}.status[data-state="error"]{color:var(--danger);font-weight:750}.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.review-grid div{padding:12px;border-radius:12px;background:#f6f7f3}.review-grid small{display:block;color:var(--muted)}.review-grid strong{display:block;margin-top:3px}.terms{margin:14px 0}.terms summary{cursor:pointer;font-weight:850;color:var(--leaf);min-height:44px;display:flex;align-items:center}.terms pre{white-space:pre-wrap;font:12px/1.5 Inter,system-ui,sans-serif;background:#f6f7f3;padding:13px;border-radius:12px;color:var(--muted)}.confirm-label{display:flex;gap:10px;align-items:flex-start;padding:13px;border:1px solid var(--line);border-radius:13px}.confirm-label input{width:22px;height:22px;flex:none}.success-card{text-align:center;padding:30px 20px}.success-mark{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 12px;border-radius:50%;background:var(--sage);color:var(--leaf);font-size:25px;font-weight:900}.success-card h2{font-size:30px;margin:0 0 8px}.empty{padding:18px;border:1px solid var(--line);border-radius:17px;background:var(--paper)}@media(max-width:620px){.service-grid{grid-template-columns:1fr}.progress{grid-template-columns:1fr 1fr}.review-grid{grid-template-columns:1fr}.shell{width:min(100% - 22px,820px)}h1{font-size:39px}.top .shell{min-height:62px}}
</style></head><body>
<header class="top"><div class="shell"><a class="back" href="/my-shiloh/">← My Shiloh</a><span class="brand">Book with Shiloh</span></div></header>
<main class="shell" data-my-shiloh-booking data-csrf="${escapeHtml(csrfToken)}" data-deposit-rate="${escapeHtml(rate)}" data-deposit-free-hours="${escapeHtml(freeHours)}" data-deposit-partial-hours="${escapeHtml(partialHours)}" data-deposit-partial-forfeit="${escapeHtml(partialForfeit)}" data-deposit-late-forfeit="${escapeHtml(lateForfeit)}">
<section class="intro"><div class="eyebrow">My Shiloh booking</div><h1>Choose your next appointment, ${escapeHtml(clientFirstName)}.</h1><p>Everything happens here in My Shiloh. Your treatment, practitioner and available time are checked against Shiloh’s live booking rules before anything is created.</p>
<div class="progress" aria-label="Booking steps"><span data-progress="1" class="is-active">1 · Treatment</span><span data-progress="2">2 · Practitioner</span><span data-progress="3">3 · Time</span><span data-progress="4">4 · Review</span></div>
<div class="notice"><strong>Booking deposit:</strong> ${escapeHtml(rate)}% is required after Shiloh approves your booking request. Marietjie’s appointments are deposit-exempt. Cancellation terms: ${escapeHtml(freeHours)}+ hours no penalty; ${escapeHtml(partialHours)}–${escapeHtml(freeHours)} hours may forfeit ${escapeHtml(partialForfeit)}% of the deposit; under ${escapeHtml(partialHours)} hours or a no-show may forfeit ${escapeHtml(lateForfeit)}%.</div>${voucherNote}</section>
<section data-step="1">${serviceCards(catalogue)}</section>
<section class="step" data-step="2" hidden><div class="step-head"><span class="step-kicker">Step 2</span><h2>Who would you like to see?</h2><p data-selected-service></p></div><div class="options" data-practitioners></div><p class="status" data-booking-status role="status" aria-live="polite"></p><div class="actions"><button class="button button--soft" type="button" data-back-step="1">← Treatments</button></div></section>
<section class="step" data-step="3" hidden><div class="step-head"><span class="step-kicker">Step 3</span><h2>Choose a date and time.</h2><p data-selected-practitioner></p></div><div class="date-card"><label>Preferred date<input type="date" data-booking-date></label><div class="actions"><button class="button button--primary" type="button" data-find-slots>Show available times</button></div></div><p class="status" data-slot-status role="status" aria-live="polite"></p><div class="slots" data-slots></div><div class="actions"><button class="button button--soft" type="button" data-back-step="2">← Practitioner</button></div></section>
<section class="step" data-step="4" hidden><div class="step-head"><span class="step-kicker">Step 4</span><h2>Review your booking request.</h2><p>We’ll check the selected time once more before creating the request.</p></div><div class="review-card"><div class="review-grid"><div><small>Treatment</small><strong data-review-service></strong></div><div><small>Practitioner</small><strong data-review-practitioner></strong></div><div><small>Date</small><strong data-review-date></strong></div><div><small>Time</small><strong data-review-time></strong></div><div><small>Deposit</small><strong data-review-deposit></strong></div><div><small>After you send it</small><strong>Shiloh staff approval</strong></div></div><details class="terms"><summary>Read Shiloh’s Booking Policy & Terms</summary><pre>${escapeHtml(cleanPolicyText(bookingPolicyText))}</pre></details><label class="confirm-label"><input type="checkbox" data-policy-accepted><span>I have read and accept Shiloh’s Booking Policy & Terms.</span></label><p class="status" data-confirm-status role="status" aria-live="polite"></p><div class="actions"><button class="button button--primary" type="button" data-submit-booking>Send booking request</button><button class="button button--soft" type="button" data-back-step="3">← Change time</button></div></div></section>
<section class="step" data-step="5" hidden><div class="success-card"><div class="success-mark">✓</div><h2>Booking request sent.</h2><p data-success-message>Your selected time is being held while Shiloh confirms it.</p><div class="actions" style="justify-content:center"><a class="button button--primary" href="/my-shiloh/#bookings">View My Shiloh bookings</a><a class="button button--soft" href="/my-shiloh/">Back to My Shiloh</a></div></div></section>
</main><script src="/my-shiloh/assets/booking.js" defer></script></body></html>`;
}

module.exports = { renderMyShilohBookingPage, serviceCards, cleanPolicyText };
