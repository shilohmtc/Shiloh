const { escapeHtml } = require('./workspaceShell');
const { renderClientDetailPage } = require('./workspaceClientsUx');
const { decorateClientAppointmentHistory } = require('./calendarAppointmentDetailLinks');

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: 'Unknown date', time: '' };
  return {
    date: new Intl.DateTimeFormat('en-ZA', {
      timeZone: BUSINESS_TIMEZONE,
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat('en-ZA', {
      timeZone: BUSINESS_TIMEZONE,
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date),
  };
}

function renderClientNotificationActionSection(client, notificationActionAllowed = false) {
  const clientId = Number(client?.id);
  const href = Number.isSafeInteger(clientId) && clientId > 0
    ? `/calendar/clients/${encodeURIComponent(String(clientId))}/booking-confirmation`
    : null;
  const action = notificationActionAllowed && href
    ? `<a class="button primary" href="${escapeHtml(href)}">Preview booking confirmation</a>`
    : '<span class="truth-note">Additional capability required: client:notify</span>';
  const copy = notificationActionAllowed
    ? 'Preview the next eligible booking confirmation before any client-facing delivery. Final send authority is rechecked separately.'
    : 'Client lookup remains read-only for this principal. Sending requires the separate client:notify capability.';
  return `<section class="history-panel" data-client-notification-action style="margin-bottom:12px"><header class="section-heading"><div><span class="eyebrow">Client action</span><h2>Send booking confirmation</h2></div>${action}</header><p class="truth-note" style="line-height:1.55;margin:0">${escapeHtml(copy)}</p></section>`;
}

function renderCommunicationSection(communications = [], unavailable = false) {
  const rows = (Array.isArray(communications) ? communications : []).map(entry => {
    const when = formatDateTime(entry?.occurredAt);
    const context = entry?.appointmentId ? `Appointment #${entry.appointmentId}` : 'Client communication';
    const template = entry?.templateName
      ? `<small class="truth-note" style="display:block;margin-top:3px">Template: ${escapeHtml(entry.templateName)}</small>`
      : '';
    return `<article class="history-row" data-communication-intent="${escapeHtml(entry?.intent || 'notification')}"><div class="history-time"><strong>${escapeHtml(when.date)}</strong><small>${escapeHtml(when.time)}</small></div><div class="history-service">${escapeHtml(entry?.label || 'Shiloh notification')}${template}</div><div class="history-staff">${escapeHtml(context)}</div><span class="status-pill" style="max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:center">${escapeHtml(entry?.statusLabel || 'Recorded')}</span></article>`;
  }).join('');
  const body = unavailable
    ? '<div class="empty">Communication evidence is temporarily unavailable. No delivery claim is being made.</div>'
    : (rows || '<div class="empty">No recorded Shiloh notifications yet.</div>');

  return `<section class="history-panel" data-client-communications style="margin-bottom:12px"><header class="section-heading"><div><span class="eyebrow">Communications</span><h2>My Shiloh updates</h2></div><div class="detail-actions"><span class="truth-note">App availability does not confirm a phone alert or a read receipt</span><a class="button" href="/calendar/messages?view=recent">View all in Messages</a></div></header><div class="history-list">${body}</div></section>`;
}

function renderClientDetailPageWithCommunications(model, options = {}) {
  const base = decorateClientAppointmentHistory(
    renderClientDetailPage(model, options),
    model?.appointments || [],
  );
  const actionSection = ''; // Automated WhatsApp confirmation controls are retired.
  const communicationSection = renderCommunicationSection(model?.communications || [], model?.communicationsUnavailable === true);
  const marker = '<section class="history-panel">';
  if (!base.includes(marker)) return base;
  return base.replace(marker, `${actionSection}${communicationSection}${marker}`);
}

module.exports = {
  formatDateTime,
  renderClientNotificationActionSection,
  renderCommunicationSection,
  renderClientDetailPageWithCommunications,
};
