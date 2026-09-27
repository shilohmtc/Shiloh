const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');
const { formatDateTime } = require('./workspaceClientNotificationsUx');

function statusTone(status) {
  if (['failed', 'uncertain', 'unknown'].includes(String(status))) return ' attention';
  if (['read', 'delivered'].includes(String(status))) return ' complete';
  return '';
}

function baseStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--warn:#8a623d;--warn-soft:#f5eee5;--danger:#8f433d;--danger-soft:#f7e9e7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1180px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:14px}.topbar-side{display:grid;justify-items:end;gap:7px}.brand h1{margin:0;font-size:1.55rem}.brand p,.truth-note{margin:5px 0 0;color:var(--muted);font-size:.8rem;line-height:1.45}.signout-button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;border:1px solid var(--line);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.76rem;font-weight:800;cursor:pointer}.tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}.tab,.button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;border:1px solid var(--line);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.78rem;font-weight:800;text-decoration:none}.tab.active,.button.primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.layout{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.35fr);gap:12px}.panel{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:17px;padding:16px}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:start;margin-bottom:11px}.eyebrow{font-size:.67rem;text-transform:uppercase;letter-spacing:.1em;font-weight:850;color:var(--muted)}.panel h2{margin:3px 0 0;font-size:1.12rem}.list{display:grid;gap:8px}.item{min-width:0;border:1px solid var(--line);border-radius:12px;padding:11px;background:#fff}.item-head,.item-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:9px;flex-wrap:wrap}.item h3{margin:0;font-size:.9rem}.item p{margin:4px 0 0;color:var(--muted);font-size:.74rem;line-height:1.4}.explanations{display:grid;gap:7px;margin-top:10px;padding:9px 10px;border-radius:10px;background:var(--warn-soft)}.explanation{display:grid;grid-template-columns:68px minmax(0,1fr);gap:8px;font-size:.72rem;line-height:1.4}.explanation strong{color:var(--ink)}.explanation span{color:var(--muted)}.item-actions{align-items:center;margin-top:9px}.status{display:inline-flex;max-width:100%;border-radius:999px;padding:5px 8px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.68rem;font-weight:850;text-align:center}.status.attention{background:var(--warn-soft);color:var(--warn)}.status.complete{background:#e5efe9;color:#315b47}.activity-row{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(180px,1.2fr) auto;gap:10px;align-items:center}.activity-context{min-width:0}.activity-context strong,.activity-context span{display:block;overflow-wrap:anywhere}.activity-context span{margin-top:3px;color:var(--muted);font-size:.7rem}.empty{padding:24px 14px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);font-size:.78rem;line-height:1.5;text-align:center}.operation-status{min-height:1.2em;color:var(--muted);font-size:.76rem;margin:0 0 11px}@media(max-width:800px){.layout{grid-template-columns:1fr}.shell{padding:14px 12px 28px}.topbar{align-items:start;flex-direction:column;margin-bottom:42px}.tab,.button,.signout-button{min-height:44px}.activity-row{grid-template-columns:minmax(0,1fr) auto}.activity-row>.activity-context:nth-child(2){grid-column:1/-1;grid-row:2}.item-actions .button{flex:1 1 130px}}`;
}

function styles() {
  return `${baseStyles()}:root{--muted:#52645b}`;
}

function attentionItem(item) {
  const appointment = item.appointment || {};
  const client = item.client || {};
  const confirmation = item.confirmation || {};
  const recover = item.canRecover
    ? `<button class="button primary" type="button" data-booking-confirmation-recover data-appointment-id="${escapeHtml(appointment.id)}">${escapeHtml(item.actionLabel)}</button>`
    : '';
  const delivery = confirmation.deliveryExplanation || 'No additional safe delivery detail is available.';
  const recovery = item.recoveryExplanation
    || (item.canRecover ? 'Retry is available through Shiloh’s existing booking-confirmation channel.' : null)
    || item.reasonMessage
    || 'Recovery is not currently available.';
  return `<article class="item" data-message-attention="${escapeHtml(appointment.id)}"><header class="item-head"><div><h3>${escapeHtml(client.name || 'Unnamed client')}</h3><p>Appointment #${escapeHtml(appointment.id)} · ${escapeHtml(appointment.serviceName || 'Shiloh appointment')}</p></div><span class="status attention">${escapeHtml(confirmation.statusLabel || 'Unknown')}</span></header><p>${escapeHtml(formatDateTime(appointment.startsAt))} · WhatsApp ending ${escapeHtml(client.mobileLast4 || '—')}</p><div class="explanations"><div class="explanation"><strong>Delivery</strong><span>${escapeHtml(delivery)}</span></div><div class="explanation"><strong>Recovery</strong><span>${escapeHtml(recovery)}</span></div></div><div class="item-actions"><a class="button" href="/calendar/clients/${escapeHtml(client.id)}">Client</a><a class="button" href="/calendar/read-only?view=day&amp;date=${escapeHtml(String(appointment.startsAt || '').slice(0, 10))}">Calendar</a>${recover}</div></article>`;
}

function changeDeliveryItem(item) {
  return `<article class="item" data-change-delivery-attention="${escapeHtml(item.id)}"><header class="item-head"><div><h3>${escapeHtml(item.clientName)}</h3><p>Appointment #${escapeHtml(item.appointmentId)} · ${escapeHtml(item.label)}</p></div><span class="status attention">${escapeHtml(item.statusLabel)}</span></header><p>${escapeHtml(formatDateTime(item.updatedAt))}</p><div class="explanations"><div class="explanation"><strong>Next step</strong><span>${escapeHtml(item.nextAction)}</span></div></div><div class="item-actions"><a class="button" href="/calendar/clients/${escapeHtml(item.clientId)}">Review client</a></div></article>`;
}

function activityItem(item) {
  const context = item.appointmentId ? `Appointment #${item.appointmentId}` : 'Client communication';
  return `<article class="item activity-row" data-message-activity data-message-status="${escapeHtml(item.status || 'unknown')}"><div class="activity-context"><strong>${escapeHtml(item.clientName || 'Unnamed client')}</strong><span>WhatsApp ending ${escapeHtml(item.mobileLast4 || '—')}</span></div><div class="activity-context"><strong>${escapeHtml(item.label || 'Shiloh notification')}</strong><span>${escapeHtml(context)} · ${escapeHtml(formatDateTime(item.occurredAt))}</span></div><span class="status${statusTone(item.status)}">${escapeHtml(item.statusLabel || 'Unknown')}</span></article>`;
}

function renderMessagesPage(model, {
  staffAccessScriptPath = '/calendar/staff/client.js',
  actionScriptPath = '/calendar/operations/client.js',
  navigation = {},
} = {}) {
  const showAttention = model.selectedView !== 'recent';
  const showRecent = model.selectedView !== 'attention';
  let attentionBody = model.attentionUnavailable
    ? '<div class="empty">Communication attention is temporarily unavailable. No recovery or delivery claim is being made.</div>'
    : !model.notificationAuthority
      ? '<div class="empty">Recovery actions are not available with your current access.</div>'
      : (model.attention || []).map(attentionItem).join('') || '<div class="empty">No booking-confirmation exceptions currently need attention.</div>';
  const changeBody = model.notificationAuthority
    ? model.changeAttentionUnavailable
      ? '<div class="empty">Booking-change delivery evidence is temporarily unavailable. Review the client record before any resend.</div>'
      : (model.changeAttention || []).map(changeDeliveryItem).join('')
    : '';
  if (changeBody && !model.attentionUnavailable && model.notificationAuthority && !(model.attention || []).length) attentionBody = '';
  const activityBody = model.activityUnavailable
    ? '<div class="empty">Communication evidence is temporarily unavailable. No delivery claim is being made.</div>'
    : (model.activity || []).map(activityItem).join('') || '<div class="empty">No communication activity is recorded yet.</div>';
  const operationsScript = model.notificationAuthority ? `<script src="${escapeHtml(actionScriptPath)}" defer></script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Messages — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script>${operationsScript}</head><body data-workspace-messages="true"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'messages', displayName: model.authority?.displayName, messagesHref: '/calendar/messages', ...navigation })}<div class="workspace-main"><main class="shell"><header class="topbar"><div class="brand"><h1>Messages</h1><p>Client communication activity and items needing attention.</p></div><div class="topbar-side"><span class="truth-note">Delivery status is shown only when it has been recorded.</span></div></header><nav class="tabs" aria-label="Messages view"><a class="tab${model.selectedView === 'all' ? ' active' : ''}" href="/calendar/messages?view=all">All</a><a class="tab${model.selectedView === 'attention' ? ' active' : ''}" href="/calendar/messages?view=attention">Needs attention</a><a class="tab${model.selectedView === 'recent' ? ' active' : ''}" href="/calendar/messages?view=recent">Recent activity</a></nav><p class="operation-status" role="status" aria-live="polite" data-calendar-operation-status>Actions are checked again before any client message is sent.</p><div class="layout">${showAttention ? `<section class="panel" data-messages-attention><header class="panel-head"><div><span class="eyebrow">Action</span><h2>Needs attention</h2></div></header><div class="list">${attentionBody}${changeBody}</div></section>` : ''}${showRecent ? `<section class="panel" data-messages-recent><header class="panel-head"><div><span class="eyebrow">Activity</span><h2>Recent activity</h2></div></header><div class="list">${activityBody}</div></section>` : ''}</div></main></div></div></body></html>`;
}

function renderMessagesUnavailablePage({ message = 'Messages are unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Messages unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'messages' })}<div class="workspace-main"><main class="shell"><section class="panel"><span class="eyebrow">Unavailable</span><h2>Messages unavailable</h2><p>${escapeHtml(message)}</p></section></main></div></div></body></html>`;
}

module.exports = { statusTone, renderMessagesPage, renderMessagesUnavailablePage };
