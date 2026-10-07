const {renderLucideIcon}=require('./lucideIcons');
const { workspaceErrorRecoveryClientScript } = require('./workspaceErrorRecovery');
const { confirmationClientScript } = require('./workspaceConfirmation');
const { escapeHtml, workspaceShellStyles, renderWorkspaceNavigation } = require('./workspaceShell');

function baseStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#56685f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--warn:#79522f;--warn-soft:#f5eee5;--danger:#7d3934;--danger-soft:#f7e9e6}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1440px;margin:0 auto;padding:22px 24px 40px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:16px}.topbar-side{display:grid;justify-items:end;gap:7px}.brand h1{margin:0;font-size:clamp(1.45rem,2vw,1.85rem);letter-spacing:-.025em}.brand p,.truth-note{margin:5px 0 0;color:var(--muted);font-size:.8rem;line-height:1.45}.signout-button,.button,.action-button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border:1px solid var(--line);border-radius:9px;padding:7px 11px;background:#fff;color:var(--ink);font:inherit;font-size:.74rem;font-weight:800;cursor:pointer;text-decoration:none}.dashboard-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-flow:row;gap:12px;align-items:start}.dashboard-grid>[data-dashboard-today]{grid-column:1/5;grid-row:1/3}.dashboard-grid>[data-dashboard-carryover-panel]{grid-column:5/7;grid-row:1}.dashboard-grid>[data-dashboard-attention-panel]{grid-column:5/7;grid-row:2}.dashboard-grid>[data-dashboard-activity-panel]{grid-column:1/5;grid-row:3}.panel{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:15px}.hero-panel{border-color:#d2ddd5;box-shadow:0 10px 32px rgba(32,50,43,.065)}.carryover-panel{display:flex;flex-direction:column;box-shadow:0 6px 22px rgba(32,50,43,.035)}.carryover-scroll{min-height:0}.carryover-schedule{gap:10px}.carryover-group{padding:9px}.carryover-group>.team-head{margin:-2px -1px 7px;padding:4px 1px 7px;border-bottom:1px solid rgba(220,227,221,.78)}.carryover-group .appointment{padding:9px}.carryover-group .appointment-main{grid-template-columns:52px minmax(0,1fr) auto;gap:7px}.carryover-group .appointment-actions{display:grid;grid-template-columns:1fr 1fr auto;gap:5px}.carryover-group .appointment-actions .action-button,.carryover-group .appointment-actions .button{min-height:34px;padding:5px 8px;border-radius:8px;font-size:.7rem}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:11px}.eyebrow{font-size:.66rem;text-transform:uppercase;letter-spacing:.11em;font-weight:850;color:var(--muted)}.panel h2,.team-head h3{margin:3px 0 0;font-size:1.08rem}.day-summary{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.summary-pill,.status-pill{display:inline-flex;border-radius:999px;padding:5px 8px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.72rem;font-weight:850}.summary-pill.attention,.status-pill.pending{background:var(--warn-soft);color:var(--warn)}.status-pill.no-show{background:var(--danger-soft);color:var(--danger)}.schedule{display:grid;gap:8px}.team-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.team-group{min-width:0;border:1px solid var(--line);border-radius:13px;padding:10px;background:#fafbf8}.team-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.team-head h3{font-size:.9rem}.appointment,.booking-request{min-width:0;border:1px solid var(--line);border-radius:11px;padding:10px;background:#fff}.appointment+.appointment,.booking-request+.booking-request{margin-top:7px}.appointment-main{display:grid;grid-template-columns:58px minmax(0,1fr) auto;gap:9px;align-items:start}.appointment-time{font-size:.74rem;font-weight:900;color:var(--leaf-deep);padding-top:2px}.appointment-copy{min-width:0}.appointment-copy strong,.appointment-copy span{display:block;overflow-wrap:anywhere}.appointment-copy span{margin-top:3px;color:var(--muted);font-size:.72rem;line-height:1.35}.appointment-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-top:6px}.appointment-actions>.button:only-child{min-height:32px;padding:4px 8px;font-size:.68rem}.request-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}.action-button{min-height:36px;border-radius:8px;padding:6px 10px}.action-button.complete{border-color:var(--leaf);color:var(--leaf-deep);background:var(--leaf-soft)}.action-button.no-show,.action-button.cannot{color:var(--danger)}.action-button:disabled{opacity:.5;cursor:wait}.proposal-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.proposal-field{display:grid;gap:4px;min-width:0;color:var(--muted);font-size:.7rem;font-weight:800}.proposal-fields input,.proposal-fields select{width:100%;min-width:0;min-height:40px;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff;color:var(--ink);font:inherit}.proposal-fields>.action-button{align-self:end}.proposal-practitioner,.proposal-fields>.request-note{grid-column:1/-1}.request-operation-status{grid-column:1/-1;margin:0}.request-note{margin:7px 0 0;color:var(--muted);font-size:.72rem;line-height:1.4}.attention-summary{padding:12px;border-radius:11px;background:var(--warn-soft);color:var(--warn);font-size:.76rem;line-height:1.45}.attention-queue{display:grid;gap:7px;margin-top:8px}.activity-list{display:grid;gap:7px}.activity-item{display:flex;justify-content:space-between;gap:10px;align-items:center;border-top:1px solid var(--line);padding-top:8px;font-size:.74rem}.activity-item:first-child{border-top:0;padding-top:0}.activity-item strong{display:block}.activity-item span{color:var(--muted);font-size:.7rem}.empty{padding:18px 12px;border:1px dashed var(--line);border-radius:11px;color:var(--muted);font-size:.76rem;line-height:1.5;text-align:center}.closure{padding:10px 11px;margin-bottom:9px;border-radius:11px;background:var(--warn-soft);color:var(--warn);font-size:.74rem;font-weight:800}.operation-status{min-height:18px;margin:8px 0 0;color:var(--muted);font-size:.72rem}.operation-status[data-tone="error"]{color:var(--danger)}.outcome-dialog{width:min(460px,calc(100% - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--line);border-radius:20px;padding:0;background:var(--panel);color:var(--ink);box-shadow:0 24px 70px rgba(20,35,29,.24)}.outcome-dialog::backdrop{background:rgba(22,34,29,.52);backdrop-filter:blur(2px)}.outcome-dialog-body{padding:24px}.outcome-dialog h2{margin:6px 0 8px;font-size:1.35rem;letter-spacing:-.015em}.outcome-dialog-copy{margin:0;color:var(--muted);font-size:.92rem;line-height:1.55}.outcome-dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}.outcome-dialog-actions .action-button{min-height:44px;padding:10px 15px}.outcome-dialog-confirm{border-color:var(--leaf);background:var(--leaf-deep);color:#fff}.outcome-dialog-confirm.danger{border-color:var(--danger);background:var(--danger);color:#fff}@media(min-width:1180px){.team-groups{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:1050px) and (min-width:851px){.dashboard-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-grid>[data-dashboard-today],.dashboard-grid>[data-dashboard-carryover-panel],.dashboard-grid>[data-dashboard-attention-panel],.dashboard-grid>[data-dashboard-activity-panel]{grid-column:auto;grid-row:auto}}@media(max-width:850px){.dashboard-grid{grid-template-columns:1fr}.dashboard-grid>[data-dashboard-attention-panel]{grid-column:1;grid-row:1}.dashboard-grid>[data-dashboard-today]{grid-column:1;grid-row:2}.dashboard-grid>[data-dashboard-carryover-panel]{grid-column:1;grid-row:3}.dashboard-grid>[data-dashboard-activity-panel]{grid-column:1;grid-row:4}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-today]{grid-row:1}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-carryover-panel]{grid-row:2}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-activity-panel]{grid-row:3}.shell{padding:13px 11px 28px}.topbar{align-items:start;flex-direction:column;padding-left:52px;min-height:44px}.topbar-side{justify-items:start}.panel{padding:13px;border-radius:14px}.button,.signout-button,.action-button,.carryover-group .appointment-actions .action-button,.carryover-group .appointment-actions .button{min-height:44px}.appointment-main,.carryover-group .appointment-main{grid-template-columns:58px minmax(0,1fr)}.appointment-main>.status-pill{grid-column:2;justify-self:start}.appointment-actions,.carryover-group .appointment-actions{display:grid;grid-template-columns:1fr 1fr}.appointment-actions .button,.carryover-group .appointment-actions .button{grid-column:1/-1}.request-actions,.proposal-fields{display:grid;grid-template-columns:1fr}.team-groups{grid-template-columns:1fr}.team-group,.carryover-group{padding:9px}.brand p{max-width:34rem}.outcome-dialog{width:100%;max-width:none;max-height:calc(100dvh - 12px);inset:auto 0 0;margin:auto 0 0;border-width:1px 0 0;border-radius:22px 22px 0 0}.outcome-dialog-body{padding:22px 18px calc(22px + env(safe-area-inset-bottom))}.outcome-dialog-actions{display:grid;grid-template-columns:1fr 1fr}.outcome-dialog-actions .action-button{width:100%}}`;
}

function styles() {
  return `${baseStyles()}.workspace-main [data-dashboard-attention-panel]:has([data-dashboard-deposits]){display:block}.booking-request .appointment-main{display:flex;flex-wrap:wrap;gap:5px 9px}.booking-request .appointment-copy{flex-basis:100%;order:2}.booking-request .status-pill{order:1;margin-left:auto}@media(min-width:1051px){.workspace-main .shell{display:flex;min-height:100vh;flex-direction:column}.dashboard-grid{flex:1;grid-template-rows:auto minmax(0,1fr);align-items:stretch}.dashboard-grid>.panel{align-self:stretch}.dashboard-grid>[data-dashboard-today]{grid-row:1}.dashboard-grid>[data-dashboard-activity-panel]{grid-row:2}.dashboard-grid:not(:has([data-dashboard-attention-panel])){grid-template-rows:auto minmax(0,1fr)}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-activity-panel]{grid-row:2}.team-groups .appointment-main{grid-template-columns:50px minmax(0,1fr)}.team-groups .appointment-main>.status-pill{grid-column:2;justify-self:start}}@media(max-width:1050px) and (min-width:851px){.dashboard-grid>[data-dashboard-today] .team-groups{grid-template-columns:minmax(0,1fr)}}@media(max-width:850px){.dashboard-grid{grid-template-columns:minmax(0,1fr)}.dashboard-grid,.panel,.panel-head>*{min-width:0;max-width:100%}.panel-head{flex-wrap:wrap}.appointment-actions,.carryover-group .appointment-actions{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.attention-summary{max-width:100%;overflow-wrap:anywhere}}`;
}

function timeOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unknown';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function dateTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unknown';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function dateGroupLabel(dateKey) {
  const date = new Date(`${String(dateKey || '').trim()}T12:00:00+02:00`);
  if (Number.isNaN(date.getTime())) return String(dateKey || 'Date unknown');
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date);
}

function dashboardDateLabel(dateKey) {
  const date = new Date(`${String(dateKey || '').trim()}T12:00:00+02:00`);
  if (Number.isNaN(date.getTime())) return String(dateKey || 'Date unknown');
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function practitionerNames(appointment, calendar) {
  const names = new Map((calendar.timeline?.staff || []).map((person) => [Number(person.id), person.displayName]));
  for (const person of appointment.staff || []) {
    const id = Number(person.staffId || person.staff_id);
    if (Number.isSafeInteger(id) && !names.has(id) && person.nameSnapshot) names.set(id, person.nameSnapshot);
  }
  return (
    (appointment.staffIds || [])
      .map((id) => names.get(Number(id)))
      .filter(Boolean)
      .join(' + ') || 'Shiloh practitioner'
  );
}

function statusPresentation(status) {
  const value = String(status || '')
    .trim()
    .toLowerCase();
  if (value === 'completed') return { label: 'Completed', className: '' };
  if (value === 'no_show') return { label: 'No-show', className: ' no-show' };
  if (value === 'cancelled') return { label: 'Cancelled', className: ' no-show' };
  return {
    label: value ? value.replace(/_/g, ' ') : 'Scheduled',
    className: ' pending',
  };
}

function calendarHref(model, dateKey = model.operationalDateKey) {
  return `/calendar/read-only?view=week&amp;date=${escapeHtml(dateKey)}&amp;staff=all`;
}

function appointmentItem(item, model, { manageLabel = 'Open / manage', idPrefix = 'dashboard-appointment', attention = false } = {}) {
  const status = statusPresentation(item.status);
  const itemDateKey = item.operationalDateKey || model.operationalDateKey;
  const carryOver = itemDateKey !== model.operationalDateKey;
  const manageAction = `<a data-workspace-action="secondary" class="button" href="${calendarHref(model, itemDateKey)}">${escapeHtml(manageLabel)}</a>`;
  const finalizeAttribute = attention ? 'data-dashboard-attention-finalize' : 'data-dashboard-finalize';
  const appointmentAttribute = attention ? 'data-dashboard-attention-appointment' : 'data-dashboard-appointment';
  const canMarkNoShow = item.canMarkNoShow === true || (item.canMarkNoShow == null && item.canFinalize === true);
  const outcomeActions = `${item.canFinalize ? `<button data-workspace-action="primary" type="button" class="action-button complete" ${finalizeAttribute}="completed">Completed</button>` : ''}${canMarkNoShow ? `<button data-workspace-action="danger" type="button" class="action-button no-show" ${finalizeAttribute}="no_show">No-show</button>` : ''}`;
  const notesAction=item.bookingNotesPresent===true && !['couples_massage','group_booking','multi_service_booking'].includes(item.appointmentGroupType) && !attention && !carryOver && ['scheduled','confirmed'].includes(item.status)
    ? `<a class="button booking-notes-indicator" href="${escapeHtml('/calendar/read-only?'+new URLSearchParams({view:'week',date:itemDateKey,staff:'all',notesAppointment:String(item.id)}).toString())}" aria-label="View booking notes for appointment ${escapeHtml(item.id)}">${renderLucideIcon('notes',{size:16})} Notes</a>` : '';
  const actions = outcomeActions ? `<div class="appointment-actions" data-dashboard-finalization-actions>${outcomeActions}${notesAction}${manageAction}</div>` : `<div class="appointment-actions">${notesAction}${manageAction}</div>`;
  const detail = `${item.serviceName || 'Shiloh appointment'} · ${practitionerNames(item, model.calendar)}`;
  return `<article class="appointment${carryOver ? ' carryover-card' : ''}" id="${escapeHtml(idPrefix)}-${escapeHtml(item.id)}" ${appointmentAttribute}="${escapeHtml(item.id)}" data-revision="${escapeHtml(item.revision || '')}" data-operational-date-key="${escapeHtml(itemDateKey)}"><div class="appointment-main"><span class="appointment-time">${escapeHtml(timeOnly(item.startsAt))}</span><div class="appointment-copy"><strong>${escapeHtml(item.clientName || 'Client')}</strong><span>${escapeHtml(detail)}</span></div><span class="status-pill${status.className}">${escapeHtml(status.label)}</span></div>${actions}</article>`;
}

function activityItem(item, model) {
  const status = statusPresentation(item.status);
  return `<div class="activity-item" data-dashboard-activity><div><strong>${escapeHtml(item.clientName || 'Client')}</strong><span>${escapeHtml(timeOnly(item.endsAt))} · ${escapeHtml(practitionerNames(item, model.calendar))}</span></div><span class="status-pill${status.className}">${escapeHtml(status.label)}</span></div>`;
}

function formatRand(value) {
  return `R${Math.max(0, Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function depositQueueContent(queue) {
  if (!queue) return '';
  if (queue.loading) return '<p class="empty" role="status">Checking current deposits…</p>';
  if (queue.unavailable) return '<p class="empty" role="status">Deposits are temporarily unavailable. Refresh to check again.</p>';
  if (!queue.items?.length) return '<p class="empty">No upcoming bookings are awaiting a deposit in your access.</p>';
  return queue.items.map(item => `<article class="booking-request" data-deposit-account="${escapeHtml(item.accountId)}"${['awaiting', 'partial'].includes(item.state) && Number(item.outstanding) > 0 ? ' data-workspace-card="deposit-pending"' : ''}><div class="appointment-copy"><strong>${item.outstanding == null ? 'Payment evidence needs review' : `${escapeHtml(formatRand(item.outstanding))} deposit outstanding`}</strong><span>${item.state === 'review' ? 'Review the booking and payment history before following up.' : item.state === 'partial' ? 'Part of the deposit is recorded.' : 'Awaiting deposit payment.'}${item.state !== 'review' && !item.hasLink ? ' No active payment link is recorded; review payment details.' : ''}</span>${item.members.map(member => `<span><strong>${escapeHtml(member.clientName)}</strong>${escapeHtml(member.serviceName)} · ${escapeHtml(dateTimeLabel(member.startsAt))} · ${escapeHtml((member.staffNames || []).join(' + '))}</span>`).join('')}</div><div class="request-actions"><a data-workspace-action="secondary" class="button" href="/calendar/read-only?appointment=${escapeHtml(item.appointmentId)}">View booking</a><a data-workspace-action="secondary" class="button" href="/calendar/payments/appointments/${escapeHtml(item.appointmentId)}">Review payment</a></div></article>`).join('');
}

function depositQueuePanel(queue) {
  if (!queue) return '';
  return `<section data-dashboard-deposits aria-labelledby="dashboard-deposits-heading"><header class="panel-head"><div><h3 id="dashboard-deposits-heading">Awaiting deposits</h3><p class="truth-note">Upcoming bookings · shared payments shown once.</p></div><button data-workspace-action="secondary" class="button" type="button" data-deposits-refresh>Refresh deposits</button></header><div data-deposits-content>${depositQueueContent(queue)}</div></section>`;
}

function depositQueueClientScript() {
  return `(()=>{'use strict';const panel=document.querySelector('[data-dashboard-deposits]');if(!panel)return;const content=panel.querySelector('[data-deposits-content]'),button=panel.querySelector('[data-deposits-refresh]');let running=false;
  async function refresh(){if(running||document.hidden)return;running=true;button.disabled=true;content.setAttribute('aria-busy','true');content.innerHTML='<p class="empty" role="status">Checking current deposits…</p>';try{const response=await fetch('/calendar/workspace/deposits',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});if(!response.ok)throw new Error('unavailable');const html=await response.text();content.innerHTML=html;if(!html)panel.remove();}catch(_error){content.innerHTML='<p class="empty" role="status">Deposits are temporarily unavailable. Refresh to check again.</p>';}finally{running=false;button.disabled=false;content.removeAttribute('aria-busy');}}
  button.addEventListener('click',refresh);window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.setInterval(refresh,60000);
  })();`;
}

function bookingRequestItem(item, model) {
  const awaiting = item.effectiveStatus === 'awaiting_client_confirmation';
  const status = awaiting ? 'Awaiting client response' : 'Requested · Awaiting confirmation';
  const canChoosePractitioner = ['owner_overview', 'business_overview'].includes(model.mode) && item.canChangePractitioner !== false;
  const practitioners = Array.isArray(item.eligiblePractitioners) ? item.eligiblePractitioners : [];
  const noPractitioner = canChoosePractitioner && !practitioners.length;
  const selectedStaffId = practitioners.some(person => Number(person.id) === Number(item.proposedStaffId))
    ? Number(item.proposedStaffId) : Number(item.currentStaffId);
  const staffPicker = canChoosePractitioner
    ? `<label class="proposal-field proposal-practitioner"><span>Alternative practitioner</span><select data-proposal-staff required${noPractitioner ? ' disabled' : ''}><option value="" disabled${practitioners.some(person => Number(person.id) === selectedStaffId) ? '' : ' selected'}>${noPractitioner ? 'No eligible practitioner' : 'Choose practitioner'}</option>${practitioners.map(person => `<option value="${escapeHtml(person.id)}"${Number(person.id) === selectedStaffId ? ' selected' : ''}>${escapeHtml(person.displayName)}${Number(person.id) === Number(item.currentStaffId) ? ' (current)' : ''}</option>`).join('')}</select></label>${noPractitioner ? '<p class="request-note">No active practitioner is assigned to this treatment. Review the practitioner assignments in Services before proposing an alternative.</p>' : ''}`
    : item.canChangePractitioner === false ? '<p class="request-note">This request keeps its current practitioner team. Choose an alternative date and time.</p>' : '';
  const proposal = awaiting ? `<p class="request-note">Proposed ${escapeHtml(dateTimeLabel(item.proposedStartsAt))} with ${escapeHtml(item.proposedStaffName || item.staffName)}. The client must accept before confirmation.</p>` : '<p class="request-note">Accept the requested appointment or propose an alternative. This request is not confirmed yet.</p>';
  return `<article class="booking-request" id="booking-request-${escapeHtml(item.appointmentId)}" data-booking-request="${escapeHtml(item.appointmentId)}" data-requested-revision="${escapeHtml(item.requestedRevision || '')}"><div class="appointment-main"><span class="appointment-time">${escapeHtml(dateTimeLabel(item.requestedStartsAt))}</span><div class="appointment-copy"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.serviceName)} · ${escapeHtml(item.staffName)}</span></div><span class="status-pill pending">${escapeHtml(status)}</span></div>${proposal}${item.occasionNote ? `<p class="request-note"><strong>Occasion:</strong> ${escapeHtml(item.occasionNote)}</p>` : ''}<div class="request-actions"><button data-workspace-action="primary" class="action-button complete" type="button" data-booking-action="accept"${awaiting ? ' disabled' : ''}>Accept requested appointment</button></div><div class="proposal-fields"><label class="proposal-field"><span>Alternative date</span><input type="date" data-proposal-date></label><label class="proposal-field"><span>Alternative time</span><input type="time" step="900" data-proposal-time></label>${staffPicker}<button data-workspace-action="secondary" class="action-button" type="button" data-booking-action="propose"${noPractitioner ? ' disabled' : ''}>Propose alternative</button><p class="operation-status request-operation-status" data-booking-request-status aria-live="polite"></p></div></article>`;
}

function planningRequestItem(item) {
  const kind = item.request_kind === 'group' ? 'Group visit or event' : 'Flexible visit';
  const date = item.preferred_date ? String(item.preferred_date).slice(0,10) : 'Date flexible';
  const daypart = item.preferred_daypart && item.preferred_daypart !== 'any' ? item.preferred_daypart : 'Time flexible';
  const appointments = (item.candidate_appointments || []).map(candidate => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(dateTimeLabel(candidate.startsAt))}</option>`).join('');
  return `<article class="booking-request" data-dashboard-planning-request="${escapeHtml(item.id)}"><div class="appointment-main"><span class="appointment-time">Request</span><div class="appointment-copy"><strong>${escapeHtml(item.client_name)}</strong><span>${escapeHtml(kind)} · ${escapeHtml(item.service_name || item.service_detail)}</span></div><span class="status-pill pending">${item.status === 'planning' ? 'Planning' : 'Requested'}</span></div><p class="request-note">${escapeHtml(date)} · ${escapeHtml(daypart)}${item.guest_count ? ` · About ${escapeHtml(item.guest_count)} guests` : ''}${item.practitioner_name ? ` · Prefers ${escapeHtml(item.practitioner_name)}` : ''}</p>${item.special_occasion ? `<p class="request-note"><strong>Occasion:</strong> ${escapeHtml(item.occasion_note)}</p>` : ''}${item.client_note ? `<p class="request-note"><strong>Client note:</strong> ${escapeHtml(item.client_note)}</p>` : ''}<p class="request-note">This request has not booked a time or requested payment.</p><div class="request-actions">${item.status === 'requested' ? '<button data-workspace-action="secondary" class="action-button" type="button" data-planning-action="start_planning">Start planning</button>' : ''}</div><div class="proposal-fields"><label class="proposal-field"><span>Appointment arranged for this client</span><select data-planning-appointment><option value="">Choose their scheduled appointment</option>${appointments}</select></label><button data-workspace-action="primary" class="action-button complete" type="button" data-planning-action="arranged"${appointments ? '' : ' disabled'}>Link arranged appointment</button><button data-workspace-action="danger" class="action-button cannot" type="button" data-planning-show-decline>Cannot accommodate</button><div data-planning-decline hidden><p class="request-note">This closes the request without changing any appointment. Confirm only after speaking with the client.</p><button data-workspace-action="danger" class="action-button cannot" type="button" data-planning-action="decline">Confirm cannot accommodate</button><button data-workspace-action="secondary" class="action-button" type="button" data-planning-cancel-decline>Keep planning</button></div><p class="operation-status request-operation-status" data-planning-status role="status" aria-live="polite"></p></div></article>`;
}

function rescheduleRequestItem(item) {
  return `<article class="booking-request reschedule-request" data-dashboard-reschedule-request="${escapeHtml(item.requestId)}"><div class="appointment-main"><span class="appointment-time">${escapeHtml(dateTimeLabel(item.proposedStartsAt))}</span><div class="appointment-copy"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.serviceName)} · ${escapeHtml(item.staffName)}</span></div><span class="status-pill pending">Time change requested</span></div><p class="request-note">Current appointment: ${escapeHtml(dateTimeLabel(item.originalStartsAt))}. Requested: ${escapeHtml(dateTimeLabel(item.proposedStartsAt))}. The current booking remains unchanged. Coordinate with the practitioner and client before deciding; ${item.decisionOwner === 'reception' ? 'Reception will decide this request after checking the clinic schedule.' : 'This older request still follows its practitioner approval path.'}</p>${item.decisionOwner === 'reception' ? '<div class="request-actions"><button data-workspace-action="primary" class="action-button complete" type="button" data-reschedule-decision="approve">Confirm time change</button><button data-workspace-action="danger" class="action-button cannot" type="button" data-reschedule-decision="decline">Cannot accommodate</button></div><p class="operation-status request-operation-status" data-reschedule-status aria-live="polite"></p>' : ''}</article>`;
}

function scheduleBody(model) {
  if (!['owner_overview', 'business_overview'].includes(model.mode)) {
    return `<div class="schedule">${model.appointments.map((item) => appointmentItem(item, model)).join('') || '<div class="empty">You have no appointments today.</div>'}</div>`;
  }
  return `<div class="team-groups">${model.teamGroups.map((group) => `<section class="team-group" data-dashboard-team-group="${escapeHtml(group.key)}"><header class="team-head"><h3>${escapeHtml(group.label)}</h3><span class="summary-pill">${group.appointments.length}</span></header>${group.appointments.map((item) => appointmentItem(item, model)).join('')}</section>`).join('') || '<div class="empty">No appointments are scheduled across the team today.</div>'}</div>`;
}

function carryOverBody(model) {
  const carryOver = model.carryOver || [];
  if (!carryOver.length) return '<div class="empty">No unfinished past visits are waiting for an outcome.</div>';
  const groups = new Map();
  for (const item of carryOver) {
    const dateKey = item.operationalDateKey || 'Date unknown';
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(item);
  }
  return `<div class="carryover-scroll" data-dashboard-carryover-scroll><div class="schedule carryover-schedule">${[...groups.entries()].map(([dateKey, items]) => `<section class="team-group carryover-group" data-dashboard-carryover-day="${escapeHtml(dateKey)}"><header class="team-head"><h3>${escapeHtml(dateGroupLabel(dateKey))}</h3><span class="summary-pill attention">${items.length}</span></header>${items.map(item => appointmentItem(item, model)).join('')}</section>`).join('')}</div></div>`;
}

function outcomeDialog() {
  return `<dialog class="outcome-dialog" data-dashboard-outcome-dialog aria-labelledby="dashboard-outcome-title" aria-describedby="dashboard-outcome-copy"><div class="outcome-dialog-body"><span class="eyebrow">Visit outcome</span><h2 id="dashboard-outcome-title" data-dashboard-outcome-title></h2><p class="outcome-dialog-copy" id="dashboard-outcome-copy" data-dashboard-outcome-copy></p><div class="outcome-dialog-actions"><button data-workspace-action="secondary" class="action-button" type="button" data-dashboard-outcome-cancel>Not yet</button><button data-workspace-action="secondary" class="action-button outcome-dialog-confirm" type="button" data-dashboard-outcome-confirm></button></div></div></dialog>`;
}

function baseDashboardClientScript() {
  return workspaceErrorRecoveryClientScript() + confirmationClientScript() + `(function(){'use strict';var AUTH='/calendar/staff-auth';var API='/calendar/workspace';var outcomeDialog=one('[data-dashboard-outcome-dialog]'),outcomeTitle=one('[data-dashboard-outcome-title]'),outcomeCopy=one('[data-dashboard-outcome-copy]'),outcomeCancel=one('[data-dashboard-outcome-cancel]'),outcomeConfirm=one('[data-dashboard-outcome-confirm]'),pendingOutcome=null;function one(s,r){return(r||document).querySelector(s);}function all(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}async function json(r){try{return await r.json();}catch(_e){return{};}}function status(message,tone,target){target=target||one('[data-dashboard-operation-status]');if(!target)return;window.ShilohErrorRecovery.render(target,message,tone);}async function csrf(){var r=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});var b=await json(r);if(!r.ok||!b.csrfToken)throw window.ShilohErrorRecovery.failure(b,r,'Your secure Shiloh session has expired.');return b.csrfToken;}async function post(path,payload){var token=await csrf();var response=await fetch(API+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify(payload||{})});token='';var body=await json(response);if(!response.ok)throw window.ShilohErrorRecovery.failure(body,response,'Nothing was changed.');return body;}function closeOutcomeDialog(restoreFocus){var pending=pendingOutcome;pendingOutcome=null;if(outcomeDialog&&outcomeDialog.open)outcomeDialog.close();if(restoreFocus!==false&&pending&&pending.button)setTimeout(function(){pending.button.focus();},0);return pending;}function openOutcomeDialog(button,card,outcome){if(!outcomeDialog)return;var noShow=outcome==='no_show',client=String((one('.appointment-copy strong',card)||{}).textContent||'this client').trim();pendingOutcome={button:button,card:card,outcome:outcome};outcomeTitle.textContent=noShow?'Mark this visit as a no-show?':'Mark this visit as completed?';outcomeCopy.textContent=noShow?'This will record '+client+'\u2019s appointment as a no-show and release the remaining appointment time for booking.':'This will record '+client+'\u2019s appointment as completed.';outcomeConfirm.textContent=noShow?'Mark no-show':'Mark completed';outcomeConfirm.className='action-button outcome-dialog-confirm'+(noShow?' danger':'');outcomeDialog.showModal();setTimeout(function(){outcomeCancel.focus();},0);}async function finalizeVisit(button,card,outcome){var appointmentId=card.dataset.dashboardAppointment||card.dataset.dashboardAttentionAppointment;all('button',card).forEach(function(item){item.disabled=true;});status('Checking the latest appointment details…','working');try{await post('/appointments/'+encodeURIComponent(appointmentId)+'/finalize',{expectedRevision:card.dataset.revision,outcome:outcome,operationalDateKey:card.dataset.operationalDateKey});status('Visit outcome recorded. Refreshing Dashboard…','ready');window.setTimeout(function(){window.location.reload();},500);}catch(error){status(error,'error');all('button',card).forEach(function(item){item.disabled=false;});button.focus();}}if(outcomeCancel)outcomeCancel.addEventListener('click',function(){closeOutcomeDialog(true);});if(outcomeDialog){outcomeDialog.addEventListener('cancel',function(event){event.preventDefault();closeOutcomeDialog(true);});outcomeDialog.addEventListener('click',function(event){if(event.target===outcomeDialog)closeOutcomeDialog(true);});}if(outcomeConfirm)outcomeConfirm.addEventListener('click',function(){var pending=closeOutcomeDialog(false);if(pending)finalizeVisit(pending.button,pending.card,pending.outcome);});document.addEventListener('click',async function(event){var bookingButton=event.target.closest('[data-booking-action]');if(bookingButton){var request=bookingButton.closest('[data-booking-request]');if(!request)return;var action=bookingButton.dataset.bookingAction;var requestStatus=one('[data-booking-request-status]',request);var payload={expectedRevision:request.dataset.requestedRevision};if(action==='propose'){var dateInput=one('[data-proposal-date]',request);var timeInput=one('[data-proposal-time]',request);var date=String(dateInput&&dateInput.value||'');var time=String(timeInput&&timeInput.value||'');if(!date&&!time){status('Choose an alternative date and time.','error',requestStatus);return;}if(!date){status('Choose an alternative date.','error',requestStatus);return;}if(!time){status('Choose an alternative time.','error',requestStatus);return;}if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time)){status('Choose a valid alternative date and time.','error',requestStatus);return;}var candidate=new Date(date+'T'+time+':00+02:00');if(Number.isNaN(candidate.getTime())){status('Choose a valid alternative date and time.','error',requestStatus);return;}payload.startsAt=candidate.toISOString();var staff=one('[data-proposal-staff]',request);if(staff&&!staff.value){status('Choose a practitioner for this treatment.','error',requestStatus);staff.focus();return;}if(staff&&staff.value)payload.staffId=Number(staff.value);}if(action!=='accept'&&action!=='propose')return;var controls=all('button,input,select',request);var disabled=controls.map(function(item){return item.disabled;});controls.forEach(function(item){item.disabled=true;});status(action==='propose'?'Checking this alternative…':'Accepting requested appointment…','working',requestStatus);try{await post('/booking-requests/'+encodeURIComponent(request.dataset.bookingRequest)+'/'+encodeURIComponent(action),payload);status(action==='propose'?'Alternative is available in the client’s My Shiloh Bookings.':'Requested appointment accepted.','ready',requestStatus);window.setTimeout(function(){window.location.reload();},500);}catch(error){status(error,'error',requestStatus);controls.forEach(function(item,index){item.disabled=disabled[index];});}return;}var button=event.target.closest('[data-dashboard-finalize],[data-dashboard-attention-finalize]');if(!button)return;var card=button.closest('[data-dashboard-appointment],[data-dashboard-attention-appointment]');if(!card)return;var outcome=button.dataset.dashboardFinalize||button.dataset.dashboardAttentionFinalize;openOutcomeDialog(button,card,outcome);});})();`;
}

function dashboardClientScript() {
  return workspaceErrorRecoveryClientScript() + baseDashboardClientScript() + `(function(){'use strict';document.addEventListener('click',async function(event){var button=event.target.closest('[data-reschedule-decision]');if(!button)return;var card=button.closest('[data-dashboard-reschedule-request]');if(!card)return;var decision=button.dataset.rescheduleDecision;if(decision!=='approve'&&decision!=='decline')return;if(!(await window.ShilohConfirm({title:decision==='approve'?'Approve time change?':'Decline time change?',copy:decision==='approve'?'The current appointment and availability will be checked before the time changes.':'The original appointment time stays unchanged.',cancel:'Keep request',action:decision==='approve'?'Approve change':'Decline change',danger:decision!=='approve'})))return;var status=card.querySelector('[data-reschedule-status]');var controls=card.querySelectorAll('button');controls.forEach(function(item){item.disabled=true;});if(status)status.textContent='Checking the current request…';try{var csrfResponse=await fetch('/calendar/staff-auth/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});var csrfBody=await csrfResponse.json();if(!csrfResponse.ok||!csrfBody.csrfToken)throw new Error('Your secure session has expired.');var response=await fetch('/calendar/workspace/reschedule-requests/'+encodeURIComponent(card.dataset.dashboardRescheduleRequest)+'/'+decision,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':csrfBody.csrfToken},body:'{}'});var result=await response.json();if(!response.ok)throw window.ShilohErrorRecovery.failure(result,response,'No time change was made.');if(status)status.textContent=result.reply||'Request resolved. Refreshing Dashboard…';window.setTimeout(function(){window.location.reload();},600);}catch(error){if(status)window.ShilohErrorRecovery.render(status,error,'error');controls.forEach(function(item){item.disabled=false;});button.focus();}});})();`;
}

function planningRequestClientScript() {
  return workspaceErrorRecoveryClientScript() + `(()=>{'use strict';document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-planning-action],[data-planning-show-decline],[data-planning-cancel-decline]');
    if(!button)return;
    const card=button.closest('[data-dashboard-planning-request]');if(!card)return;
    const decline=card.querySelector('[data-planning-decline]');
    if(button.hasAttribute('data-planning-show-decline')){decline.hidden=false;decline.querySelector('button').focus();return;}
    if(button.hasAttribute('data-planning-cancel-decline')){decline.hidden=true;card.querySelector('[data-planning-show-decline]').focus();return;}
    const action=button.dataset.planningAction;
    if(!['start_planning','decline','arranged'].includes(action))return;
    const status=card.querySelector('[data-planning-status]');
    const appointment=card.querySelector('[data-planning-appointment]');
    if(action==='arranged'&&!appointment.value){status.textContent='Choose the appointment arranged for this client.';appointment.focus();return;}
    button.disabled=true;status.textContent='Checking the current request…';
    try{
      const csrf=await fetch('/calendar/staff-auth/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});
      const token=await csrf.json();if(!csrf.ok||!token.csrfToken)throw new Error('Your secure session has expired.');
      const response=await fetch('/calendar/workspace/planning-requests/'+encodeURIComponent(card.dataset.dashboardPlanningRequest)+'/'+action,{
        method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token.csrfToken},
        body:JSON.stringify(action==='arranged'?{appointmentId:Number(appointment.value)}:{}),
      });
      const result=await response.json();if(!response.ok)throw window.ShilohErrorRecovery.failure(result,response,'The request was not changed.');
      status.textContent='Request updated. Refreshing…';setTimeout(()=>location.reload(),500);
    }catch(error){window.ShilohErrorRecovery.render(status,error,'error');button.disabled=false;button.focus();}
  });})();`;
}

function renderDashboardPage(model, { staffAccessScriptPath = '/calendar/staff/client.js', dashboardScriptPath = '/calendar/workspace/client.js', navigation = {} } = {}) {
  const nextOperationalDay = model.requestedDateKey !== model.operationalDateKey;
  const isBusinessOverview = ['owner_overview', 'business_overview'].includes(model.mode);
  const heading = isBusinessOverview ? 'Today across the team' : 'My day';
  const closures = (model.closures || []).map((item) => `<div class="closure">Closed · ${escapeHtml(item.reason || 'Clinic closure')}</div>`).join('');
  const bookingRequests = model.bookingRequests || [];
  const planningRequests = model.planningRequests || [];
  const rescheduleRequests = model.rescheduleRequests || [];
  const awaitingFinalization = model.awaitingFinalization || [];
  const holidayDecisions = model.holidayDecisions || [];
  const attentionCount = awaitingFinalization.length + bookingRequests.length + planningRequests.length + rescheduleRequests.length + holidayDecisions.length;
  const actionableCount = awaitingFinalization.filter((item) => item.canFinalize).length;
  const requestCards = bookingRequests.map(item => bookingRequestItem(item, model)).join('');
  const planningCards = planningRequests.map(planningRequestItem).join('');
  const rescheduleCards = rescheduleRequests.map(rescheduleRequestItem).join('');
  const finalizationCount = awaitingFinalization.length;
  const finalizationSummary = finalizationCount ? `<div class="attention-summary"><strong>${finalizationCount} ${finalizationCount === 1 ? 'visit is' : 'visits are'} awaiting practitioner finalization.</strong><br>${model.canFinalizeAllBusiness ? 'Authorized all-business backup actions are available below.' : isBusinessOverview ? 'Assigned practitioners finalize their own visits; review the exact visit below.' : actionableCount === finalizationCount ? 'Record Completed or No-show directly below.' : `${actionableCount} can be finalized here; shared visits must be completed by their assigned practitioner.`}</div>` : '';
  const finalizationCards = awaitingFinalization.map(item => appointmentItem(item, model, { manageLabel: 'Review visit', idPrefix: 'dashboard-attention-appointment', attention: true })).join('');
  const finalizationQueue = finalizationCards ? `<div class="attention-queue" data-dashboard-attention-queue>${finalizationCards}</div>` : '';
  const holidayCards = holidayDecisions.map(item => `<div class="booking-request" data-dashboard-holiday-decision><strong>${escapeHtml(item.holidayName)}</strong><p class="request-note">${escapeHtml(item.exceptionDate)} · Clinic hours decision needed</p><div class="request-actions"><a data-workspace-action="secondary" class="button" href="${escapeHtml(item.href)}">Set holiday hours</a></div></div>`).join('');
  const deposits = depositQueuePanel(model.depositQueue);
  const hasAttention = Boolean(holidayCards || requestCards || planningCards || rescheduleCards || finalizationSummary || finalizationQueue || deposits);
  const attention = hasAttention ? `${holidayCards}${requestCards}${planningCards}${rescheduleCards}${finalizationSummary}${finalizationQueue}${deposits}` : '';
  const carryOver = model.carryOver || [];
  const activity = (model.recentActivity || []).map((item) => activityItem(item, model)).join('') || '<div class="empty">No completed or no-show visits are recorded today yet.</div>';
  const attentionPanel = hasAttention ? `<section class="panel" data-dashboard-attention-panel><header class="panel-head"><div><span class="eyebrow">Action required</span><h2>Needs attention</h2></div>${attentionCount ? `<span class="summary-pill attention">${attentionCount}</span>` : ''}</header>${attention}</section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script><script src="${escapeHtml(dashboardScriptPath)}" defer></script></head><body data-workspace-dashboard="true" data-dashboard-mode="${escapeHtml(model.mode)}"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'dashboard', displayName: model.displayName, dashboardHref: '/calendar/workspace', calendarHref: '/calendar/read-only', ...navigation })}<div class="workspace-main"><main class="shell"><header class="topbar"><div class="brand"><h1>Welcome, ${escapeHtml(model.displayName)}</h1><p>${isBusinessOverview ? "Today's appointments and clinic activity." : 'Your clients and appointments for today.'}</p></div></header><div class="dashboard-grid" data-dashboard-grid><section class="panel hero-panel" data-dashboard-today><header class="panel-head"><div><span class="eyebrow">${nextOperationalDay ? 'Next operational day' : 'Today'}</span><h2>${heading}</h2><p class="truth-note">${escapeHtml(dashboardDateLabel(model.operationalDateKey))}</p><div class="day-summary"><span class="summary-pill">${model.appointments.length} ${model.appointments.length === 1 ? 'client' : 'clients'}</span>${attentionCount ? `<span class="summary-pill attention">${attentionCount} awaiting outcome</span>` : ''}</div></div><a data-workspace-action="secondary" class="button" href="${calendarHref(model)}">Open calendar</a></header>${closures}${scheduleBody(model)}<p class="operation-status" data-dashboard-operation-status aria-live="polite"></p></section><section class="panel carryover-panel" data-dashboard-carryover-panel><header class="panel-head"><div><span class="eyebrow">Carry-over</span><h2>Unfinished visits</h2><p class="truth-note">Past visits stay here until they are recorded as Completed or No-show.</p></div>${carryOver.length ? `<span class="summary-pill attention">${carryOver.length}</span>` : ''}</header>${carryOverBody(model)}</section>${attentionPanel}${outcomeDialog()}<section class="panel" data-dashboard-activity-panel><header class="panel-head"><div><span class="eyebrow">Appointment outcomes</span><h2>Recent activity</h2></div></header><div class="activity-list">${activity}</div></section></div></main></div></div></body></html>`;
}

function renderDashboardUnavailablePage({ message = 'Dashboard is unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'dashboard' })}<div class="workspace-main"><main class="shell"><section class="panel"><span class="eyebrow">Fail closed</span><h2>Dashboard unavailable</h2><p>${escapeHtml(message)}</p></section></main></div></div></body></html>`;
}

module.exports = {
  depositQueueContent,
  depositQueuePanel,
  depositQueueClientScript,
  timeOnly,
  dateGroupLabel,
  dashboardDateLabel,
  practitionerNames,
  statusPresentation,
  dashboardClientScript,
  planningRequestClientScript,
  formatRand,
  renderDashboardPage,
  renderDashboardUnavailablePage,
};
