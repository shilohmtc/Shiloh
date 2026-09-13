const { escapeHtml, workspaceShellStyles, renderWorkspaceNavigation } = require('./workspaceShell');

function baseStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#56685f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--warn:#79522f;--warn-soft:#f5eee5;--danger:#7d3934;--danger-soft:#f7e9e6}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1440px;margin:0 auto;padding:22px 24px 40px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:16px}.topbar-side{display:grid;justify-items:end;gap:7px}.brand h1{margin:0;font-size:clamp(1.45rem,2vw,1.85rem);letter-spacing:-.025em}.brand p,.truth-note{margin:5px 0 0;color:var(--muted);font-size:.8rem;line-height:1.45}.signout-button,.button,.action-button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border:1px solid var(--line);border-radius:9px;padding:7px 11px;background:#fff;color:var(--ink);font:inherit;font-size:.74rem;font-weight:800;cursor:pointer;text-decoration:none}.dashboard-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-flow:row;gap:12px;align-items:start}.dashboard-grid>[data-dashboard-today]{grid-column:1/5;grid-row:1/4}.dashboard-grid>[data-dashboard-carryover-panel]{grid-column:5/7;grid-row:1}.dashboard-grid>[data-dashboard-attention-panel]{grid-column:5/7;grid-row:2}.dashboard-grid>[data-dashboard-communications-panel]{grid-column:5/7;grid-row:3}.dashboard-grid>[data-dashboard-activity-panel]{grid-column:1/5;grid-row:4}.panel{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:15px}.hero-panel{border-color:#d2ddd5;box-shadow:0 10px 32px rgba(32,50,43,.065)}.carryover-panel{display:flex;flex-direction:column;box-shadow:0 6px 22px rgba(32,50,43,.035)}.carryover-scroll{min-height:0}.carryover-schedule{gap:10px}.carryover-group{padding:9px}.carryover-group>.team-head{margin:-2px -1px 7px;padding:4px 1px 7px;border-bottom:1px solid rgba(220,227,221,.78)}.carryover-group .appointment{padding:9px}.carryover-group .appointment-main{grid-template-columns:52px minmax(0,1fr) auto;gap:7px}.carryover-group .appointment-actions{display:grid;grid-template-columns:1fr 1fr auto;gap:5px}.carryover-group .appointment-actions .action-button,.carryover-group .appointment-actions .button{min-height:34px;padding:5px 8px;border-radius:8px;font-size:.7rem}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:11px}.eyebrow{font-size:.66rem;text-transform:uppercase;letter-spacing:.11em;font-weight:850;color:var(--muted)}.panel h2,.team-head h3{margin:3px 0 0;font-size:1.08rem}.day-summary{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.summary-pill,.status-pill{display:inline-flex;border-radius:999px;padding:5px 8px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.72rem;font-weight:850}.summary-pill.attention,.status-pill.pending{background:var(--warn-soft);color:var(--warn)}.status-pill.no-show{background:var(--danger-soft);color:var(--danger)}.schedule{display:grid;gap:8px}.team-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.team-group{min-width:0;border:1px solid var(--line);border-radius:13px;padding:10px;background:#fafbf8}.team-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.team-head h3{font-size:.9rem}.appointment,.booking-request{min-width:0;border:1px solid var(--line);border-radius:11px;padding:10px;background:#fff}.appointment+.appointment,.booking-request+.booking-request{margin-top:7px}.appointment-main{display:grid;grid-template-columns:58px minmax(0,1fr) auto;gap:9px;align-items:start}.appointment-time{font-size:.74rem;font-weight:900;color:var(--leaf-deep);padding-top:2px}.appointment-copy{min-width:0}.appointment-copy strong,.appointment-copy span{display:block;overflow-wrap:anywhere}.appointment-copy span{margin-top:3px;color:var(--muted);font-size:.72rem;line-height:1.35}.appointment-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-top:6px}.appointment-actions>.button:only-child{min-height:32px;padding:4px 8px;font-size:.68rem}.request-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}.action-button{min-height:36px;border-radius:8px;padding:6px 10px}.action-button.complete{border-color:var(--leaf);color:var(--leaf-deep);background:var(--leaf-soft)}.action-button.no-show,.action-button.cannot{color:var(--danger)}.action-button:disabled{opacity:.5;cursor:wait}.proposal-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.proposal-field{display:grid;gap:4px;min-width:0;color:var(--muted);font-size:.7rem;font-weight:800}.proposal-fields input,.proposal-fields select{width:100%;min-width:0;min-height:40px;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff;color:var(--ink);font:inherit}.proposal-fields>.action-button{align-self:end}.request-operation-status{grid-column:1/-1;margin:0}.request-note{margin:7px 0 0;color:var(--muted);font-size:.72rem;line-height:1.4}.attention-summary{padding:12px;border-radius:11px;background:var(--warn-soft);color:var(--warn);font-size:.76rem;line-height:1.45}.attention-queue{display:grid;gap:7px;margin-top:8px}.activity-list,.communication-list{display:grid;gap:7px}.activity-item,.communication-item{display:flex;justify-content:space-between;gap:10px;align-items:center;border-top:1px solid var(--line);padding-top:8px;font-size:.74rem}.activity-item:first-child,.communication-item:first-child{border-top:0;padding-top:0}.activity-item strong,.communication-item strong{display:block}.activity-item span,.communication-item span{color:var(--muted);font-size:.7rem}.empty{padding:18px 12px;border:1px dashed var(--line);border-radius:11px;color:var(--muted);font-size:.76rem;line-height:1.5;text-align:center}.closure{padding:10px 11px;margin-bottom:9px;border-radius:11px;background:var(--warn-soft);color:var(--warn);font-size:.74rem;font-weight:800}.operation-status{min-height:18px;margin:8px 0 0;color:var(--muted);font-size:.72rem}.operation-status[data-tone="error"]{color:var(--danger)}@media(min-width:1180px){.team-groups{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:1050px) and (min-width:851px){.dashboard-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-grid>[data-dashboard-today],.dashboard-grid>[data-dashboard-carryover-panel],.dashboard-grid>[data-dashboard-attention-panel],.dashboard-grid>[data-dashboard-activity-panel]{grid-column:auto;grid-row:auto}.dashboard-grid>[data-dashboard-communications-panel]{grid-column:1/-1;grid-row:auto}}@media(max-width:850px){.dashboard-grid{grid-template-columns:1fr}.dashboard-grid>[data-dashboard-attention-panel]{grid-column:1;grid-row:1}.dashboard-grid>[data-dashboard-today]{grid-column:1;grid-row:2}.dashboard-grid>[data-dashboard-carryover-panel]{grid-column:1;grid-row:3}.dashboard-grid>[data-dashboard-communications-panel]{grid-column:1;grid-row:4}.dashboard-grid>[data-dashboard-activity-panel]{grid-column:1;grid-row:5}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-today]{grid-row:1}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-carryover-panel]{grid-row:2}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-communications-panel]{grid-row:3}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-activity-panel]{grid-row:4}.shell{padding:13px 11px 28px}.topbar{align-items:start;flex-direction:column;padding-left:52px;min-height:44px}.topbar-side{justify-items:start}.panel{padding:13px;border-radius:14px}.button,.signout-button,.action-button,.carryover-group .appointment-actions .action-button,.carryover-group .appointment-actions .button{min-height:44px}.appointment-main,.carryover-group .appointment-main{grid-template-columns:58px minmax(0,1fr)}.appointment-main>.status-pill{grid-column:2;justify-self:start}.appointment-actions,.carryover-group .appointment-actions{display:grid;grid-template-columns:1fr 1fr}.appointment-actions .button,.carryover-group .appointment-actions .button{grid-column:1/-1}.request-actions,.proposal-fields{display:grid;grid-template-columns:1fr}.team-groups{grid-template-columns:1fr}.team-group,.carryover-group{padding:9px}.brand p{max-width:34rem}}`;
}

function styles() {
  return `${baseStyles()}@media(min-width:1051px){.workspace-main .shell{display:flex;min-height:100vh;flex-direction:column}.dashboard-grid{flex:1;grid-template-rows:auto auto minmax(0,1fr);align-items:stretch}.dashboard-grid>.panel{align-self:stretch}.dashboard-grid>[data-dashboard-today]{grid-row:1}.dashboard-grid>[data-dashboard-activity-panel]{grid-row:2/4}.dashboard-grid:not(:has([data-dashboard-attention-panel])){grid-template-rows:auto minmax(0,1fr)}.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-communications-panel],.dashboard-grid:not(:has([data-dashboard-attention-panel]))>[data-dashboard-activity-panel]{grid-row:2}.team-groups .appointment-main{grid-template-columns:50px minmax(0,1fr)}.team-groups .appointment-main>.status-pill{grid-column:2;justify-self:start}}@media(max-width:1050px) and (min-width:851px){.dashboard-grid>[data-dashboard-today] .team-groups{grid-template-columns:minmax(0,1fr)}}@media(max-width:850px){.dashboard-grid{grid-template-columns:minmax(0,1fr)}.dashboard-grid,.panel,.panel-head>*{min-width:0;max-width:100%}.panel-head{flex-wrap:wrap}.appointment-actions,.carryover-group .appointment-actions{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.attention-summary{max-width:100%;overflow-wrap:anywhere}}`;
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
  return `/calendar/read-only?view=day&amp;date=${escapeHtml(dateKey)}${['owner_overview', 'business_overview'].includes(model.mode) ? '&amp;staff=all' : ''}`;
}

function appointmentItem(item, model, { manageLabel = 'Open / manage', idPrefix = 'dashboard-appointment', attention = false } = {}) {
  const status = statusPresentation(item.status);
  const itemDateKey = item.operationalDateKey || model.operationalDateKey;
  const carryOver = itemDateKey !== model.operationalDateKey;
  const manageAction = `<a class="button" href="${calendarHref(model, itemDateKey)}">${escapeHtml(manageLabel)}</a>`;
  const finalizeAttribute = attention ? 'data-dashboard-attention-finalize' : 'data-dashboard-finalize';
  const appointmentAttribute = attention ? 'data-dashboard-attention-appointment' : 'data-dashboard-appointment';
  const actions = item.canFinalize ? `<div class="appointment-actions" data-dashboard-finalization-actions><button type="button" class="action-button complete" ${finalizeAttribute}="completed">Completed</button><button type="button" class="action-button no-show" ${finalizeAttribute}="no_show">No-show</button>${manageAction}</div>` : `<div class="appointment-actions">${manageAction}</div>`;
  const detail = `${item.serviceName || 'Shiloh appointment'} · ${practitionerNames(item, model.calendar)}`;
  return `<article class="appointment${carryOver ? ' carryover-card' : ''}" id="${escapeHtml(idPrefix)}-${escapeHtml(item.id)}" ${appointmentAttribute}="${escapeHtml(item.id)}" data-revision="${escapeHtml(item.revision || '')}" data-operational-date-key="${escapeHtml(itemDateKey)}"><div class="appointment-main"><span class="appointment-time">${escapeHtml(timeOnly(item.startsAt))}</span><div class="appointment-copy"><strong>${escapeHtml(item.clientName || 'Client')}</strong><span>${escapeHtml(detail)}</span></div><span class="status-pill${status.className}">${escapeHtml(status.label)}</span></div>${actions}</article>`;
}

function activityItem(item, model) {
  const status = statusPresentation(item.status);
  return `<div class="activity-item" data-dashboard-activity><div><strong>${escapeHtml(item.clientName || 'Client')}</strong><span>${escapeHtml(timeOnly(item.endsAt))} · ${escapeHtml(practitionerNames(item, model.calendar))}</span></div><span class="status-pill${status.className}">${escapeHtml(status.label)}</span></div>`;
}

function communicationItem(item) {
  return `<div class="communication-item" data-dashboard-communication-attention><div><strong>${escapeHtml(item.client?.name || 'Client')}</strong><span>Client notification needs attention · appointment #${escapeHtml(item.appointment?.id || '')}</span></div><a class="button" href="/calendar/messages?view=attention">Review</a></div>`;
}

function bookingRequestItem(item, model) {
  const awaiting = item.effectiveStatus === 'awaiting_client_confirmation';
  const status = awaiting ? 'Awaiting client' : 'Needs staff resolution';
  const staffPicker = ['owner_overview', 'business_overview'].includes(model.mode)
    ? `<label class="proposal-field"><span>Alternative practitioner</span><select data-proposal-staff><option value="">Current practitioner</option>${(model.calendar.timeline?.staff || []).map(person => `<option value="${escapeHtml(person.id)}"${Number(person.id) === Number(item.proposedStaffId || 0) ? ' selected' : ''}>${escapeHtml(person.displayName)}</option>`).join('')}</select></label>`
    : '';
  const proposal = awaiting ? `<p class="request-note">Proposed ${escapeHtml(dateTimeLabel(item.proposedStartsAt))} with ${escapeHtml(item.proposedStaffName || item.staffName)}. The client must accept before confirmation.</p>` : '';
  return `<article class="booking-request" id="booking-request-${escapeHtml(item.appointmentId)}" data-booking-request="${escapeHtml(item.appointmentId)}" data-requested-revision="${escapeHtml(item.requestedRevision || '')}"><div class="appointment-main"><span class="appointment-time">${escapeHtml(dateTimeLabel(item.requestedStartsAt))}</span><div class="appointment-copy"><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.serviceName)} · ${escapeHtml(item.staffName)}</span></div><span class="status-pill pending">${escapeHtml(status)}</span></div>${proposal}<div class="request-actions"><button class="action-button complete" type="button" data-booking-action="accept"${awaiting ? ' disabled' : ''}>Accept requested appointment</button><button class="action-button cannot" type="button" data-booking-action="cannot_accommodate">Cannot accommodate</button></div><div class="proposal-fields"><label class="proposal-field"><span>Alternative date</span><input type="date" data-proposal-date></label><label class="proposal-field"><span>Alternative time</span><input type="time" step="900" data-proposal-time></label>${staffPicker}<button class="action-button" type="button" data-booking-action="propose">Propose alternative</button><p class="operation-status request-operation-status" data-booking-request-status aria-live="polite"></p></div></article>`;
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

function dashboardClientScript() {
  return `(function(){'use strict';var AUTH='/calendar/staff-auth';var API='/calendar/workspace';function one(s,r){return(r||document).querySelector(s);}function all(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}async function json(r){try{return await r.json();}catch(_e){return{};}}function status(message,tone,target){target=target||one('[data-dashboard-operation-status]');if(!target)return;target.textContent=String(message||'');target.dataset.tone=tone||'ready';}async function csrf(){var r=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});var b=await json(r);if(!r.ok||!b.csrfToken)throw new Error('Your secure Shiloh session has expired.');return b.csrfToken;}async function post(path,payload){var token=await csrf();var response=await fetch(API+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify(payload||{})});token='';var body=await json(response);if(!response.ok)throw new Error(body.error||'Nothing was changed.');return body;}document.addEventListener('click',async function(event){var bookingButton=event.target.closest('[data-booking-action]');if(bookingButton){var request=bookingButton.closest('[data-booking-request]');if(!request)return;var action=bookingButton.dataset.bookingAction;var requestStatus=one('[data-booking-request-status]',request);var payload={expectedRevision:request.dataset.requestedRevision};if(action==='propose'){var dateInput=one('[data-proposal-date]',request);var timeInput=one('[data-proposal-time]',request);var date=String(dateInput&&dateInput.value||'');var time=String(timeInput&&timeInput.value||'');if(!date&&!time){status('Choose an alternative date and time.','error',requestStatus);return;}if(!date){status('Choose an alternative date.','error',requestStatus);return;}if(!time){status('Choose an alternative time.','error',requestStatus);return;}if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time)){status('Choose a valid alternative date and time.','error',requestStatus);return;}var candidate=new Date(date+'T'+time+':00+02:00');if(Number.isNaN(candidate.getTime())){status('Choose a valid alternative date and time.','error',requestStatus);return;}payload.startsAt=candidate.toISOString();var staff=one('[data-proposal-staff]',request);if(staff&&staff.value)payload.staffId=Number(staff.value);}if(action==='cannot_accommodate'&&!window.confirm('Cannot accommodate this request? The held appointment will be cancelled.'))return;var controls=all('button,input,select',request);var disabled=controls.map(function(item){return item.disabled;});controls.forEach(function(item){item.disabled=true;});status(action==='propose'?'Checking this alternative…':'Resolving booking request…','working',requestStatus);try{await post('/booking-requests/'+encodeURIComponent(request.dataset.bookingRequest)+'/'+encodeURIComponent(action),payload);status(action==='propose'?'Alternative sent to the client.':'Booking request resolved.','ready',requestStatus);window.setTimeout(function(){window.location.reload();},500);}catch(error){status(error.message||'No booking-request change was made.','error',requestStatus);controls.forEach(function(item,index){item.disabled=disabled[index];});}return;}var button=event.target.closest('[data-dashboard-finalize],[data-dashboard-attention-finalize]');if(!button)return;var card=button.closest('[data-dashboard-appointment],[data-dashboard-attention-appointment]');if(!card)return;var outcome=button.dataset.dashboardFinalize||button.dataset.dashboardAttentionFinalize;var appointmentId=card.dataset.dashboardAppointment||card.dataset.dashboardAttentionAppointment;var label=outcome==='no_show'?'No-show':'Completed';if(!window.confirm('Record this visit as '+label+'? This updates the appointment outcome.'))return;all('button',card).forEach(function(item){item.disabled=true;});status('Checking the latest appointment details…','working');try{await post('/appointments/'+encodeURIComponent(appointmentId)+'/finalize',{expectedRevision:card.dataset.revision,outcome:outcome,operationalDateKey:card.dataset.operationalDateKey});status('Visit outcome recorded. Refreshing Dashboard…','ready');window.setTimeout(function(){window.location.reload();},500);}catch(error){status(error.message||'Nothing was changed. Refresh and retry.','error');all('button',card).forEach(function(item){item.disabled=false;});}});})();`;
}

function renderDashboardPage(model, { staffAccessScriptPath = '/calendar/staff/client.js', dashboardScriptPath = '/calendar/workspace/client.js', navigation = {} } = {}) {
  const nextOperationalDay = model.requestedDateKey !== model.operationalDateKey;
  const isBusinessOverview = ['owner_overview', 'business_overview'].includes(model.mode);
  const heading = isBusinessOverview ? 'Today across the team' : 'My day';
  const closures = (model.closures || []).map((item) => `<div class="closure">Closed · ${escapeHtml(item.reason || 'Clinic closure')}</div>`).join('');
  const bookingRequests = model.bookingRequests || [];
  const awaitingFinalization = model.awaitingFinalization || [];
  const attentionCount = awaitingFinalization.length + bookingRequests.length;
  const actionableCount = awaitingFinalization.filter((item) => item.canFinalize).length;
  const requestCards = bookingRequests.map(item => bookingRequestItem(item, model)).join('');
  const finalizationCount = awaitingFinalization.length;
  const finalizationSummary = finalizationCount ? `<div class="attention-summary"><strong>${finalizationCount} ${finalizationCount === 1 ? 'visit is' : 'visits are'} awaiting practitioner finalization.</strong><br>${model.canFinalizeAllBusiness ? 'Authorized all-business backup actions are available below.' : isBusinessOverview ? 'Assigned practitioners finalize their own visits; review the exact visit below.' : actionableCount === finalizationCount ? 'Record Completed or No-show directly below.' : `${actionableCount} can be finalized here; shared visits must be completed by their assigned practitioner.`}</div>` : '';
  const finalizationCards = awaitingFinalization.map(item => appointmentItem(item, model, { manageLabel: 'Review visit', idPrefix: 'dashboard-attention-appointment', attention: true })).join('');
  const finalizationQueue = finalizationCards ? `<div class="attention-queue" data-dashboard-attention-queue>${finalizationCards}</div>` : '';
  const hasAttention = Boolean(requestCards || finalizationSummary || finalizationQueue);
  const attention = hasAttention ? `${requestCards}${finalizationSummary}${finalizationQueue}` : '';
  const carryOver = model.carryOver || [];
  const activity = (model.recentActivity || []).map((item) => activityItem(item, model)).join('') || '<div class="empty">No completed or no-show visits are recorded today yet.</div>';
  let communications = '<div class="empty">No client-notification issue is currently available in this access.</div>';
  if (model.communicationsUnavailable || model.communications?.attentionUnavailable) communications = '<div class="empty">Client-notification evidence is temporarily unavailable. No delivery claim is being made.</div>';
  else if (model.communications) communications = (model.communications.attention || []).slice(0, 3).map(communicationItem).join('') || '<div class="empty">No client notification currently needs attention.</div>';
  const attentionPanel = hasAttention ? `<section class="panel" data-dashboard-attention-panel><header class="panel-head"><div><span class="eyebrow">Action required</span><h2>Needs attention</h2></div><span class="summary-pill attention">${attentionCount}</span></header>${attention}</section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script><script src="${escapeHtml(dashboardScriptPath)}" defer></script></head><body data-workspace-dashboard="true" data-dashboard-mode="${escapeHtml(model.mode)}"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'dashboard', displayName: model.displayName, dashboardHref: '/calendar/workspace', calendarHref: '/calendar/read-only', ...navigation })}<div class="workspace-main"><main class="shell"><header class="topbar"><div class="brand"><h1>Welcome, ${escapeHtml(model.displayName)}</h1><p>${isBusinessOverview ? "Today's appointments and clinic activity." : 'Your clients and appointments for today.'}</p></div></header><div class="dashboard-grid" data-dashboard-grid><section class="panel hero-panel" data-dashboard-today><header class="panel-head"><div><span class="eyebrow">${nextOperationalDay ? 'Next operational day' : 'Today'}</span><h2>${heading}</h2><p class="truth-note">${escapeHtml(dashboardDateLabel(model.operationalDateKey))}</p><div class="day-summary"><span class="summary-pill">${model.appointments.length} ${model.appointments.length === 1 ? 'client' : 'clients'}</span>${attentionCount ? `<span class="summary-pill attention">${attentionCount} awaiting outcome</span>` : ''}</div></div><a class="button" href="${calendarHref(model)}">Open calendar</a></header>${closures}${scheduleBody(model)}<p class="operation-status" data-dashboard-operation-status aria-live="polite"></p></section><section class="panel carryover-panel" data-dashboard-carryover-panel><header class="panel-head"><div><span class="eyebrow">Carry-over</span><h2>Unfinished visits</h2><p class="truth-note">Past visits stay here until they are recorded as Completed or No-show.</p></div>${carryOver.length ? `<span class="summary-pill attention">${carryOver.length}</span>` : ''}</header>${carryOverBody(model)}</section>${attentionPanel}<section class="panel" data-dashboard-communications-panel><header class="panel-head"><div><span class="eyebrow">Communication</span><h2>Notifications</h2></div>${model.communications ? '<a class="button" href="/calendar/messages?view=attention">View messages</a>' : ''}</header><div class="communication-list">${communications}</div></section><section class="panel" data-dashboard-activity-panel><header class="panel-head"><div><span class="eyebrow">Appointment outcomes</span><h2>Recent activity</h2></div></header><div class="activity-list">${activity}</div></section></div></main></div></div></body></html>`;
}

function renderDashboardUnavailablePage({ message = 'Dashboard is unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'dashboard' })}<div class="workspace-main"><main class="shell"><section class="panel"><span class="eyebrow">Fail closed</span><h2>Dashboard unavailable</h2><p>${escapeHtml(message)}</p></section></main></div></div></body></html>`;
}

module.exports = {
  timeOnly,
  dateGroupLabel,
  dashboardDateLabel,
  practitionerNames,
  statusPresentation,
  dashboardClientScript,
  renderDashboardPage,
  renderDashboardUnavailablePage,
};
