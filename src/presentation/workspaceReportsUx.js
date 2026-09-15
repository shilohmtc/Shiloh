const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

function reportStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--sand:#f1ede2;--danger:#8a4138;--danger-soft:#f5ebe6;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1180px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:14px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem;line-height:1.45}.topbar-side{display:grid;justify-items:end;gap:7px}.truth-note{font-size:.74rem;color:var(--muted)}.button,.preset-link,.jump-link{display:inline-flex;align-items:center;justify-content:center;min-height:42px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.8rem;font-weight:750;text-decoration:none}.button.primary,.preset-link.active{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.filter-panel,.panel,.metric-card{background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)}.filter-panel{border-radius:17px;padding:14px;margin-bottom:12px}.preset-row,.jump-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.preset-row{margin-bottom:12px}.preset-label,.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted)}.filter-grid{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(150px,.8fr) minmax(190px,1fr) auto;gap:9px;align-items:end}.field{display:grid;gap:5px}.field label{font-size:.7rem;font-weight:800;color:var(--muted)}.field input,.field select{width:100%;min-height:44px;border:1px solid var(--line-strong);border-radius:10px;padding:9px 11px;background:#fff;color:var(--ink);font:inherit}.field input:focus,.field select:focus{outline:2px solid var(--leaf-soft);border-color:var(--leaf)}.range-note{display:flex;justify-content:space-between;gap:10px;margin-top:10px;color:var(--muted);font-size:.74rem}.jump-row{margin:0 0 12px}.jump-link{min-height:38px;padding:7px 11px;background:transparent}.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-bottom:12px}.metric-card{border-radius:14px;padding:13px}.metric-card span{display:block;color:var(--muted);font-size:.69rem;font-weight:800}.metric-card strong{display:block;margin-top:5px;font-size:1.35rem;line-height:1}.metric-card small{display:block;margin-top:6px;color:var(--muted);font-size:.69rem;line-height:1.4}.grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.85fr);gap:12px}.panel{border-radius:17px;padding:16px;margin-bottom:12px;min-width:0;scroll-margin-top:12px}.panel-heading{display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:12px}.panel-heading h2{margin:2px 0 0;font-size:1.08rem}.panel-heading p{margin:4px 0 0;color:var(--muted);font-size:.75rem;line-height:1.4}.status-strip{display:flex;gap:7px;flex-wrap:wrap}.status-pill{display:inline-flex;gap:6px;align-items:center;border-radius:999px;padding:7px 10px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.72rem;font-weight:750}.status-pill.cancelled{background:var(--danger-soft);color:var(--danger)}.status-pill strong{font-size:.82rem}.capacity-table{width:100%;border-collapse:separate;border-spacing:0 6px}.capacity-table th{text-align:right;padding:0 9px 4px;color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em}.capacity-table th:first-child{text-align:left}.capacity-table td{padding:10px 9px;background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-align:right;font-size:.78rem}.capacity-table td:first-child{text-align:left;border-left:1px solid var(--line);border-radius:10px 0 0 10px}.capacity-table td:last-child{border-right:1px solid var(--line);border-radius:0 10px 10px 0}.person{font-weight:800}.util{display:grid;gap:4px;min-width:92px}.util-track{height:6px;border-radius:999px;background:var(--leaf-soft);overflow:hidden}.util-fill{height:100%;background:var(--leaf-deep);border-radius:999px}.util small{color:var(--muted);font-size:.65rem;text-align:right}.service-list{display:grid;gap:8px}.service-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.service-meta{display:grid;gap:4px}.service-name{font-size:.79rem;font-weight:750}.service-category{font-size:.67rem;color:var(--muted)}.service-bar{height:6px;border-radius:999px;background:var(--leaf-soft);overflow:hidden}.service-bar span{display:block;height:100%;background:var(--leaf-deep);border-radius:999px}.service-count{font-size:.78rem;font-weight:800}.client-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.client-stat{padding:12px;border:1px solid var(--line);border-radius:11px;background:#fff}.client-stat strong{display:block;font-size:1.18rem}.client-stat span{display:block;margin-top:4px;color:var(--muted);font-size:.68rem}.trend-card{padding:14px;border-radius:12px;background:var(--sand)}.trend-number{font-size:1.5rem;font-weight:850}.trend-copy{margin-top:5px;color:var(--muted);font-size:.75rem;line-height:1.45}.empty{padding:26px 14px;text-align:center;border:1px dashed var(--line-strong);border-radius:12px;color:var(--muted);font-size:.78rem}.footer-note{margin:14px 0 0;color:var(--muted);font-size:.72rem;line-height:1.55}@media(max-width:1050px){.metrics{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}.capacity-table{min-width:760px}.table-scroll{overflow-x:auto}}@media(max-width:700px){.shell{padding:12px 10px 28px}.topbar{align-items:start;flex-direction:column}.topbar-side{justify-items:start;width:100%}.button,.preset-link,.jump-link{min-height:44px}.metrics{grid-template-columns:repeat(2,1fr)}.filter-grid{grid-template-columns:1fr}.field input,.field select,.button{min-height:46px}.button{width:100%}.range-note{flex-direction:column}.jump-row{position:sticky;top:8px;z-index:6;padding:5px;border:1px solid var(--line);border-radius:14px;background:rgba(244,243,237,.96);box-shadow:0 6px 20px rgba(32,50,43,.08);backdrop-filter:blur(10px)}.jump-link{flex:1;min-width:90px;background:#fff}.panel{padding:13px}.client-grid{grid-template-columns:repeat(3,1fr)}.metrics .metric-card:last-child{grid-column:1/-1}.footer-note{text-align:left}}`;
}

function phoneCapacityStyles() {
  return `@media(max-width:700px){.table-scroll{overflow:visible}.capacity-table{display:block;min-width:0}.capacity-table thead{display:none}.capacity-table tbody{display:grid;gap:9px}.capacity-table tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--line);border-radius:12px;background:#fff;padding:10px}.capacity-table td{display:grid;gap:3px;border:0!important;border-radius:0!important;padding:7px!important;text-align:left!important;background:transparent}.capacity-table td:first-child{grid-column:1/-1;padding-bottom:9px!important;border-bottom:1px solid var(--line)!important}.capacity-table td::before{content:attr(data-label);color:var(--muted);font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.capacity-table .util{min-width:0}.capacity-table .util small{text-align:left}}`;
}

function formatMinutes(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDate(value) {
  const date = new Date(`${String(value)}T12:00:00+02:00`);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function queryForPreset(preset, selectedStaffId) {
  const params = new URLSearchParams({ range: preset });
  if (selectedStaffId) params.set('staff', String(selectedStaffId));
  return `/calendar/reports?${params.toString()}`;
}

function statusLabel(value) {
  return String(value || 'unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function trendSummary(trend) {
  const delta = Number(trend?.delta || 0);
  if (delta === 0) return 'No change from the previous period.';
  const direction = delta > 0 ? 'more' : 'fewer';
  return `${Math.abs(delta)} ${direction} appointment${Math.abs(delta) === 1 ? '' : 's'} than the previous period.`;
}

function renderReportsPage(model, {
  staffAccessScriptPath = '/calendar/staff/client.js',
} = {}) {
  const selectedStaffId = model.selectedStaffId;
  const permittedStaff = model.permittedStaff || [];
  const selectedStaff = permittedStaff.find(person => Number(person.id) === Number(selectedStaffId));
  const staffOptions = [];
  if (model.authority?.reportScope === 'all_business') {
    staffOptions.push(`<option value="all"${selectedStaffId == null ? ' selected' : ''}>All team members</option>`);
  }
  for (const person of permittedStaff) {
    const id = Number(person.id);
    staffOptions.push(`<option value="${escapeHtml(id)}"${id === Number(selectedStaffId) ? ' selected' : ''}>${escapeHtml(person.displayName || person.display_name || 'Team member')}</option>`);
  }

  const presetLinks = [
    ['7d', '7 days'],
    ['30d', '30 days'],
    ['month', 'This month'],
  ].map(([value, label]) => {
    const active = model.period.preset === value ? ' active' : '';
    return `<a class="preset-link${active}" href="${escapeHtml(queryForPreset(value, selectedStaffId))}">${escapeHtml(label)}</a>`;
  }).join('');

  const statusPills = Object.entries(model.appointments?.statusCounts || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `<span class="status-pill${status === 'cancelled' ? ' cancelled' : ''}"><span>${escapeHtml(statusLabel(status))}</span><strong>${escapeHtml(count)}</strong></span>`)
    .join('');

  const maxService = Math.max(1, ...(model.services || []).map(item => Number(item.appointments || 0)));
  const serviceRows = (model.services || []).map(item => {
    const width = Math.max(4, Math.round((Number(item.appointments || 0) / maxService) * 100));
    return `<div class="service-row"><div class="service-meta"><div class="service-name">${escapeHtml(item.name)}</div>${item.category ? `<div class="service-category">${escapeHtml(item.category)}</div>` : ''}<div class="service-bar" aria-hidden="true"><span style="width:${width}%"></span></div></div><div class="service-count">${escapeHtml(item.appointments)}</div></div>`;
  }).join('');

  const capacityRows = (model.capacity || []).map(row => `<tr>
    <td data-label="Team member"><span class="person">${escapeHtml(row.name)}</span></td>
    <td data-label="Working hours">${escapeHtml(formatMinutes(row.scheduledMinutes))}</td>
    <td data-label="Appointments">${escapeHtml(formatMinutes(row.bookedMinutes))}</td>
    <td data-label="Blocked">${escapeHtml(formatMinutes(row.blockedMinutes))}</td>
    <td data-label="Leave">${escapeHtml(formatMinutes(row.leaveMinutes))}</td>
    <td data-label="Available">${escapeHtml(formatMinutes(row.remainingMinutes))}</td>
    <td data-label="Booked"><div class="util"><div class="util-track" aria-hidden="true"><div class="util-fill" style="width:${Math.max(0, Math.min(100, Number(row.utilisationPct || 0)))}%"></div></div><small>${escapeHtml(row.utilisationPct)}%</small></div></td>
  </tr>`).join('');

  const showingText = model.authority?.reportScope === 'own_staff'
    ? 'Showing your appointments.'
    : selectedStaffId
      ? `Showing ${selectedStaff?.displayName || selectedStaff?.display_name || 'the selected team member'}.`
      : 'Showing the whole team.';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reports — Shiloh Workspace</title><style>${workspaceShellStyles()}${reportStyles()}${phoneCapacityStyles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script></head><body data-workspace-reports="true"><div class="workspace-frame">${renderWorkspaceNavigation({
    active: 'reports',
    displayName: model.authority?.displayName,
    calendarHref: '/calendar/read-only',
    clientsHref: '/calendar/clients',
    staffHref: '/calendar/team',
    servicesHref: '/calendar/services',
    reportsHref: '/calendar/reports',
  })}<div class="workspace-main"><div class="shell">
    <header class="topbar"><div class="brand"><h1>Reports</h1><p>A clear view of appointments, team time and clients.</p></div><div class="topbar-side"><span class="truth-note">Read only</span></div></header>

    <section class="filter-panel" aria-label="Choose report period">
      <div class="preset-row"><span class="preset-label">Choose period</span>${presetLinks}</div>
      <form class="filter-grid" method="get" action="/calendar/reports">
        <div class="field"><label for="report-from">From</label><input id="report-from" name="from" type="date" value="${escapeHtml(model.period.startKey)}" required></div>
        <div class="field"><label for="report-to">To</label><input id="report-to" name="to" type="date" value="${escapeHtml(model.period.endInclusiveKey)}" required></div>
        <div class="field"><label for="report-staff">Team member</label><select id="report-staff" name="staff">${staffOptions.join('')}</select></div>
        <button class="button primary" type="submit">View report</button>
      </form>
      <div class="range-note"><span>${escapeHtml(formatDate(model.period.startKey))}–${escapeHtml(formatDate(model.period.endInclusiveKey))} · ${escapeHtml(model.period.dayCount)} day${model.period.dayCount === 1 ? '' : 's'}</span><span>${escapeHtml(showingText)}</span></div>
    </section>

    <nav class="jump-row" aria-label="Report sections"><a class="jump-link" href="#team-time">Team</a><a class="jump-link" href="#treatments">Treatments</a><a class="jump-link" href="#clients">Clients</a></nav>

    <section class="metrics" aria-label="At a glance">
      <article class="metric-card"><span>Appointments</span><strong>${escapeHtml(model.appointments?.operational || 0)}</strong><small>Excluding cancellations.</small></article>
      <article class="metric-card"><span>Booked hours</span><strong>${escapeHtml(formatMinutes(model.totals?.bookedMinutes))}</strong><small>Time reserved for appointments.</small></article>
      <article class="metric-card"><span>Time available</span><strong>${escapeHtml(formatMinutes(model.totals?.remainingMinutes))}</strong><small>Working time still free after bookings, leave and blocked time.</small></article>
      <article class="metric-card"><span>Time booked</span><strong>${escapeHtml(model.totals?.utilisationPct || 0)}%</strong><small>Share of available working time already booked.</small></article>
      <article class="metric-card"><span>Clients</span><strong>${escapeHtml(model.clients?.uniqueClients || 0)}</strong><small>Different clients with appointments in this period.</small></article>
    </section>

    <div class="grid">
      <div>
        <section class="panel" id="team-time"><div class="panel-heading"><div><span class="eyebrow">Team</span><h2>Team booking time</h2><p>See how each team member's working time is being used.</p></div><span class="truth-note">${escapeHtml(model.closures || 0)} clinic closure${Number(model.closures || 0) === 1 ? '' : 's'}</span></div>
          <div class="table-scroll"><table class="capacity-table"><thead><tr><th>Team member</th><th>Working hours</th><th>Appointments</th><th>Blocked</th><th>Leave</th><th>Available</th><th>Booked</th></tr></thead><tbody>${capacityRows || '<tr><td colspan="7">No team hours are available for this period.</td></tr>'}</tbody></table></div>
        </section>

        <section class="panel"><div class="panel-heading"><div><span class="eyebrow">Appointments</span><h2>Appointment status</h2><p>${escapeHtml(model.appointments?.allRecorded || 0)} appointment${Number(model.appointments?.allRecorded || 0) === 1 ? '' : 's'} recorded, including cancellations.</p></div></div><div class="status-strip">${statusPills || '<div class="empty">No appointments were recorded in this period.</div>'}</div></section>
      </div>

      <div>
        <section class="panel" id="treatments"><div class="panel-heading"><div><span class="eyebrow">Treatments</span><h2>Treatments booked</h2><p>Which treatments were booked most often.</p></div></div><div class="service-list">${serviceRows || '<div class="empty">No treatments were booked in this period.</div>'}</div></section>

        <section class="panel" id="clients"><div class="panel-heading"><div><span class="eyebrow">Clients</span><h2>New and returning clients</h2><p>A simple count for this period. Contact details are not shown here.</p></div></div><div class="client-grid"><div class="client-stat"><strong>${escapeHtml(model.clients?.uniqueClients || 0)}</strong><span>Total clients</span></div><div class="client-stat"><strong>${escapeHtml(model.clients?.newClients || 0)}</strong><span>New</span></div><div class="client-stat"><strong>${escapeHtml(model.clients?.returningClients || 0)}</strong><span>Returning</span></div></div></section>

        <section class="panel"><div class="panel-heading"><div><span class="eyebrow">Comparison</span><h2>Compared with the previous period</h2><p>The same number of days immediately before this report.</p></div></div><div class="trend-card"><div class="trend-number">${Number(model.trend?.delta || 0) > 0 ? '+' : ''}${escapeHtml(model.trend?.delta || 0)}</div><div class="trend-copy">${escapeHtml(trendSummary(model.trend))} This period: ${escapeHtml(model.trend?.currentOperationalAppointments || 0)} · Previous: ${escapeHtml(model.trend?.previousOperationalAppointments || 0)}.</div></div></section>
      </div>
    </div>

    <p class="footer-note">Reports are read only and can cover up to 31 days. Payments and income are shown separately.</p>
  </div></div></div></body></html>`;
}

function renderReportsUnavailablePage({
  message = 'Reports are temporarily unavailable. Please try again shortly.',
} = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reports unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${reportStyles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'reports', reportsHref: '/calendar/reports' })}<div class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>Reports unavailable</h1><p>${escapeHtml(message)}</p></div></header><section class="panel"><h2>Please try again in a moment.</h2><p class="footer-note">If the problem continues, return to Calendar and try Reports again later.</p><p><a class="button" href="/calendar/read-only">Back to Calendar</a></p></section></div></div></div></body></html>`;
}

module.exports = {
  formatMinutes,
  formatDate,
  queryForPreset,
  statusLabel,
  trendSummary,
  renderReportsPage,
  renderReportsUnavailablePage,
};
