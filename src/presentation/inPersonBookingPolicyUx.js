'use strict';

const { webPolicyHtml } = require('./paymentPolicyUx');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
  }[character]));
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Future appointment';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone:'Africa/Johannesburg',
    day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,
  }).format(date);
}

function renderInPersonBookingPolicyPage(context = {}, { clientScriptPath = '/calendar/book/policy-client.js' } = {}) {
  const accepted = Boolean(context.acceptance);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review Shiloh Booking Policy & Terms</title>
<style>:root{--ink:#20322b;--muted:#5f7168;--paper:#f5f3ed;--panel:#fffdf9;--line:#dce3dd;--leaf:#315844;--soft:#eaf1ec}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,system-ui,sans-serif}.shell{width:min(760px,calc(100% - 28px));margin:24px auto;padding:26px;border:1px solid var(--line);border-radius:22px;background:var(--panel)}h1{margin:0;font-size:clamp(1.65rem,4vw,2.15rem)}.intro{color:var(--muted);line-height:1.55}.summary{display:grid;gap:6px;margin:18px 0;padding:15px;border-radius:14px;background:var(--soft)}.summary strong{font-size:1.05rem}.policy{line-height:1.6}.policy h2{margin:22px 0 8px;padding-top:17px;border-top:1px solid var(--line);font-size:1.05rem}.policy p{margin:8px 0}.policy ul{padding-left:22px}.notice{margin:18px 0;padding:13px 14px;border-radius:12px;background:#fff7df;color:#674f20;line-height:1.5}.acceptance{margin-top:20px;padding:16px;border:1px solid var(--line);border-radius:15px;background:#fafbf8}.acceptance label{display:flex;min-height:44px;gap:11px;align-items:flex-start;font-weight:750;line-height:1.45}.acceptance input{width:22px;height:22px;flex:0 0 auto}.button{width:100%;min-height:50px;margin-top:14px;border:0;border-radius:999px;background:var(--leaf);color:#fff;font:inherit;font-weight:850}.button:disabled{opacity:.55}.done{padding:16px;border-radius:14px;background:var(--soft);font-weight:800}.back{display:inline-flex;min-height:44px;align-items:center;margin-top:16px;color:var(--leaf);font-weight:800;text-decoration:none}@media(max-width:560px){body{background:var(--panel)}.shell{width:100%;min-height:100vh;margin:0;padding:20px 16px;border:0;border-radius:0}}</style>
<script src="${escapeHtml(clientScriptPath)}" defer></script></head>
<body data-in-person-policy><main class="shell"><p style="margin:0 0 7px;font-size:.72rem;font-weight:850;letter-spacing:.09em;color:var(--leaf)">CLIENT REVIEW</p>
<h1>Booking Policy &amp; Terms</h1>
<p class="intro">Please review the terms for this future appointment before continuing.</p>
<section class="summary" aria-label="Appointment summary"><strong>${escapeHtml(context.clientName || 'Client')}</strong><span>${escapeHtml(context.serviceText || 'Appointment')}</span><span>${escapeHtml(context.therapistText || 'Shiloh')}</span><span>${escapeHtml(formatWhen(context.startsAt))}</span></section>
<div class="notice"><strong>Reception:</strong> please hand or turn this screen to the client. The client must read and tap the acknowledgement themselves; staff must not accept on their behalf.</div>
<section class="policy">${webPolicyHtml(context.policyText || '')}</section>
<div data-policy-outcome>${accepted
  ? `<div class="done">✓ Terms already accepted for this appointment.</div>`
  : `<div class="acceptance"><label><input type="checkbox" data-policy-accept> <span>I have read and accept Shiloh’s Booking Policy &amp; Terms.</span></label><button class="button" type="button" data-policy-submit disabled>Accept terms</button></div>`
}</div>
<a class="back" href="/calendar/clients/${escapeHtml(context.crmV2ClientId || '')}">Return to client record</a>
</main></body></html>`;
}

function inPersonBookingPolicyClientScript() {
  return `(function(){'use strict';var checkbox=document.querySelector('[data-policy-accept]');var button=document.querySelector('[data-policy-submit]');if(!checkbox||!button)return;checkbox.addEventListener('change',function(){button.disabled=!checkbox.checked;});async function post(url,payload,token){return fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify(payload||{})});}button.addEventListener('click',async function(){if(!checkbox.checked)return;button.disabled=true;button.textContent='Recording acceptance…';try{var csrf=await post('/calendar/staff-auth/csrf',{},'');var csrfBody=await csrf.json();if(!csrf.ok||!csrfBody.csrfToken)throw new Error('SESSION');var response=await post(location.pathname+'/accept',{accept:true},csrfBody.csrfToken);var body=await response.json().catch(function(){return{};});if(!response.ok)throw new Error(body.error||'ACCEPT');var host=document.querySelector('[data-policy-outcome]');host.innerHTML='<div class="done">✓ Terms accepted for this appointment.</div>'; }catch(_error){button.disabled=false;button.textContent='Accept terms';alert('Shiloh could not record the acceptance. Please ask reception to try again.');}});})();`;
}

module.exports = { renderInPersonBookingPolicyPage, inPersonBookingPolicyClientScript };
