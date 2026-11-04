const { buildClientActivity } = require('../domain/workspaceClientActivity');
const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');
const { appointmentDetailHref } = require('./calendarAppointmentDetailLinks');
const { formatDateTime } = require('./workspaceClientNotificationsUx');

function callLink(mobile) {
  const value = String(mobile || '');
  return /^\+?[1-9]\d{7,14}$/.test(value)
    ? `<a data-workspace-action="secondary" class="button" href="tel:${escapeHtml(value.startsWith('+') ? value : '+' + value)}">Call</a>` : '';
}

function statusTone(status) {
  if (['failed', 'uncertain', 'unknown'].includes(String(status))) return ' attention';
  if (['available', 'read', 'delivered'].includes(String(status))) return ' complete';
  return '';
}

function baseStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--warn:#8a623d;--warn-soft:#f5eee5;--danger:#8f433d;--danger-soft:#f7e9e7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1180px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:14px}.topbar-side{display:grid;justify-items:end;gap:7px}.brand h1{margin:0;font-size:1.55rem}.brand p,.truth-note{margin:5px 0 0;color:var(--muted);font-size:.8rem;line-height:1.45}.signout-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid var(--line);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.76rem;font-weight:800;cursor:pointer}.tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}.tab,.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid var(--line);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.78rem;font-weight:800;text-decoration:none}.tab.active,.button.primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.layout{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.35fr);gap:12px}.layout.single-panel{grid-template-columns:minmax(0,1fr)}.panel{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:17px;padding:16px}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:start;margin-bottom:11px}.eyebrow{font-size:.67rem;text-transform:uppercase;letter-spacing:.1em;font-weight:850;color:var(--muted)}.panel h2{margin:3px 0 0;font-size:1.12rem}.list{display:grid;gap:8px}.item{min-width:0;border:1px solid var(--line);border-radius:12px;padding:11px;background:#fff}.item-head,.item-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:9px;flex-wrap:wrap}.item h3{margin:0;font-size:.9rem}.item p{margin:4px 0 0;color:var(--muted);font-size:.74rem;line-height:1.4}.explanations{display:grid;gap:7px;margin-top:10px;padding:9px 10px;border-radius:10px;background:var(--warn-soft)}.explanation{display:grid;grid-template-columns:68px minmax(0,1fr);gap:8px;font-size:.72rem;line-height:1.4}.explanation strong{color:var(--ink)}.explanation span{color:var(--muted)}.item-actions{align-items:center;margin-top:9px}.status{display:inline-flex;max-width:100%;border-radius:999px;padding:5px 8px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.68rem;font-weight:850;text-align:center}.status.attention{background:var(--warn-soft);color:var(--warn)}.status.complete{background:#e5efe9;color:#315b47}.activity-row{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(180px,1.2fr) auto;gap:10px;align-items:center}.activity-context{min-width:0}.activity-context strong,.activity-context span{display:block;overflow-wrap:anywhere}.activity-context span{margin-top:3px;color:var(--muted);font-size:.7rem}.empty{padding:24px 14px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);font-size:.78rem;line-height:1.5;text-align:center}.operation-status{min-height:1.2em;color:var(--muted);font-size:.76rem;margin:0 0 11px}@media(max-width:800px){.layout{grid-template-columns:1fr}.shell{padding:14px 12px 28px}.topbar{align-items:start;flex-direction:column;margin-bottom:42px}.tab,.button,.signout-button{min-height:44px}.activity-row{grid-template-columns:minmax(0,1fr) auto}.activity-row>.activity-context:nth-child(2){grid-column:1/-1;grid-row:2}.item-actions .button{flex:1 1 130px}}`;
}

function styles() {
  return `${baseStyles()}:root{--muted:#52645b}.activity-client{display:inline-flex;align-items:center;min-height:44px;color:var(--leaf-deep);text-underline-offset:3px}.needs-attention{border-left:3px solid var(--warn)}.attention-label{display:block;font-size:.7rem;font-weight:800;color:var(--warn);margin-bottom:8px}.attention-count{margin-left:7px}.panel>.truth-note{margin:0 0 8px}.app-availability{padding-top:9px;border-top:1px solid var(--line)}.brand .eyebrow{display:block;margin-bottom:5px}`;
}

function attentionItem(item, selectedView) {
  const appointment = item.appointment || {};
  const client = item.client || {};
  const confirmation = item.confirmation || {};
  const recover = item.canRecover
    ? `<button data-workspace-action="primary" class="button primary" type="button" data-booking-confirmation-recover data-appointment-id="${escapeHtml(appointment.id)}">${escapeHtml(item.actionLabel)}</button>`
    : '';
  const delivery = confirmation.deliveryExplanation || 'No additional safe delivery detail is available.';
  const recovery = item.recoveryExplanation
    || (item.canRecover ? 'Retry is available through Shiloh’s existing booking-confirmation channel.' : null)
    || item.reasonMessage
    || 'Recovery is not currently available.';
  const detailHref = appointment.startsAt ? appointmentDetailHref({ appointmentId: appointment.id, startsAt: appointment.startsAt }) : null;
  const returnTo = `/calendar/messages?view=${['all', 'attention', 'recent'].includes(selectedView) ? selectedView : 'all'}`;
  const calendar = detailHref ? `<a data-workspace-action="secondary" class="button" href="${escapeHtml(detailHref + '&returnTo=' + encodeURIComponent(returnTo))}">Open booking</a>` : '';
  return `<article class="item" data-message-attention="${escapeHtml(appointment.id)}"><header class="item-head"><div><h3>${escapeHtml(client.name || 'Unnamed client')}</h3><p>Appointment #${escapeHtml(appointment.id)} · ${escapeHtml(appointment.serviceName || 'Shiloh appointment')}</p></div><span class="status attention">${escapeHtml(confirmation.statusLabel || 'Unknown')}</span></header><p>Appointment: ${escapeHtml(formatDateTime(appointment.startsAt))}</p><div class="explanations">${item.canRecover ? `<div class="explanation"><strong>Delivery</strong><span>${escapeHtml(delivery)}</span></div><div class="explanation"><strong>Recovery</strong><span>${escapeHtml(recovery)}</span></div>` : `<p>${escapeHtml(delivery)}</p>`}</div><div class="item-actions">${calendar}<a data-workspace-action="secondary" class="button" href="/calendar/clients/${escapeHtml(client.id)}">Open client</a>${callLink(client.normalizedMobile)}${recover}</div></article>`;
}

function changeDeliveryItem(item, selectedView) {
  const detailHref = item.startsAt ? appointmentDetailHref({ appointmentId: item.appointmentId, startsAt: item.startsAt }) : null;
  const returnTo = `/calendar/messages?view=${['all', 'attention', 'recent'].includes(selectedView) ? selectedView : 'all'}`;
  const booking = detailHref ? `<a data-workspace-action="secondary" class="button" href="${escapeHtml(detailHref + '&returnTo=' + encodeURIComponent(returnTo))}">Open booking</a>` : '';
  return `<article class="item" data-change-delivery-attention="${escapeHtml(item.id)}"><header class="item-head"><div><h3>${escapeHtml(item.clientName)}</h3><p>Appointment #${escapeHtml(item.appointmentId)} · ${escapeHtml(item.label)}</p></div><span class="status attention">${escapeHtml(item.statusLabel)}</span></header><p>Update: ${escapeHtml(formatDateTime(item.updatedAt))}</p><div class="explanations">${['waiting', 'failed', 'uncertain'].includes(item.status) ? '<p>We can’t confirm the client was notified. Contact them if it’s urgent.</p>' : ''}${['failed', 'uncertain'].includes(item.status) ? `<p>${escapeHtml(item.nextAction)}</p>` : ''}</div><div class="item-actions">${booking}<a data-workspace-action="secondary" class="button" href="/calendar/clients/${escapeHtml(item.clientId)}">Open client</a>${callLink(item.normalizedMobile)}</div></article>`;
}

function activityItem(item) {
  const clientName = escapeHtml(item.clientName || 'Unnamed client');
  const clientLabel = Number.isSafeInteger(Number(item.clientId)) && Number(item.clientId) > 0 ? `<a href="/calendar/clients/${escapeHtml(item.clientId)}" class="activity-client">${clientName}</a>` : clientName;
  const context = item.appointmentId ? `Appointment #${item.appointmentId}` : 'Client communication';
  return `<article class="item activity-row" data-message-activity data-message-status="${escapeHtml(item.status || 'unknown')}"><div class="activity-context"><strong>${clientLabel}</strong><span>My Shiloh</span></div><div class="activity-context"><strong>${escapeHtml(item.label || 'Shiloh notification')}</strong><span>${escapeHtml(context)} · ${escapeHtml(formatDateTime(item.occurredAt))}</span></div><span class="status${statusTone(item.status)}">${escapeHtml(item.statusLabel || 'Unknown')}</span></article>`;
}

function renderMessagesPage(model, {
  staffAccessScriptPath = '/calendar/staff/client.js',
  actionScriptPath = '/calendar/operations/client.js',
  navigation = {},
} = {}) {
  const rows = buildClientActivity(model);
  const attentionCount = rows.filter(row => row.needsAttention).length;
  const visibleRows = model.selectedView === 'attention' ? rows.filter(row => row.needsAttention) : rows;
  const activityBody = visibleRows.map(row => {
    if (row.kind === 'activity') return activityItem(row.item);
    let html = row.kind === 'confirmation' ? attentionItem(row.item, model.selectedView) : changeDeliveryItem(row.item, model.selectedView);
    html = html.replace('class="item"', 'class="item needs-attention" data-needs-attention');
    const available = row.activity ? `<p class="app-availability">${escapeHtml(row.activity.statusLabel)} · ${escapeHtml(formatDateTime(row.activity.occurredAt))}</p>` : '';
    return html.replace('</article>', `${available}</article>`).replace('<header class="item-head">', '<span class="attention-label">Needs attention</span><header class="item-head">');
  }).join('');
  const notices = [
    model.attentionUnavailable ? 'Booking-confirmation attention is temporarily unavailable. The attention count may be incomplete.' : '',
    model.changeAttentionUnavailable ? 'Booking-change delivery evidence is temporarily unavailable. The attention count may be incomplete.' : '',
    model.activityUnavailable ? 'Recent activity is temporarily unavailable. No delivery claim is being made.' : '',
  ].filter(Boolean).map(note => `<p class="empty" role="status">${note}</p>`).join('');
  const incomplete = model.attentionUnavailable || model.changeAttentionUnavailable;
  const operationsScript = model.notificationAuthority ? `<script src="${escapeHtml(actionScriptPath)}" defer></script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client Directory · Activity — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script>${operationsScript}</head><body data-workspace-messages="true"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'messages', displayName: model.authority?.displayName, messagesHref: '/calendar/messages', ...navigation })}<div class="workspace-main"><main class="shell"><header class="topbar"><div class="brand"><span class="eyebrow">Client Directory</span><h1>Activity</h1><p>Client updates and follow-ups, together.</p></div></header><section class="panel" data-client-activity><header class="panel-head"><nav class="tabs" aria-label="Activity filter"><a class="tab${model.selectedView !== 'attention' ? ' active' : ''}" ${model.selectedView !== 'attention' ? 'aria-current="page"' : ''} href="/calendar/messages?view=all">All activity</a>${model.notificationAuthority ? `<a class="tab${model.selectedView === 'attention' ? ' active' : ''}" ${model.selectedView === 'attention' ? 'aria-current="page"' : ''} href="/calendar/messages?view=attention">Needs attention <span class="attention-count">${attentionCount}${incomplete ? '+' : ''}</span></a>` : ''}</nav></header><p class="truth-note">App availability does not confirm a phone alert or that an update was read.</p><p class="operation-status" role="status" aria-live="polite" data-calendar-operation-status>Unresolved follow-ups appear first, followed by recent updates.</p>${notices}<div class="list" data-activity-list>${activityBody || (notices ? '' : '<div class="empty">No updates in this view.</div>')}</div></section></main></div></div></body></html>`;
}

function renderMessagesUnavailablePage({ message = 'Activity is unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'messages' })}<div class="workspace-main"><main class="shell"><section class="panel"><span class="eyebrow">Unavailable</span><h2>Activity unavailable</h2><p>${escapeHtml(message)}</p></section></main></div></div></body></html>`;
}

module.exports = { statusTone, renderMessagesPage, renderMessagesUnavailablePage };
