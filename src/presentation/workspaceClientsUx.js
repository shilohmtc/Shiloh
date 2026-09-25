const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';

function baseStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--archived:#806c60;--archived-soft:#f0ebe7;--danger:#8a4138;--danger-soft:#f5ebe6;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1240px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:16px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem}.topbar-side{display:grid;justify-items:end;gap:7px}.truth-note,.access-status{font-size:.74rem;color:var(--muted)}.signout-button,.button,.pager-link{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.8rem;font-weight:750;text-decoration:none}.button.primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.signout-button{cursor:pointer}.search-panel,.profile-panel,.history-panel{background:var(--panel);border:1px solid var(--line);border-radius:17px;box-shadow:var(--shadow)}.search-panel{padding:13px;margin-bottom:12px}.search-form{display:grid;grid-template-columns:minmax(220px,1fr) 160px auto;gap:9px;align-items:end}.field{display:grid;gap:5px}.field label,.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted)}.field input,.field select{width:100%;min-height:42px;border:1px solid var(--line-strong);border-radius:10px;padding:9px 11px;background:#fff;color:var(--ink);font:inherit}.field input:focus,.field select:focus{outline:2px solid var(--leaf-soft);border-color:var(--leaf)}.result-summary{display:flex;justify-content:space-between;gap:14px;align-items:center;margin:0 2px 9px;color:var(--muted);font-size:.78rem}.client-list{display:grid;gap:6px}.client-row{display:grid;grid-template-columns:minmax(190px,1.4fr) minmax(150px,.8fr) 120px 160px 26px;gap:13px;align-items:center;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none}.client-row:hover{border-color:var(--leaf);box-shadow:0 4px 16px rgba(32,50,43,.06)}.client-name{font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis}.client-contact,.client-last{color:var(--muted);font-size:.78rem}.status-pill{display:inline-flex;width:max-content;border-radius:999px;padding:5px 8px;background:var(--leaf-soft);color:var(--leaf);font-size:.69rem;font-weight:800;text-transform:capitalize}.status-pill.archived{background:var(--archived-soft);color:var(--archived)}.status-pill.cancelled{background:var(--danger-soft);color:var(--danger)}.row-arrow{font-size:1.2rem;color:var(--muted)}.empty{padding:44px 18px;text-align:center;border:1px dashed var(--line-strong);border-radius:14px;background:var(--panel);color:var(--muted)}.pager{display:flex;justify-content:space-between;gap:10px;margin-top:12px}.pager-spacer{display:block}.detail-actions{display:flex;gap:8px;margin-bottom:12px}.profile-panel{padding:18px;margin-bottom:12px}.profile-heading{display:flex;align-items:start;justify-content:space-between;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--line)}.profile-heading h2{margin:3px 0 0;font-size:1.35rem}.profile-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.profile-field{padding:11px;border:1px solid var(--line);border-radius:11px;background:#fff}.profile-field span{display:block;color:var(--muted);font-size:.7rem;margin-bottom:4px}.profile-field strong{font-size:.86rem;line-height:1.35}.contact-card{margin-top:12px;padding:12px;border-radius:12px;background:var(--leaf-soft);display:flex;align-items:center;justify-content:space-between;gap:12px}.contact-card div{display:grid;gap:3px}.contact-card small{color:var(--muted)}.history-panel{padding:17px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}.section-heading h2{margin:2px 0 0;font-size:1.15rem}.history-list{display:grid;gap:7px}.history-row{display:grid;grid-template-columns:170px minmax(180px,1.3fr) minmax(150px,1fr) 110px;gap:12px;align-items:center;min-height:56px;padding:11px 12px;border:1px solid var(--line);border-radius:11px;background:#fff}.history-row-link{grid-template-columns:170px minmax(180px,1.3fr) minmax(150px,1fr) 110px 70px;text-decoration:none;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}.history-row-link:hover{border-color:var(--leaf);box-shadow:0 6px 18px rgba(32,50,43,.09);transform:translateY(-1px)}.history-row-link:focus-visible{outline:3px solid rgba(63,102,83,.24);outline-offset:2px;border-color:var(--leaf)}.history-open{display:inline-flex;align-items:center;justify-content:flex-end;gap:7px;color:var(--leaf-deep);font-size:1.05rem;font-weight:850}.history-open span{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em}.history-time{display:grid;gap:2px;font-size:.79rem}.history-time small,.history-staff{color:var(--muted);font-size:.75rem}.history-service{font-size:.82rem;font-weight:750}.history-row.cancelled{background:#fcf8f6}.footer-note{margin:14px 0 0;color:var(--muted);font-size:.73rem;line-height:1.5}@media(max-width:900px){.profile-grid{grid-template-columns:repeat(2,1fr)}.client-row{grid-template-columns:minmax(170px,1.3fr) minmax(140px,1fr) 110px 26px}.client-last{display:none}.history-row{grid-template-columns:150px minmax(170px,1fr) 100px}.history-row-link{grid-template-columns:150px minmax(170px,1fr) 100px 64px}.history-staff{grid-column:2}}@media(max-width:700px){.shell{padding:12px 10px 28px}.topbar{align-items:start;flex-direction:column}.topbar-side{justify-items:start;width:100%}.signout-button{min-height:44px}.search-form{grid-template-columns:1fr}.field input,.field select,.button{min-height:46px}.button{width:100%}.result-summary{align-items:start;flex-direction:column}.client-row{grid-template-columns:1fr auto;padding:13px}.client-contact,.client-row .status-pill{grid-column:1}.client-last{display:none}.row-arrow{grid-column:2;grid-row:1/4}.profile-heading,.contact-card{align-items:start;flex-direction:column}.profile-grid{grid-template-columns:1fr}.history-row{grid-template-columns:1fr auto;padding:13px}.history-service,.history-staff{grid-column:1}.history-row .status-pill{grid-column:2;grid-row:1/4}.history-row-link{grid-template-columns:1fr auto;padding-right:12px}.history-row-link .history-open{grid-column:2;grid-row:1/4}.history-open span{display:none}.pager-link{min-height:44px}.footer-note{text-align:left}}`;
}

function styles() {
  return `${baseStyles()}:root{--muted:#52645b}`;
}

const policyRecordStyles = `.policy-history-list{display:grid;gap:7px}.policy-history-row{display:grid;grid-template-columns:170px minmax(180px,1fr) minmax(150px,1fr);gap:12px;align-items:center;min-height:58px;padding:11px 12px;border:1px solid var(--line);border-radius:11px;background:#fff}.policy-history-row strong{font-size:.82rem}.policy-history-row small{display:block;margin-top:3px;color:var(--muted);font-size:.72rem}.policy-method{color:var(--leaf-deep);font-size:.76rem;font-weight:780}.booking-readiness{display:block;margin-top:5px;color:var(--muted);font-size:.7rem;font-weight:650;line-height:1.4}.booking-readiness strong{color:var(--leaf-deep);font-size:inherit}.terms-panel{margin-bottom:12px}@media(max-width:700px){.policy-history-row{grid-template-columns:1fr;padding:13px}.policy-method{justify-self:start}}`;

const appointmentHistoryResponsiveStyles = `@media(max-width:900px) and (min-width:701px){.history-row-link{grid-template-columns:150px minmax(170px,1fr) minmax(110px,.7fr) 100px 64px}.history-row-link .history-staff{grid-column:auto}}@media(max-width:700px){.history-row-link .status-pill{grid-column:2;grid-row:1/3}.history-row-link .history-open{grid-column:2;grid-row:3/5;align-self:end}}`;

function formatDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'Not recorded';
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+02:00`);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

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

function formatMobile(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (/^27\d{9}$/.test(digits)) return `+27 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return 'Contact unavailable';
}

function maskMobile(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 4 ? `Mobile ending ${digits.slice(-4)}` : 'Contact unavailable';
}

function statusPill(status) {
  const value = String(status || 'unknown').toLowerCase();
  const tone = value === 'archived' || value === 'cancelled' ? ` ${value}` : '';
  return `<span class="status-pill${tone}">${escapeHtml(value.replace(/_/g, ' '))}</span>`;
}

function listHref({ query = '', status = 'active', offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (offset > 0) params.set('offset', String(offset));
  const suffix = params.toString();
  return `/calendar/clients${suffix ? `?${suffix}` : ''}`;
}

function shellStart({ title, subtitle, displayName, calendarNavigationAllowed, staffAccessScriptPath }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}${policyRecordStyles}${appointmentHistoryResponsiveStyles}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script></head><body data-workspace-clients="true"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'clients', displayName, calendarHref: calendarNavigationAllowed ? '/calendar/read-only' : null })}<div class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="topbar-side"><span class="truth-note">View only</span></div></header>`;
}

function renderClientListPage(model, {
  staffAccessScriptPath = '/calendar/staff/client.js',
  calendarNavigationAllowed = false,
} = {}) {
  const selectedStatus = model.status || 'all';
  const rows = (model.clients || []).map(client => {
    const last = client.last_appointment_at ? formatDateTime(client.last_appointment_at).date : 'No appointment yet';
    return `<a class="client-row" href="/calendar/clients/${escapeHtml(client.id)}"><span class="client-name">${escapeHtml(client.name || 'Unnamed client')}</span><span class="client-contact">${escapeHtml(maskMobile(client.normalized_mobile))}</span>${statusPill(client.status)}<span class="client-last">${escapeHtml(last)}</span><span class="row-arrow" aria-hidden="true">›</span></a>`;
  }).join('');
  const statusOptions = [['active', 'Active'], ['archived', 'Archived'], ['all', 'All']]
    .map(([value, label]) => `<option value="${value}"${selectedStatus === value || (!model.status && value === 'all') ? ' selected' : ''}>${label}</option>`).join('');
  const previousOffset = Math.max(0, model.offset - model.pageSize);
  const previous = model.offset > 0 ? `<a class="pager-link" href="${escapeHtml(listHref({ query: model.query, status: selectedStatus, offset: previousOffset }))}">Previous</a>` : '<span class="pager-spacer"></span>';
  const next = model.hasMore ? `<a class="pager-link" href="${escapeHtml(listHref({ query: model.query, status: selectedStatus, offset: model.offset + model.pageSize }))}">Next</a>` : '<span class="pager-spacer"></span>';
  return `${shellStart({ title: 'Clients', subtitle: 'Find and view client records.', displayName: model.authority?.displayName, calendarNavigationAllowed, staffAccessScriptPath })}<main data-clients-list-view>
    <section class="search-panel"><form class="search-form" method="get" action="/calendar/clients"><div class="field"><label for="client-search">Search clients</label><input id="client-search" name="q" type="search" value="${escapeHtml(model.query || '')}" placeholder="Name or mobile" maxlength="120"></div><div class="field"><label for="client-status">Status</label><select id="client-status" name="status">${statusOptions}</select></div><button class="button primary" type="submit">Search</button></form></section>
    <div class="result-summary"><span>${model.clients.length} client${model.clients.length === 1 ? '' : 's'} on this page</span></div>
    <section class="client-list" aria-label="Clients">${rows || '<div class="empty">No clients found.</div>'}</section>
    <nav class="pager" aria-label="Client result pages">${previous}${next}</nav>
  </main><p class="footer-note">This page is view only. Client editing and messaging are not available here.</p></div></div></div></body></html>`;
}

function appointmentServices(appointment) {
  const names = (appointment.services || []).map(item => String(item.name || '').trim()).filter(Boolean);
  return names.join(' + ') || String(appointment.title || 'Appointment');
}

function readinessText(readiness = {}) {
  const terms = readiness.terms?.state === 'accepted'
    ? 'Terms accepted'
    : readiness.terms?.state === 'awaiting'
      ? 'Terms awaiting acceptance'
      : 'Terms not recorded';
  const depositState = String(readiness.deposit?.state || 'not_started');
  const deposit = depositState === 'satisfied'
    ? 'Deposit received'
    : depositState === 'exempt'
      ? 'No deposit required'
      : depositState === 'awaiting'
        ? 'Deposit awaiting'
        : 'Deposit not started';
  const confirmation = readiness.confirmation?.state === 'sent'
    ? 'Confirmation sent'
    : readiness.confirmation?.state === 'pending'
      ? 'Confirmation pending'
      : 'Confirmation not started';
  return [terms, deposit, confirmation].join(' · ');
}

function renderPolicyHistory(model = {}) {
  const rows = (model.policyAcceptances || []).map(item => {
    const accepted = formatDateTime(item.acceptedAt);
    const booking = item.appointmentId
      ? `Booking #${item.appointmentId}${item.serviceName ? ` · ${item.serviceName}` : ''}`
      : 'General booking terms';
    return `<div class="policy-history-row"><div><strong>${escapeHtml(accepted.date)}</strong><small>${escapeHtml(accepted.time)}</small></div><div><strong>${escapeHtml(booking)}</strong><small>Policy version ${escapeHtml(item.policyVersion || 'Recorded')}</small></div><span class="policy-method">${escapeHtml(item.channelLabel || 'Shiloh')}</span></div>`;
  }).join('');
  return `<section class="history-panel terms-panel" data-policy-history><header class="section-heading"><div><span class="eyebrow">Policies &amp; consents</span><h2>Booking Policy &amp; Terms</h2></div><span class="truth-note">Client acknowledgement history</span></header><div class="policy-history-list">${rows || '<div class="empty">No Booking Policy &amp; Terms acceptance is recorded yet.</div>'}</div></section>`;
}

function appointmentStaff(appointment) {
  return (appointment.staff || []).map(item => String(item.name || '').trim()).filter(Boolean).join(' + ') || 'Practitioner not recorded';
}

function renderClientDetailPage(model, {
  staffAccessScriptPath = '/calendar/staff/client.js',
  calendarNavigationAllowed = false,
} = {}) {
  const client = model.client;
  const historyRows = (model.appointments || []).map(appointment => {
    const start = formatDateTime(appointment.starts_at);
    const end = formatDateTime(appointment.ends_at);
    const cancelled = String(appointment.status).toLowerCase() === 'cancelled' ? ' cancelled' : '';
    const readiness = model.bookingReadiness?.[appointment.id] || model.bookingReadiness?.[String(appointment.id)] || {};
    return `<article class="history-row${cancelled}"><div class="history-time"><strong>${escapeHtml(start.date)}</strong><small>${escapeHtml(start.time)}${end.time ? `–${escapeHtml(end.time)}` : ''}</small></div><div class="history-service">${escapeHtml(appointmentServices(appointment))}<small class="booking-readiness">${escapeHtml(readinessText(readiness))}</small></div><div class="history-staff">${escapeHtml(appointmentStaff(appointment))}</div>${statusPill(appointment.status)}</article>`;
  }).join('');
  const previousOffset = Math.max(0, model.historyOffset - model.pageSize);
  const historyBase = `/calendar/clients/${encodeURIComponent(String(client.id))}`;
  const previous = model.historyOffset > 0 ? `<a class="pager-link" href="${historyBase}?historyOffset=${previousOffset}">Previous history</a>` : '<span class="pager-spacer"></span>';
  const next = model.hasMore ? `<a class="pager-link" href="${historyBase}?historyOffset=${model.historyOffset + model.pageSize}">Older history</a>` : '<span class="pager-spacer"></span>';
  const verified = client.mobile_verified_at ? 'Verified WhatsApp/mobile contact' : 'Contact not yet verified';
  return `${shellStart({ title: 'Client detail', subtitle: 'Client profile and appointment history.', displayName: model.authority?.displayName, calendarNavigationAllowed, staffAccessScriptPath })}<main data-client-detail-view>
    <nav class="detail-actions" aria-label="Client navigation"><a class="button" href="/calendar/clients">← Back to Clients</a></nav>
    <section class="profile-panel"><header class="profile-heading"><div><span class="eyebrow">Client record</span><h2>${escapeHtml(client.name || 'Unnamed client')}</h2></div>${statusPill(client.status)}</header><div class="profile-grid"><div class="profile-field"><span>Profile</span><strong>${escapeHtml(String(client.profile_status || 'unknown').replace(/_/g, ' '))}</strong></div><div class="profile-field"><span>Date of birth</span><strong>${escapeHtml(formatDateOnly(client.date_of_birth))}</strong></div><div class="profile-field"><span>Gender</span><strong>${escapeHtml(String(client.gender || 'Not recorded').replace(/_/g, ' '))}</strong></div><div class="profile-field"><span>Appointment history</span><strong>${model.appointments.length} shown</strong></div></div><div class="contact-card"><div><span class="eyebrow">Primary mobile</span><strong>${escapeHtml(formatMobile(client.normalized_mobile))}</strong></div><small>${escapeHtml(verified)}</small></div></section>
    ${renderPolicyHistory(model)}
    <section class="history-panel"><header class="section-heading"><div><span class="eyebrow">History</span><h2>Appointments</h2></div><span class="truth-note">Historical service and practitioner snapshots</span></header><div class="history-list">${historyRows || '<div class="empty">No appointments are recorded for this client.</div>'}</div><nav class="pager" aria-label="Appointment history pages">${previous}${next}</nav></section>
  </main><p class="footer-note">Only appointments linked to this client are shown.</p></div></div></div></body></html>`;
}

function renderClientsUnavailablePage({ code = 'WORKSPACE_CLIENTS_UNAVAILABLE', message = 'Clients is unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clients unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style></head><body><div class="shell"><section class="empty"><h1>Clients unavailable</h1><p>${escapeHtml(message)}</p><small>Reference: ${escapeHtml(code)}</small></section></div></body></html>`;
}

module.exports = {
  formatDateOnly,
  formatDateTime,
  formatMobile,
  maskMobile,
  renderClientListPage,
  readinessText,
  renderPolicyHistory,
  renderClientDetailPage,
  renderClientsUnavailablePage,
};
