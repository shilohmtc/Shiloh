const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');
const { formsStyles } = require('./workspaceFormsUx');

function previewStyles() {
  return `.preview-back{display:inline-flex;align-items:center;min-height:42px;margin-bottom:12px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 12px;background:#fff;text-decoration:none;font-size:.76rem;font-weight:800}.preview-panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow);margin-bottom:13px}.preview-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.preview-banner{border-radius:14px;padding:12px 13px;margin-bottom:14px;background:var(--sand);border:1px solid var(--line);color:var(--muted);font-size:.76rem;line-height:1.45}.preview-banner strong{color:var(--ink)}.preview-section{border-top:1px solid var(--line);padding-top:17px;margin-top:17px}.preview-section:first-child{border-top:0;padding-top:0;margin-top:0}.preview-section h2{margin:0;font-size:1.05rem}.preview-section>p{margin:4px 0 0;color:var(--muted);font-size:.72rem}.preview-group{margin-top:15px}.preview-group h3{margin:0 0 8px;font-size:.84rem}.preview-items{display:grid;gap:8px}.preview-item{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px}.preview-label{font-size:.8rem;font-weight:760;line-height:1.42}.preview-required{margin-left:5px;color:var(--rose);font-size:.64rem;font-weight:850}.preview-answer{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.preview-choice,.preview-placeholder{display:inline-flex;align-items:center;min-height:32px;border:1px solid var(--line);border-radius:9px;padding:6px 9px;background:var(--paper);color:var(--muted);font-size:.69rem}.preview-placeholder{width:min(100%,440px);min-height:38px}.preview-followup{margin-top:8px;padding-left:10px;border-left:2px solid var(--leaf-soft);color:var(--muted);font-size:.69rem;line-height:1.4}.consent-copy{white-space:pre-wrap;font-size:.78rem;line-height:1.55;color:var(--ink)}.signature-line{margin-top:12px;border-top:1px dashed var(--line-strong);padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:9px}.signature-box{min-height:48px;border:1px solid var(--line);border-radius:11px;padding:10px;color:var(--muted);font-size:.7rem}@media(max-width:700px){.preview-panel{padding:14px}.signature-line{grid-template-columns:1fr}}`;
}

function renderField(field = {}) {
  const type = String(field.type || 'text');
  const required = field.required === true ? '<span class="preview-required">Required</span>' : '';
  const label = `<div class="preview-label">${escapeHtml(field.label || field.key || 'Question')}${required}</div>`;
  if (type === 'yes_no') {
    const followUp = field.follow_up?.label
      ? `<div class="preview-followup">If Yes: ${escapeHtml(field.follow_up.label)}</div>`
      : '';
    return `<div class="preview-item">${label}<div class="preview-answer"><span class="preview-choice">Yes</span><span class="preview-choice">No</span></div>${followUp}</div>`;
  }
  const placeholder = type === 'prefill_date' ? 'Date field' : type === 'textarea' ? 'Long answer field' : type.startsWith('prefill_') ? 'Prefilled from client profile where available' : 'Answer field';
  return `<div class="preview-item">${label}<div class="preview-answer"><span class="preview-placeholder">${escapeHtml(placeholder)}</span></div></div>`;
}

function renderGroup(group = {}) {
  const items = [...(Array.isArray(group.fields) ? group.fields : []), ...(Array.isArray(group.questions) ? group.questions : [])];
  return `<section class="preview-group"><h3>${escapeHtml(group.title || 'Questions')}</h3><div class="preview-items">${items.map(renderField).join('')}</div></section>`;
}

function renderSection(section = {}) {
  const groups = Array.isArray(section.definition?.groups) ? section.definition.groups : [];
  return `<section class="preview-section"><h2>${escapeHtml(section.title || section.sectionKey || 'Section')}</h2><p>Section version ${escapeHtml(section.version || 1)}</p>${groups.map(renderGroup).join('')}</section>`;
}

function renderFormPreviewPage(model = {}) {
  const template = model.template || {};
  const services = (template.services || []).length
    ? template.services.map(service => `<span class="chip">${escapeHtml(service.name)}</span>`).join('')
    : '<span class="chip">No treatment linked</span>';
  const signatureRequired = template.settings?.signature_required === true;
  const signedNameRequired = template.settings?.signed_name_required === true;
  const signedDateRequired = template.settings?.signed_date_required === true;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(template.title || 'Form')} — Shiloh Workspace</title><style>${workspaceShellStyles()}${formsStyles()}${previewStyles()}</style></head><body data-workspace-form-preview="true"><div class="workspace-frame">${renderWorkspaceNavigation({
    active: 'forms',
    displayName: model.authority?.displayName,
    dashboardHref: '/calendar/workspace',
    calendarHref: '/calendar/read-only?view=week&staff=all',
    clientsHref: '/calendar/clients',
    messagesHref: '/calendar/messages',
    staffHref: '/calendar/team/staff-access',
    servicesHref: '/calendar/services',
    formsHref: '/calendar/forms',
    reportsHref: '/calendar/reports',
    clinicHoursHref: '/calendar/clinic-hours',
  })}<main class="workspace-main"><div class="shell">
    <a class="preview-back" href="/calendar/forms">← Forms</a>
    <header class="topbar"><div class="brand"><h1>${escapeHtml(template.title || 'Consultation form')}</h1><p>This is the staff preview of what will become the secure client consultation form.</p></div><span class="version-pill">Version ${escapeHtml(template.version || 1)}</span></header>
    <div class="preview-banner"><strong>Preview only.</strong> Nothing entered here is saved and this page cannot be sent to a client. The secure client form and signature submission flow will be added next.</div>
    <section class="preview-panel"><div class="block-title">Linked treatment</div><div class="preview-meta">${services}</div></section>
    <section class="preview-panel">${(template.sections || []).map(renderSection).join('') || '<div class="empty">No form sections are available.</div>'}</section>
    <section class="preview-panel"><div class="preview-section"><h2>Consent & signature</h2><p>Current versioned consent text</p><div class="consent-copy">${escapeHtml(template.consentText || '')}</div>${signatureRequired ? `<div class="signature-line"><div class="signature-box">${signedNameRequired ? 'Signed name' : 'Signature'}</div><div class="signature-box">${signedDateRequired ? 'Signed date' : 'Date'}</div></div>` : ''}</div></section>
    <p class="footer-note">This preview contains the form questions only. It does not display any client answers or practitioner notes.</p>
  </div></main></div></body></html>`;
}

module.exports = {
  previewStyles,
  renderField,
  renderGroup,
  renderSection,
  renderFormPreviewPage,
};
