const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

function formsStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#65736c;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--sand:#f2eee4;--amber:#8a642f;--amber-soft:#f7efe0;--rose:#8a514d;--rose-soft:#f6e9e7;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1160px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:14px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem;line-height:1.45;max-width:44rem}.truth-note{font-size:.74rem;color:var(--muted)}.status-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-bottom:14px}.status-card,.form-card,.notice{background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)}.status-card{border-radius:14px;padding:13px}.status-card span{display:block;color:var(--muted);font-size:.69rem;font-weight:800}.status-card strong{display:block;margin-top:5px;font-size:1.35rem;line-height:1}.notice{display:flex;align-items:flex-start;gap:10px;border-radius:15px;padding:13px 14px;margin-bottom:14px;background:var(--sand);box-shadow:none}.notice strong{display:block;font-size:.82rem}.notice p{margin:4px 0 0;color:var(--muted);font-size:.75rem;line-height:1.45}.form-list{display:grid;gap:11px}.form-card{border-radius:17px;padding:16px}.form-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.form-title{min-width:0}.form-title h2{margin:0;font-size:1.05rem}.form-title p{margin:4px 0 0;color:var(--muted);font-size:.73rem}.version-pill{flex:0 0 auto;border-radius:999px;padding:6px 9px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.68rem;font-weight:800}.form-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr) auto;gap:12px;margin-top:13px;padding-top:13px;border-top:1px solid var(--line)}.block-title{margin-bottom:6px;color:var(--muted);font-size:.65rem;font-weight:850;text-transform:uppercase;letter-spacing:.08em}.chip-row{display:flex;gap:6px;flex-wrap:wrap}.chip{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;padding:5px 9px;background:#fff;border:1px solid var(--line);font-size:.7rem;font-weight:720}.section-list{display:grid;gap:5px}.section-row{display:flex;justify-content:space-between;gap:10px;font-size:.72rem}.section-row span:last-child{color:var(--muted);white-space:nowrap}.question-count{align-self:center;text-align:right}.question-count strong{display:block;font-size:1.25rem}.question-count span{display:block;color:var(--muted);font-size:.66rem}.empty{padding:36px 18px;text-align:center;border:1px dashed var(--line-strong);border-radius:15px;color:var(--muted);background:var(--panel)}.footer-note{margin:14px 0 0;color:var(--muted);font-size:.71rem;line-height:1.5}@media(max-width:850px){.status-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.form-grid{grid-template-columns:1fr 1fr}.question-count{grid-column:1/-1;text-align:left}.question-count strong,.question-count span{display:inline;margin-right:5px}}@media(max-width:700px){.shell{padding:14px 12px 26px}.topbar{align-items:flex-start;flex-direction:column;padding-left:52px}.status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.status-card:last-child{grid-column:1/-1}.form-card{padding:14px}.form-grid{grid-template-columns:1fr}.question-count{grid-column:auto}.notice{padding:12px}.chip{min-height:34px}.form-head{gap:8px}.version-pill{padding:6px 8px}}`;
}

function labelStatus(status) {
  const labels = {
    not_sent: 'Not sent',
    sent: 'Sent',
    opened: 'Opened',
    completed: 'Completed',
    needs_review: 'Needs review',
  };
  return labels[status] || status;
}

function renderFormsPage(model = {}) {
  const activity = model.activity || {};
  const statusCards = ['not_sent', 'sent', 'opened', 'completed', 'needs_review']
    .map(status => `<div class="status-card"><span>${escapeHtml(labelStatus(status))}</span><strong>${escapeHtml(Number(activity[status] || 0))}</strong></div>`)
    .join('');

  const cards = (model.templates || []).map(form => {
    const serviceChips = (form.services || []).length
      ? form.services.map(service => `<span class="chip">${escapeHtml(service.name)}</span>`).join('')
      : '<span class="chip">No treatment linked</span>';
    const sections = (form.sections || []).map(section => `<div class="section-row"><span>${escapeHtml(section.title)}</span><span>${escapeHtml(section.itemCount)} item${Number(section.itemCount) === 1 ? '' : 's'}</span></div>`).join('');
    return `<article class="form-card" data-form-template="${escapeHtml(form.templateKey)}">
      <div class="form-head"><div class="form-title"><h2>${escapeHtml(form.title)}</h2><p>Used automatically for the linked treatment once client forms are switched on.</p></div><span class="version-pill">Version ${escapeHtml(form.version)}</span></div>
      <div class="form-grid">
        <div><div class="block-title">Linked treatments</div><div class="chip-row">${serviceChips}</div></div>
        <div><div class="block-title">Form sections</div><div class="section-list">${sections || '<span class="chip">No sections</span>'}</div></div>
        <div class="question-count"><strong>${escapeHtml(form.itemCount)}</strong><span>form items</span></div>
      </div>
    </article>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forms — Shiloh Workspace</title><style>${workspaceShellStyles()}${formsStyles()}</style></head><body data-workspace-forms="true"><div class="workspace-frame">${renderWorkspaceNavigation({
    active: 'forms',
    displayName: model.authority?.displayName,
    dashboardHref: '/calendar/workspace',
    calendarHref: '/calendar/read-only?view=week&staff=all',
    clientsHref: '/calendar/clients',
    messagesHref: '/calendar/messages',
    staffHref: '/calendar/team/staff-access',
    servicesHref: '/calendar/services',
    reportsHref: '/calendar/reports',
    clinicHoursHref: '/calendar/clinic-hours',
  })}<main class="workspace-main"><div class="shell">
    <header class="topbar"><div class="brand"><h1>Forms</h1><p>Consultation forms linked to treatments, with clear versions and completion status.</p></div><span class="truth-note">Protected Workspace</span></header>
    <section class="status-grid" aria-label="Form completion status">${statusCards}</section>
    <section class="notice" aria-label="Forms setup status"><div><strong>The form library is ready.</strong><p>The secure client form page and automatic WhatsApp sending will be connected next. No consultation answers are being collected or sent yet.</p></div></section>
    <section class="form-list" aria-label="Consultation form library">${cards || '<div class="empty">No consultation forms are available yet.</div>'}</section>
    <p class="footer-note">Client answers and practitioner notes are kept separate. Health information is not placed in WhatsApp messages, links or Calendar cards.</p>
  </div></main></div></body></html>`;
}

function renderFormsUnavailablePage({ message = 'Forms are temporarily unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forms — Shiloh Workspace</title><style>${workspaceShellStyles()}${formsStyles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'forms' })}<main class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>Forms</h1><p>${escapeHtml(message)}</p></div></header></div></main></div></body></html>`;
}

module.exports = {
  formsStyles,
  labelStatus,
  renderFormsPage,
  renderFormsUnavailablePage,
};
