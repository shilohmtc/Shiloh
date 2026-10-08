const { workspaceErrorRecoveryClientScript } = require('./workspaceErrorRecovery');
const { recordsStyles, recordSections } = require('./workspaceFinancialRecordsUx');
const { financialStyles, financialOverview, financialContext, financialSections } = require('./workspaceFinancialReportsUx');
const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

function reportStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#5c6b64;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--sand:#f1ede2;--danger:#8a4138;--danger-soft:#f5ebe6;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1180px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:14px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem;line-height:1.45}.topbar-side{display:grid;justify-items:end;gap:7px}.truth-note{font-size:.74rem;color:var(--muted)}.button,.preset-link,.jump-link{display:inline-flex;align-items:center;justify-content:center;min-height:42px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.8rem;font-weight:750;text-decoration:none}.button.primary,.preset-link.active{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.filter-panel,.panel,.metric-card{background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)}.filter-panel{border-radius:17px;padding:14px;margin-bottom:12px}.preset-row,.jump-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.preset-row{margin-bottom:12px}.preset-label,.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted)}.filter-grid{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(150px,.8fr) minmax(190px,1fr) auto;gap:9px;align-items:end}.field{display:grid;gap:5px}.field label{font-size:.7rem;font-weight:800;color:var(--muted)}.field input,.field select{width:100%;min-height:44px;border:1px solid var(--line-strong);border-radius:10px;padding:9px 11px;background:#fff;color:var(--ink);font:inherit}.field input:focus,.field select:focus{outline:2px solid var(--leaf-soft);border-color:var(--leaf)}.range-note{display:flex;justify-content:space-between;gap:10px;margin-top:10px;color:var(--muted);font-size:.74rem}.jump-row{margin:0 0 12px}.jump-link{min-height:38px;padding:7px 11px;background:transparent}.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-bottom:12px}.metric-card{border-radius:14px;padding:13px}.metric-card span{display:block;color:var(--muted);font-size:.69rem;font-weight:800}.metric-card strong{display:block;margin-top:5px;font-size:1.35rem;line-height:1}.metric-card small{display:block;margin-top:6px;color:var(--muted);font-size:.69rem;line-height:1.4}.grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.85fr);gap:12px}.panel{border-radius:17px;padding:16px;margin-bottom:12px;min-width:0;scroll-margin-top:12px}.panel-heading{display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:12px}.panel-heading h2{margin:2px 0 0;font-size:1.08rem}.panel-heading p{margin:4px 0 0;color:var(--muted);font-size:.75rem;line-height:1.4}.status-strip{display:flex;gap:7px;flex-wrap:wrap}.status-pill{display:inline-flex;gap:6px;align-items:center;border-radius:999px;padding:7px 10px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.72rem;font-weight:750}.status-pill.cancelled{background:var(--danger-soft);color:var(--danger)}.status-pill strong{font-size:.82rem}.capacity-table{width:100%;border-collapse:separate;border-spacing:0 6px}.capacity-table th{text-align:right;padding:0 9px 4px;color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em}.capacity-table th:first-child{text-align:left}.capacity-table td{padding:10px 9px;background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-align:right;font-size:.78rem}.capacity-table td:first-child{text-align:left;border-left:1px solid var(--line);border-radius:10px 0 0 10px}.capacity-table td:last-child{border-right:1px solid var(--line);border-radius:0 10px 10px 0}.person{font-weight:800}.util{display:grid;gap:4px;min-width:92px}.util-track{height:6px;border-radius:999px;background:var(--leaf-soft);overflow:hidden}.util-fill{height:100%;background:var(--leaf-deep);border-radius:999px}.util small{color:var(--muted);font-size:.65rem;text-align:right}.service-list{display:grid;gap:8px}.service-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.service-meta{display:grid;gap:4px}.service-name{font-size:.79rem;font-weight:750}.service-category{font-size:.67rem;color:var(--muted)}.service-bar{height:6px;border-radius:999px;background:var(--leaf-soft);overflow:hidden}.service-bar span{display:block;height:100%;background:var(--leaf-deep);border-radius:999px}.service-count{font-size:.78rem;font-weight:800}.client-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.client-stat{padding:12px;border:1px solid var(--line);border-radius:11px;background:#fff}.client-stat strong{display:block;font-size:1.18rem}.client-stat span{display:block;margin-top:4px;color:var(--muted);font-size:.68rem}.trend-card{padding:14px;border-radius:12px;background:var(--sand)}.trend-number{font-size:1.5rem;font-weight:850}.trend-copy{margin-top:5px;color:var(--muted);font-size:.75rem;line-height:1.45}.empty{padding:26px 14px;text-align:center;border:1px dashed var(--line-strong);border-radius:12px;color:var(--muted);font-size:.78rem}.footer-note{margin:14px 0 0;color:var(--muted);font-size:.72rem;line-height:1.55}@media(max-width:1050px){.metrics{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}.capacity-table{min-width:760px}.table-scroll{overflow-x:auto}}@media(max-width:700px){.shell{padding:12px 10px 28px}.topbar{align-items:start;flex-direction:column}.topbar-side{justify-items:start;width:100%}.button,.preset-link,.jump-link{min-height:44px}.metrics{grid-template-columns:repeat(2,1fr)}.filter-grid{grid-template-columns:1fr}.field input,.field select,.button{min-height:46px}.button{width:100%}.range-note{flex-direction:column}.jump-row{position:sticky;top:8px;z-index:6;padding:5px;border:1px solid var(--line);border-radius:14px;background:rgba(244,243,237,.96);box-shadow:0 6px 20px rgba(32,50,43,.08);backdrop-filter:blur(10px)}.jump-link{flex:1;min-width:90px;background:#fff}.panel{padding:13px}.client-grid{grid-template-columns:repeat(3,1fr)}.metrics .metric-card:last-child{grid-column:1/-1}.footer-note{text-align:left}}`;
}

function reportSectionStyles() {
  return `.panel>summary{cursor:pointer;min-height:44px;list-style:none;position:relative;padding-right:28px;margin-bottom:0}.panel>summary::-webkit-details-marker{display:none}.panel>summary::after{content:"+";position:absolute;right:0;top:9px;font-size:1.3rem;color:var(--leaf-deep)}.panel[open]>summary::after{content:"−"}.panel>summary:focus-visible{outline:2px solid var(--leaf);outline-offset:5px;border-radius:4px}.panel-body{margin-top:14px;border-top:1px solid var(--line);padding-top:14px}.panel-body summary{min-height:44px;cursor:pointer;align-content:center}.panel-heading h2,.panel-heading h3,.panel-heading p,.capacity-table td,.workspace-drawer-header .workspace-brand-copy{overflow-wrap:anywhere}.report-group>.panel-body>.panel{box-shadow:none}.report-group h3{margin:2px 0 0;font-size:1rem}.report-group .metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.metric-card strong,.earnings-summary strong,.client-stat,.earnings-visit{overflow-wrap:anywhere}.client-stat,.earnings-visit>div{min-width:0}.earnings-visit a{max-width:100%}.filter-panel,.financial-overview,.workspace-main,.filter-grid>*{min-width:0}.filter-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto}.custom-period>summary{align-content:center;min-height:44px;cursor:pointer;font-size:.8rem;font-weight:750}.custom-period .custom-fields{display:grid;gap:9px;padding-top:9px}@media(max-width:700px){.filter-grid{grid-template-columns:minmax(0,1fr)}}.field input,.field select{min-width:0;max-width:100%}.range-note span{overflow-wrap:anywhere}.report-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.report-tools a{min-height:44px}@media(max-width:700px){.financial-cards .financial-card:last-child{grid-column:1/-1}.report-group .metrics{grid-template-columns:minmax(0,1fr)}.report-group .metrics .metric-card:last-child{grid-column:auto}.report-group>.panel-body>.panel{padding:11px}.panel-heading{flex-wrap:wrap}.jump-row .jump-link{flex:1 1 auto;min-width:0}.earnings-summary{grid-template-columns:minmax(0,1fr)}.earnings-summary article:last-child{grid-column:auto}}@media(max-width:380px){.capacity-table tr{grid-template-columns:minmax(0,1fr)}.client-grid,.financial-overview .financial-cards,.earnings-visit{grid-template-columns:minmax(0,1fr)}.earnings-visit>span:last-child{grid-column:auto}}`;
}

function reportSectionsClientScript() {
  return `(()=>{'use strict';function measureMenu(){const menu=document.querySelector('.jump-row');const gap=menu&&getComputedStyle(menu).position==='sticky'?Math.ceil(menu.getBoundingClientRect().height+20):12;document.querySelectorAll('details[data-report-section]').forEach(panel=>{panel.style.scrollMarginTop=gap+'px';});}window.addEventListener('resize',measureMenu);measureMenu();function openSection(hash){if(!hash)return;measureMenu();const panel=document.getElementById(hash.slice(1));if(!panel?.matches('details[data-report-section]'))return;for(let parent=panel.parentElement;parent;parent=parent.parentElement){if(parent.matches('details'))parent.open=true;}panel.open=true;panel.scrollIntoView({block:'start'});}document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>openSection(link.hash)));window.addEventListener('hashchange',()=>openSection(location.hash));openSection(location.hash);})();`;
}

function phoneCapacityStyles() {
  return `@media(max-width:700px){.table-scroll{overflow:visible}.capacity-table{display:block;min-width:0}.capacity-table thead{display:none}.capacity-table tbody{display:grid;gap:9px}.capacity-table tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--line);border-radius:12px;background:#fff;padding:10px}.capacity-table td{display:grid;gap:3px;border:0!important;border-radius:0!important;padding:7px!important;text-align:left!important;background:transparent}.capacity-table td:first-child{grid-column:1/-1;padding-bottom:9px!important;border-bottom:1px solid var(--line)!important}.capacity-table td::before{content:attr(data-label);color:var(--muted);font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.capacity-table .util{min-width:0}.capacity-table .util small{text-align:left}}`;
}

function earningsStyles() {
  return `.earnings-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:14px}.earnings-summary article{padding:12px;border:1px solid var(--line);border-radius:12px;background:#fff}.earnings-summary span,.earnings-summary strong{display:block}.earnings-summary span{color:var(--muted);font-size:.72rem}.earnings-summary strong{font-size:1.15rem;margin-top:5px}.earnings-person{border-top:1px solid var(--line);padding:15px 0}.earnings-person h3{margin:0 0 5px;font-size:1rem}.earnings-person p{margin:0 0 10px;color:var(--muted);font-size:.75rem}.earnings-visits{display:grid;gap:6px}.earnings-visit{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:9px;border:1px solid var(--line);border-radius:9px;background:#fff;font-size:.78rem}.earnings-visit a{font-weight:800;color:var(--leaf-deep);min-height:44px;display:inline-flex;align-items:center}.earnings-visit small{display:block;color:var(--muted);line-height:1.5}.earnings-review{color:var(--danger);font-weight:750}.rule-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.rule-grid .field:last-of-type{grid-column:1/-1}.rule-list{margin:14px 0 0;padding-left:20px;font-size:.76rem;line-height:1.8}.rule-status{min-height:22px;font-size:.76rem}.rule-status.error{color:var(--danger)}@media(max-width:700px){.earnings-summary{grid-template-columns:1fr 1fr}.earnings-summary article:last-child{grid-column:1/-1}.earnings-visit{grid-template-columns:1fr auto}.earnings-visit>span:last-child{grid-column:1/-1}.rule-grid{grid-template-columns:1fr}.rule-grid .field:last-of-type{grid-column:auto}}`;
}

function staffEarningsSection(earnings, period, csrfToken = '') {
  if (!earnings) return '';
  const people = earnings.staff || [];
  const completedValue = people.reduce((sum, row) => sum + row.completedValue, 0);
  const commission = people.reduce((sum, row) => sum + row.commission, 0);
  const review = people.reduce((sum, row) => sum + row.reviewCount, 0);
  const peopleHtml = people.map(row => {
    const visits = row.appointments.map(item => {
      const date = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(item.startsAt));
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.startsAt));
      const href = `/calendar/read-only?view=day&amp;date=${escapeHtml(day)}&amp;appointment=${escapeHtml(item.id)}`;
      return `<div class="earnings-visit"><div><a href="${href}">Appointment #${escapeHtml(item.id)}</a><small>${escapeHtml(date)} · ${escapeHtml(item.serviceNames.join(' + ') || 'Treatment')}</small></div><span>${item.price == null ? 'Price missing' : escapeHtml(formatRand(item.price))}</span><span class="${item.reason ? 'earnings-review' : ''}">${escapeHtml(item.reason || `${item.ratePercent}% · ${formatRand(item.commission)} commission`)}</span></div>`;
    }).join('');
    return `<div class="earnings-person"><h3>${escapeHtml(row.name)}</h3><p>${escapeHtml(row.completedCount)} completed solo treatment${row.completedCount === 1 ? '' : 's'} · ${escapeHtml(formatRand(row.completedValue))} treatment value · ${escapeHtml(formatRand(row.commission))} calculated commission${row.reviewCount ? ` · ${escapeHtml(row.reviewCount)} to review` : ''}</p><div class="earnings-visits">${visits || '<div class="empty">No completed appointments in this period.</div>'}</div></div>`;
  }).join('');
  const staffOptions = people.filter(row => row.canAddRule).map(row => `<option value="${escapeHtml(row.staffId)}">${escapeHtml(row.name)}</option>`).join('');
  const serviceOptions = (earnings.services || []).map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
  const rules = (earnings.rules || []).map(rule => {
    const person = people.find(row => row.staffId === Number(rule.staff_id));
    if (!person) return '';
    return `<li>${escapeHtml(person.name)} · ${escapeHtml(rule.service_name || 'All treatments')} · ${escapeHtml(rule.rate_percent)}% from ${escapeHtml(rule.effective_from)}</li>`;
  }).join('');
  return `<details class="panel" id="staff-earnings" data-report-section data-staff-earnings><summary class="panel-heading"><div><span class="eyebrow">Private · Authorized staff</span><h3>Calculated commission & treatment value</h3><p>Completed appointments in the selected period. Open any appointment to review it in Calendar.</p></div></summary><div class="panel-body"><div class="earnings-summary"><article><span>Completed treatment value</span><strong>${escapeHtml(formatRand(completedValue))}</strong></article><article><span>Calculated commission</span><strong>${escapeHtml(formatRand(commission))}</strong></article><article><span>Needs review</span><strong>${escapeHtml(review)}</strong></article></div><p class="footer-note">These are treatment values and calculated commission, not payments received or a payroll statement. Priced solo treatments count toward treatment value even when a commission rule is missing; their commission remains uncalculated for review. Shared appointments and missing prices are excluded from totals. Abigail’s fixed monthly salary is separate.</p>${peopleHtml}<details id="commission-rules"><summary>Manage commission rules</summary><div class="panel-heading"><div><span class="eyebrow">Future rules</span><h3>Commission structure</h3><p>Set a rate for a team member, or a specific treatment. Treatment rates take priority; changes apply from their start date and preserve previous rates.</p></div></div><form data-commission-form data-csrf="${escapeHtml(csrfToken)}" class="rule-grid"><div class="field"><label for="rule-staff">Team member</label><select id="rule-staff" name="staffId" required>${staffOptions}</select></div><div class="field"><label for="rule-service">Treatment</label><select id="rule-service" name="serviceId"><option value="">All treatments</option>${serviceOptions}</select></div><div class="field"><label for="rule-rate">Commission percentage</label><input id="rule-rate" name="ratePercent" type="number" min="0" max="100" step="0.01" required></div><div class="field"><label for="rule-date">Effective from</label><input id="rule-date" name="effectiveFrom" type="date" min="${escapeHtml(earnings.earliestNewRuleDate)}" value="${escapeHtml(earnings.earliestNewRuleDate)}" required></div><button data-workspace-action="create" class="button primary" type="submit">Add commission rule</button><p class="rule-status" role="status" data-rule-status></p></form><details><summary>Current and past rules</summary><ul class="rule-list">${rules || '<li>No rules recorded.</li>'}</ul></details></details></div></details>`;
}

function commissionClientScript() {
  return workspaceErrorRecoveryClientScript() + `(()=>{'use strict';const form=document.querySelector('[data-commission-form]');if(!form)return;form.addEventListener('submit',async(event)=>{event.preventDefault();const status=form.querySelector('[data-rule-status]'),button=form.querySelector('button[type="submit"]');status.textContent='Saving rule…';status.classList.remove('error');button.disabled=true;try{const data=Object.fromEntries(new FormData(form));const response=await fetch('/calendar/reports/commission-rules',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':form.dataset.csrf},body:JSON.stringify(data)});const body=await response.json();if(!response.ok)throw window.ShilohErrorRecovery.failure(body,response,'Rule could not be saved.');window.location.reload()}catch(error){window.ShilohErrorRecovery.render(status,error,'error');status.classList.add('error');button.disabled=false}})})();`;
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

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatRand(value) {
  return `R${Math.max(0, Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
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
  csrfToken = '',
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
    ['today', 'Today'],
    ['week', 'This week'],
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
    <td data-label="Unbooked staff-hours">${escapeHtml(formatMinutes(row.remainingMinutes))}</td>
    <td data-label="Working time booked"><div class="util"><div class="util-track" aria-hidden="true"><div class="util-fill" style="width:${Math.max(0, Math.min(100, Number(row.utilisationPct || 0)))}%"></div></div><small>${escapeHtml(row.utilisationPct)}%</small></div></td>
  </tr>`).join('');

  const commissionReview = (model.staffEarnings?.staff || []).reduce((total, row) => total + row.reviewCount, 0);
  const showingText = model.authority?.reportScope === 'own_staff'
    ? 'Showing your appointments.'
    : selectedStaffId
      ? `Showing ${selectedStaff?.displayName || selectedStaff?.display_name || 'the selected team member'}.`
      : 'Showing the whole team.';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clinic reports — Shiloh Workspace</title><style>${workspaceShellStyles()}${reportStyles()}${phoneCapacityStyles()}${earningsStyles()}${reportSectionStyles()}${financialStyles()}${recordsStyles()}</style><script src="/calendar/reports/sections.js" defer></script><script src="${escapeHtml(staffAccessScriptPath)}" defer></script>${model.staffEarnings ? '<script src="/calendar/reports/commission.js" defer></script>' : ''}${model.financial?.records ? '<script src="/calendar/reports/finance-records.js" defer></script>' : ''}</head><body data-workspace-reports="true"><div class="workspace-frame">${renderWorkspaceNavigation({
    active: 'reports',
    displayName: model.authority?.displayName,
    calendarHref: '/calendar/read-only',
    clientsHref: '/calendar/clients',
    staffHref: '/calendar/team',
    servicesHref: '/calendar/services',
    reportsHref: '/calendar/reports',
  })}<div class="workspace-main"><div class="shell">
    <header class="topbar"><div class="brand"><h1>Clinic reports</h1><p>${model.financial ? 'Your clinic finances, treatments and team in one place.' : 'A clear view of appointments, team time and clients.'}</p></div><div class="topbar-side"><span class="truth-note">${model.staffEarnings ? 'Private · Authorized staff' : 'Read only'}</span></div></header>

    <section class="filter-panel" aria-label="Choose report period">
      <div class="preset-row"><span class="preset-label">Choose period</span>${presetLinks}</div>
      <form class="filter-grid" method="get" action="/calendar/reports">
        <details class="custom-period"${model.period.preset === 'custom' ? ' open' : ''}><summary>Custom dates</summary><div class="custom-fields"><div class="field"><label for="report-from">From</label><input id="report-from" name="from" type="date" value="${escapeHtml(model.period.startKey)}" required></div>
        <div class="field"><label for="report-to">To</label><input id="report-to" name="to" type="date" value="${escapeHtml(model.period.endInclusiveKey)}" required></div></div></details>
        <div class="field"><label for="report-staff">Team member · Team &amp; Activity</label><select id="report-staff" name="staff">${staffOptions.join('')}</select></div>
        <button data-workspace-action="secondary" class="button primary" type="submit">View report</button>
      </form>
      <div class="range-note"><span>${escapeHtml(formatDate(model.period.startKey))}–${escapeHtml(formatDate(model.period.endInclusiveKey))} · ${escapeHtml(model.period.dayCount)} day${model.period.dayCount === 1 ? '' : 's'}</span><span>${escapeHtml(showingText)}${model.financial ? ' Team and Activity only; Money always shows the whole clinic.' : ''}</span></div>
    </section>

    ${financialOverview(model)}
    <nav class="jump-row" aria-label="Report sections">${model.financial ? '<a class="jump-link" href="#money">Money</a>' : ''}<a class="jump-link" href="#team">Team</a><a class="jump-link" href="#activity">Activity</a></nav>

    ${model.financial ? `<details class="panel report-group" id="money" data-report-section><summary class="panel-heading"><div><h2>Money</h2><p>Whole clinic · receipts, balances${model.financial.records ? ', expenses and daily cash-up' : ''}.</p></div></summary><div class="panel-body">
      ${model.financial.records ? '<div class="report-tools"><a class="button" href="#financial-expenses">Record expense</a><a class="button" href="#financial-cashup">Review / close cash-up</a></div>' : ''}
      ${financialContext(model.financial)}
      ${financialSections(model.financial)}
      ${recordSections(model.financial.records, model.period, csrfToken)}
    </div></details>` : ''}

    <details class="panel report-group" id="team" data-report-section><summary class="panel-heading"><div><h2>Team</h2><p>Booking time${model.staffEarnings ? ' and calculated commission' : ''} · ${escapeHtml(showingText)}${commissionReview ? ` · ${escapeHtml(commissionReview)} commission ${commissionReview === 1 ? 'entry needs' : 'entries need'} review.` : ''}</p></div></summary><div class="panel-body">
      <div class="metrics" aria-label="Team booking time summary">
        <article class="metric-card"><span>Booked staff-hours</span><strong>${escapeHtml(formatMinutes(model.totals?.bookedMinutes))}</strong><small>Appointment time added across team members.</small></article>
        <article class="metric-card"><span>Unbooked staff-hours in selected period</span><strong>${escapeHtml(formatMinutes(model.totals?.remainingMinutes))}</strong><small>Includes elapsed time; not a list of bookable slots. Check Calendar for availability.</small></article>
        <article class="metric-card"><span>Working time booked</span><strong>${escapeHtml(model.totals?.utilisationPct || 0)}%</strong><small>Working hours after leave. Blocked time remains in the percentage's working-hour total.</small></article>
      </div>
        <details class="panel" id="team-time" data-report-section><summary class="panel-heading"><div><span class="eyebrow">Team</span><h3>Team booking time</h3><p>See how each team member's working time is being used.</p></div><span class="truth-note">${escapeHtml(model.closures || 0)} clinic closure${Number(model.closures || 0) === 1 ? '' : 's'}</span></summary><div class="panel-body">
          <p class="footer-note">Unbooked staff-hours subtract bookings, leave and blocked time; totals include elapsed time.</p><div class="table-scroll"><table class="capacity-table"><thead><tr><th>Team member</th><th>Working hours</th><th>Appointments</th><th>Blocked</th><th>Leave</th><th>Unbooked staff-hours</th><th>Working time booked</th></tr></thead><tbody>${capacityRows || '<tr><td colspan="7">No team hours are available for this period.</td></tr>'}</tbody></table></div>
        </div></details>

      ${staffEarningsSection(model.staffEarnings, model.period, csrfToken)}
    </div></details>

    <details class="panel report-group" id="activity" data-report-section><summary class="panel-heading"><div><h2>Activity</h2><p>Appointments, treatments and clients · ${escapeHtml(showingText)}</p></div></summary><div class="panel-body">
        <section class="panel"><div class="panel-heading"><div><span class="eyebrow">Appointments</span><h3>Appointment status</h3><p>${escapeHtml(model.appointments?.operational || 0)} appointment${Number(model.appointments?.operational || 0) === 1 ? '' : 's'} excluding cancellations · ${escapeHtml(model.appointments?.allRecorded || 0)} appointment${Number(model.appointments?.allRecorded || 0) === 1 ? '' : 's'} recorded, including cancellations.</p></div></div><div class="status-strip">${statusPills || '<div class="empty">No appointments were recorded in this period.</div>'}</div></section>
        <details class="panel" id="treatments" data-report-section><summary class="panel-heading"><div><span class="eyebrow">Treatments</span><h3>Treatments booked</h3><p>Which treatments were booked most often.</p></div></summary><div class="panel-body"><div class="service-list">${serviceRows || '<div class="empty">No treatments were booked in this period.</div>'}</div></div></details>

        <details class="panel" id="clients" data-report-section><summary class="panel-heading"><div><span class="eyebrow">Clients</span><h3>New and returning clients</h3><p>Clients with non-cancelled appointments in this period.</p></div></summary><div class="panel-body"><p class="footer-note">New means their first recorded non-cancelled appointment falls in this period; it does not confirm attendance. Contact details are not shown here.</p><div class="client-grid"><div class="client-stat"><strong>${escapeHtml(model.clients?.uniqueClients || 0)}</strong><span>Total clients</span></div><div class="client-stat"><strong>${escapeHtml(model.clients?.newClients || 0)}</strong><span>New</span></div><div class="client-stat"><strong>${escapeHtml(model.clients?.returningClients || 0)}</strong><span>Returning</span></div></div></div></details>

        <details class="panel" id="activity-comparison" data-report-section><summary class="panel-heading"><div><span class="eyebrow">Comparison</span><h3>Appointments compared with the previous period</h3><p>${model.period.preset === 'week' ? 'The same weekdays last week.' : model.period.preset === 'month' ? 'The same elapsed dates last month, up to its final day.' : 'The same number of days immediately before this report.'}</p></div></summary><div class="panel-body"><div class="trend-card"><div class="trend-number">${Number(model.trend?.delta || 0) > 0 ? '+' : ''}${escapeHtml(model.trend?.delta || 0)}</div><div class="trend-copy">${escapeHtml(trendSummary(model.trend))} This period: ${escapeHtml(model.trend?.currentOperationalAppointments || 0)} · Previous: ${escapeHtml(model.trend?.previousOperationalAppointments || 0)}.</div></div></div></details>
    </div></details>

    <p class="footer-note">Clinic reports can cover up to 31 days. Appointment and client sections are read only.</p>
  </div></div></div></body></html>`;
}

function renderReportsUnavailablePage({
  message = 'Clinic reports are temporarily unavailable. Please try again shortly.',
} = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clinic reports unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${reportStyles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'reports', reportsHref: '/calendar/reports' })}<div class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>Clinic reports unavailable</h1><p>${escapeHtml(message)}</p></div></header><section class="panel"><h2>Please try again in a moment.</h2><p class="footer-note">If the problem continues, return to Calendar and try Clinic reports again later.</p><p><a data-workspace-action="secondary" class="button" href="/calendar/read-only">Back to Calendar</a></p></section></div></div></div></body></html>`;
}

module.exports = {
  formatMinutes,
  formatDate,
  queryForPreset,
  statusLabel,
  trendSummary,
  formatTimestamp,
  formatRand,
  staffEarningsSection,
  commissionClientScript,
  reportSectionsClientScript,
  renderReportsPage,
  renderReportsUnavailablePage,
};
