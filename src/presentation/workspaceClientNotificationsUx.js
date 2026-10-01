const { workspaceErrorRecoveryClientScript } = require('./workspaceErrorRecovery');
const { confirmationClientScript } = require('./workspaceConfirmation');
const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function maskMobile(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 4 ? `Mobile ending ${digits.slice(-4)}` : 'No valid canonical mobile';
}

function styles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--warn:#8a623d;--warn-soft:#f5eee5;--danger:#8f433d;--danger-soft:#f7e9e7;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:980px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:16px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem}.truth-note,.muted{font-size:.76rem;color:var(--muted)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:17px;box-shadow:var(--shadow);padding:18px;margin-bottom:12px}.panel h2{margin:3px 0 12px;font-size:1.15rem}.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted)}.preview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.preview-field{padding:11px;border:1px solid var(--line);border-radius:11px;background:#fff}.preview-field span{display:block;color:var(--muted);font-size:.7rem;margin-bottom:4px}.preview-field strong{font-size:.86rem;line-height:1.4}.message-preview{padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--leaf-soft);line-height:1.55;font-size:.86rem}.action-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:14px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 14px;background:#fff;color:var(--ink);font:inherit;font-size:.82rem;font-weight:800;text-decoration:none;cursor:pointer}.button.primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.button[disabled]{opacity:.55;cursor:not-allowed}.status{margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--leaf-soft);font-size:.8rem;line-height:1.45}.status.warn{background:var(--warn-soft)}.status.error{background:var(--danger-soft);color:var(--danger)}.guardrail{margin:12px 0 0;font-size:.76rem;color:var(--muted);line-height:1.5}@media(max-width:700px){.shell{padding:12px 10px 28px}.topbar{align-items:start;flex-direction:column}.preview-grid{grid-template-columns:1fr}.button{width:100%;min-height:46px}}`;
}

function renderBookingConfirmationPreviewPage(preview, {
  staffAccessScriptPath = '/calendar/staff/client.js',
  calendarNavigationAllowed = false,
} = {}) {
  const client = preview.client || {};
  const appointment = preview.appointment;
  const clientHref = `/calendar/clients/${encodeURIComponent(String(client.id || ''))}`;
  const script = preview.canSend
    ? `<script src="${clientHref}/booking-confirmation.js" defer></script>`
    : '';
  const appointmentPanel = appointment
    ? `<div class="preview-grid"><div class="preview-field"><span>Service</span><strong>${escapeHtml(appointment.serviceName)}</strong></div><div class="preview-field"><span>Practitioner</span><strong>${escapeHtml(appointment.staffName)}</strong></div><div class="preview-field"><span>Starts</span><strong>${escapeHtml(formatDateTime(appointment.startsAt))}</strong></div><div class="preview-field"><span>Location</span><strong>${escapeHtml(appointment.locationName)}</strong></div></div>`
    : '<p class="muted">No upcoming Shiloh-owned appointment is available.</p>';
  const action = preview.canSend
    ? `<button class="button primary" type="button" data-send-booking-confirmation data-client-id="${escapeHtml(client.id)}">Send booking confirmation</button>`
    : '<button class="button primary" type="button" disabled>Automated send unavailable</button>';
  const state = preview.canSend
    ? '<div class="status">Ready to send through the existing Shiloh booking-confirmation delivery path. Nothing is sent until you press the button and confirm.</div>'
    : `<div class="status warn">${escapeHtml(preview.reasonMessage || 'This booking confirmation cannot be sent from the current canonical state.')}</div>`;
  const messagePreview = appointment
    ? `<div class="message-preview"><strong>Booking confirmed</strong><br>Hi ${escapeHtml(client.name || 'there')}, your appointment is confirmed.<br><br><strong>Service:</strong> ${escapeHtml(appointment.serviceName)}<br><strong>With:</strong> ${escapeHtml(appointment.staffName)}<br><strong>When:</strong> ${escapeHtml(formatDateTime(appointment.startsAt))}<br><br><span class="muted">Automated WhatsApp delivery is retired. Booking details remain available in My Shiloh; review any delivery exception with Reception.</span></div>`
    : '<div class="message-preview muted">No message preview is available without an eligible appointment.</div>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Booking confirmation preview — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script>${script}</head><body data-workspace-client-notification-preview="true"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'clients', calendarHref: calendarNavigationAllowed ? '/calendar/read-only' : null, clientsHref: '/calendar/clients' })}<div class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>Booking confirmation preview</h1><p>Review booking details and historical delivery evidence.</p></div><span class="truth-note">Capability: client:notify</span></header><nav class="action-row"><a class="button" href="${clientHref}">← Back to client</a></nav><section class="panel"><span class="eyebrow">Recipient</span><h2>${escapeHtml(client.name || 'Unnamed client')}</h2><div class="preview-grid"><div class="preview-field"><span>Recorded mobile</span><strong>${escapeHtml(maskMobile(client.normalizedMobile))}</strong></div><div class="preview-field"><span>Client status</span><strong>${escapeHtml(client.status || 'unknown')}</strong></div></div></section><section class="panel"><span class="eyebrow">Appointment</span><h2>Next eligible booking</h2>${appointmentPanel}</section><section class="panel"><span class="eyebrow">Preview</span><h2>Client-facing confirmation</h2>${messagePreview}${state}<p class="status" role="status" aria-live="polite" data-client-notification-status hidden></p><div class="action-row">${action}</div><p class="guardrail">Automated WhatsApp sends are retired. Review appointment details and historical delivery evidence here.</p></section></div></div></div></body></html>`;
}

function bookingConfirmationClientScript() {
  return workspaceErrorRecoveryClientScript() + confirmationClientScript() + `(function(){'use strict';
var AUTH='/calendar/staff-auth';
function one(s){return document.querySelector(s);}async function json(r){try{return await r.json();}catch(_e){return{};}}
function status(message,tone){var el=one('[data-client-notification-status]');if(!el)return;el.hidden=false;window.ShilohErrorRecovery.render(el,message,tone);el.className='status'+(tone==='error'?' error':'');}
async function csrf(){var r=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});if(!r.ok)throw window.ShilohErrorRecovery.failure({},r,'Your secure Shiloh session has expired.');var b=await json(r);if(!b.csrfToken)throw new Error('A secure operation token could not be issued.');return b.csrfToken;}
var button=one('[data-send-booking-confirmation]');if(!button)return;button.addEventListener('click',async function(){if(!(await window.ShilohConfirm({title:'Send booking confirmation?',copy:'Send this confirmation to the client recipient shown on this page. Shiloh will recheck whether sending is allowed.',cancel:'Keep unsent',action:'Send confirmation',danger:false})))return;button.disabled=true;status('Revalidating canonical authority and delivery state…');try{var token=await csrf();var r=await fetch('/calendar/clients/'+encodeURIComponent(button.dataset.clientId)+'/booking-confirmation/send',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:'{}'});token='';var body=await json(r);if(!r.ok)throw window.ShilohErrorRecovery.failure(body,r,'The booking confirmation was not sent.');status(body.message||'Booking confirmation sent.');setTimeout(function(){window.location.reload();},900);}catch(error){status(error,'error');button.disabled=false;}});})();`;
}

function renderClientNotificationUnavailablePage({ message = 'Client notification is unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client notification unavailable — Shiloh Workspace</title><style>${styles()}</style></head><body><div class="shell"><section class="panel"><span class="eyebrow">Client notification</span><h2>Unavailable</h2><p>${escapeHtml(message)}</p><a class="button" href="/calendar/clients">Back to Clients</a></section></div></body></html>`;
}

module.exports = {
  formatDateTime,
  maskMobile,
  renderBookingConfirmationPreviewPage,
  bookingConfirmationClientScript,
  renderClientNotificationUnavailablePage,
};
