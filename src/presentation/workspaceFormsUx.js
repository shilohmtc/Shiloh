const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

function formsStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#65736c;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--sand:#f2eee4;--amber:#8a642f;--amber-soft:#f7efe0;--rose:#8a514d;--rose-soft:#f6e9e7;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1160px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:14px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem;line-height:1.45;max-width:44rem}.truth-note{font-size:.74rem;color:var(--muted)}.status-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-bottom:14px}.status-card,.form-card,.notice,.preview-panel,.submission-panel,.submission-card{background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)}.status-card{border-radius:14px;padding:13px}.status-card span{display:block;color:var(--muted);font-size:.69rem;font-weight:800}.status-card strong{display:block;margin-top:5px;font-size:1.35rem;line-height:1}.notice{display:flex;align-items:flex-start;gap:10px;border-radius:15px;padding:13px 14px;margin-bottom:14px;background:var(--sand);box-shadow:none}.notice strong{display:block;font-size:.82rem}.notice p{margin:4px 0 0;color:var(--muted);font-size:.75rem;line-height:1.45}.section-title-row{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:18px 0 9px}.section-title-row h2{margin:0;font-size:1rem}.section-title-row p{margin:3px 0 0;color:var(--muted);font-size:.7rem}.submission-list{display:grid;gap:8px}.submission-card{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;gap:12px;align-items:center;border-radius:15px;padding:13px 14px}.submission-main strong{display:block;font-size:.84rem}.submission-main span,.submission-meta{display:block;margin-top:3px;color:var(--muted);font-size:.69rem;line-height:1.4}.submission-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.submission-tag{display:inline-flex;border-radius:999px;padding:4px 7px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.62rem;font-weight:850}.submission-tag.test{background:var(--amber-soft);color:var(--amber)}.submission-action{justify-self:end;display:inline-flex;align-items:center;min-height:36px;border-radius:999px;padding:7px 10px;background:#fff;border:1px solid var(--line-strong);text-decoration:none;font-size:.68rem;font-weight:850;color:var(--leaf-deep)}.submission-action:hover{border-color:var(--leaf)}.submission-restricted{justify-self:end;color:var(--muted);font-size:.65rem;max-width:130px;text-align:right}.form-list{display:grid;gap:11px}.form-card{display:block;border-radius:17px;padding:16px;text-decoration:none;color:inherit;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease}.form-card:hover{transform:translateY(-1px);border-color:var(--line-strong);box-shadow:0 11px 32px rgba(32,50,43,.1)}.form-card:focus-visible{outline:3px solid var(--leaf);outline-offset:3px}.form-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.form-title{min-width:0}.form-title h2{margin:0;font-size:1.05rem}.form-title p{margin:4px 0 0;color:var(--muted);font-size:.73rem}.version-pill,.preview-pill{flex:0 0 auto;border-radius:999px;padding:6px 9px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.68rem;font-weight:800}.form-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr) auto;gap:12px;margin-top:13px;padding-top:13px;border-top:1px solid var(--line)}.block-title{margin-bottom:6px;color:var(--muted);font-size:.65rem;font-weight:850;text-transform:uppercase;letter-spacing:.08em}.chip-row{display:flex;gap:6px;flex-wrap:wrap}.chip{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;padding:5px 9px;background:#fff;border:1px solid var(--line);font-size:.7rem;font-weight:720}.section-list{display:grid;gap:5px}.section-row{display:flex;justify-content:space-between;gap:10px;font-size:.72rem}.section-row span:last-child{color:var(--muted);white-space:nowrap}.question-count{align-self:center;text-align:right}.question-count strong{display:block;font-size:1.25rem}.question-count span{display:block;color:var(--muted);font-size:.66rem}.view-cue{display:inline-flex;align-items:center;gap:5px;margin-top:11px;color:var(--leaf-deep);font-size:.74rem;font-weight:850}.empty{padding:30px 18px;text-align:center;border:1px dashed var(--line-strong);border-radius:15px;color:var(--muted);background:var(--panel)}.footer-note{margin:14px 0 0;color:var(--muted);font-size:.71rem;line-height:1.5}.preview-shell{max-width:820px}.preview-back{display:inline-flex;align-items:center;min-height:42px;margin-bottom:12px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 12px;background:#fff;text-decoration:none;font-size:.77rem;font-weight:800}.preview-back:hover{border-color:var(--leaf);color:var(--leaf-deep)}.preview-panel,.submission-panel{border-radius:19px;padding:20px}.preview-hero{display:grid;gap:10px;padding-bottom:18px;border-bottom:1px solid var(--line)}.preview-hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.preview-hero h1{margin:0;font-size:1.5rem;line-height:1.15}.preview-hero p{margin:0;color:var(--muted);font-size:.84rem;line-height:1.5}.preview-meta{display:flex;gap:7px;flex-wrap:wrap}.preview-section{padding:20px 0 4px}.preview-section+.preview-section{border-top:1px solid var(--line)}.preview-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:13px}.preview-section-head h2{margin:0;font-size:1.03rem}.preview-section-head span{color:var(--muted);font-size:.68rem}.preview-group{padding:14px;border:1px solid var(--line);border-radius:15px;background:#fff;margin-bottom:11px}.preview-group h3{margin:0 0 11px;font-size:.88rem}.preview-item{padding:12px 0}.preview-item+.preview-item{border-top:1px solid #edf0ed}.preview-label{display:flex;align-items:flex-start;gap:6px;font-size:.8rem;font-weight:760;line-height:1.42}.required{color:var(--rose);font-weight:900}.answer-row{display:flex;gap:7px;margin-top:9px}.answer-choice{display:inline-flex;align-items:center;justify-content:center;min-width:70px;min-height:38px;border:1px solid var(--line-strong);border-radius:999px;background:var(--paper);color:var(--muted);font-size:.74rem;font-weight:800}.response-box{min-height:42px;margin-top:9px;border:1px dashed var(--line-strong);border-radius:11px;padding:11px;background:var(--paper);color:var(--muted);font-size:.73rem;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}.response-box.tall{min-height:70px}.response-box.answer{border-style:solid;color:var(--ink);background:#fff}.follow-up{margin:9px 0 0 14px;padding:10px 11px;border-left:3px solid var(--leaf-soft);background:#fafbf9;border-radius:0 10px 10px 0;color:var(--muted);font-size:.72rem;line-height:1.42}.consent-card{margin-top:17px;padding:16px;border-radius:15px;background:var(--sand);border:1px solid var(--line)}.consent-card h2{margin:0 0 8px;font-size:.95rem}.consent-card p{margin:0;color:var(--muted);font-size:.75rem;line-height:1.55}.signature-preview{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.signature-line{min-height:56px;border:1px dashed var(--line-strong);border-radius:11px;padding:10px;background:#fff;color:var(--muted);font-size:.7rem}.signature-line strong{display:block;margin-top:5px;color:var(--ink);font-size:.82rem}.preview-warning{margin-top:14px;color:var(--muted);font-size:.7rem;line-height:1.45;text-align:center}.sensitive-banner{margin-bottom:13px;padding:12px 13px;border-radius:13px;background:var(--rose-soft);color:#6f3f3b;border:1px solid #e5cbc8;font-size:.72rem;line-height:1.45}.test-banner{margin-bottom:13px;padding:12px 13px;border-radius:13px;background:var(--amber-soft);color:#6d522a;border:1px solid #ead9b9;font-size:.72rem;line-height:1.45}@media(max-width:850px){.status-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.form-grid{grid-template-columns:1fr 1fr}.question-count{grid-column:1/-1;text-align:left}.question-count strong,.question-count span{display:inline;margin-right:5px}.submission-card{grid-template-columns:1fr auto}.submission-meta{grid-column:1/2}.submission-action,.submission-restricted{grid-column:2/3;grid-row:1/3}}@media(max-width:700px){.shell{padding:14px 12px 26px}.topbar{align-items:flex-start;flex-direction:column;padding-left:52px}.status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.status-card:last-child{grid-column:1/-1}.form-card{padding:14px}.form-grid{grid-template-columns:1fr}.question-count{grid-column:auto}.notice{padding:12px}.chip{min-height:34px}.form-head{gap:8px}.version-pill{padding:6px 8px}.preview-shell{padding-top:68px}.preview-panel,.submission-panel{padding:15px}.preview-hero-top{display:grid}.preview-hero h1{font-size:1.3rem}.preview-section{padding-top:16px}.preview-group{padding:12px}.signature-preview{grid-template-columns:1fr}.answer-choice{min-height:42px;min-width:76px}.submission-card{grid-template-columns:1fr}.submission-meta,.submission-action,.submission-restricted{grid-column:auto;grid-row:auto;justify-self:start;text-align:left}.section-title-row{align-items:flex-start;flex-direction:column}}`;
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

function formHref(templateKey) {
  return `/calendar/forms/${encodeURIComponent(String(templateKey || ''))}`;
}

function submissionHref(item = {}) {
  return `/calendar/forms/submissions/${encodeURIComponent(String(item.kind || ''))}/${encodeURIComponent(String(item.reference || ''))}`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function renderSubmissionList(submissions = {}) {
  const items = Array.isArray(submissions.items) ? submissions.items : [];
  if (!items.length) return '<div class="empty">No completed consultation forms yet.</div>';
  return `<div class="submission-list">${items.map(item => {
    const service = (item.services || []).join(' + ') || (item.isTest ? 'Private form test' : 'Consultation form');
    const submitted = formatDateTime(item.submittedAt);
    const tags = `${item.isTest ? '<span class="submission-tag test">TEST</span>' : ''}<span class="submission-tag">${escapeHtml(labelStatus(item.status || 'completed'))}</span>`;
    const action = item.canOpen
      ? `<a class="submission-action" href="${escapeHtml(submissionHref(item))}">Open form →</a>`
      : '<span class="submission-restricted">Private answers restricted</span>';
    return `<article class="submission-card" data-form-submission="${escapeHtml(item.kind)}">
      <div class="submission-main"><strong>${escapeHtml(item.clientName || 'Client')}</strong><span>${escapeHtml(item.formTitle || 'Consultation form')}</span><div class="submission-tags">${tags}</div></div>
      <div class="submission-meta"><strong>${escapeHtml(service)}</strong>${submitted ? `<span>Submitted ${escapeHtml(submitted)}</span>` : ''}</div>
      ${action}
    </article>`;
  }).join('')}</div>`;
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
    return `<a class="form-card" data-form-template="${escapeHtml(form.templateKey)}" href="${escapeHtml(formHref(form.templateKey))}" aria-label="Preview ${escapeHtml(form.title)}">
      <div class="form-head"><div class="form-title"><h2>${escapeHtml(form.title)}</h2><p>Used automatically for the linked treatment once client forms are switched on.</p></div><span class="version-pill">Version ${escapeHtml(form.version)}</span></div>
      <div class="form-grid">
        <div><div class="block-title">Linked treatments</div><div class="chip-row">${serviceChips}</div></div>
        <div><div class="block-title">Form sections</div><div class="section-list">${sections || '<span class="chip">No sections</span>'}</div></div>
        <div class="question-count"><strong>${escapeHtml(form.itemCount)}</strong><span>form items</span></div>
      </div>
      <span class="view-cue">Preview form <span aria-hidden="true">→</span></span>
    </a>`;
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
    <header class="topbar"><div class="brand"><h1>Forms</h1><p>Consultation forms, secure submissions and completion status in one protected workspace.</p></div><span class="truth-note">Protected Workspace</span></header>
    <section class="status-grid" aria-label="Form completion status">${statusCards}</section>
    <section class="notice" aria-label="Forms setup status"><div><strong>Consultation forms are protected.</strong><p>Form templates can be previewed below. Completed submissions appear here without placing health answers in WhatsApp, Calendar cards or ordinary client lists.</p></div></section>
    <div class="section-title-row"><div><h2>Recent submissions</h2><p>Completed client forms and isolated private tests.</p></div></div>
    <section aria-label="Recent consultation form submissions">${renderSubmissionList(model.submissions || {})}</section>
    <div class="section-title-row"><div><h2>Form library</h2><p>Preview the exact questionnaire clients will receive.</p></div></div>
    <section class="form-list" aria-label="Consultation form library">${cards || '<div class="empty">No consultation forms are available yet.</div>'}</section>
    <p class="footer-note">Client answers and practitioner notes are kept separate. Access to decrypted health answers is limited to authorised reviewers.</p>
  </div></main></div></body></html>`;
}

function responsePlaceholder(item = {}) {
  const type = String(item.type || '');
  if (type.startsWith('prefill_')) return 'Prefilled from the client profile when the form is sent.';
  if (type === 'textarea') return 'Client response';
  if (type === 'date') return 'Date';
  return 'Client response';
}

function renderPreviewItem(item = {}) {
  const label = String(item.label || 'Form item');
  const required = item.required === true ? '<span class="required" aria-label="required">*</span>' : '';
  const type = String(item.type || 'text');
  let answer;
  if (type === 'yes_no') {
    answer = '<div class="answer-row" aria-label="Yes or No options"><span class="answer-choice">Yes</span><span class="answer-choice">No</span></div>';
  } else {
    const tall = type === 'textarea' ? ' tall' : '';
    answer = `<div class="response-box${tall}">${escapeHtml(responsePlaceholder(item))}</div>`;
  }
  const followUp = item.follow_up && item.follow_up.label
    ? `<div class="follow-up"><strong>If Yes:</strong> ${escapeHtml(item.follow_up.label)}</div>`
    : '';
  return `<div class="preview-item"><div class="preview-label"><span>${escapeHtml(label)}</span>${required}</div>${answer}${followUp}</div>`;
}

function renderPreviewGroup(group = {}) {
  const fields = Array.isArray(group.fields) ? group.fields : [];
  const questions = Array.isArray(group.questions) ? group.questions : [];
  const items = [...fields, ...questions];
  return `<section class="preview-group"><h3>${escapeHtml(group.title || 'Form details')}</h3>${items.map(renderPreviewItem).join('')}</section>`;
}

function renderFormPreviewPage(model = {}) {
  const form = model.form || {};
  const serviceChips = (form.services || []).length
    ? form.services.map(service => `<span class="chip">${escapeHtml(service.name)}</span>`).join('')
    : '<span class="chip">No treatment linked</span>';
  const sections = (form.sections || []).map(section => {
    const groups = Array.isArray(section.definition?.groups) ? section.definition.groups : [];
    return `<section class="preview-section" data-form-section="${escapeHtml(section.sectionKey)}">
      <div class="preview-section-head"><h2>${escapeHtml(section.title)}</h2><span>Section version ${escapeHtml(section.version)}</span></div>
      ${groups.map(renderPreviewGroup).join('') || '<div class="empty">No form items in this section.</div>'}
    </section>`;
  }).join('');
  const signatureRequired = form.settings?.signature_required === true;
  const signedNameRequired = form.settings?.signed_name_required === true;
  const signedDateRequired = form.settings?.signed_date_required === true;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(form.title || 'Form preview')} — Shiloh Workspace</title><style>${workspaceShellStyles()}${formsStyles()}</style></head><body data-workspace-form-preview="true"><div class="workspace-frame">${renderWorkspaceNavigation({
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
  })}<main class="workspace-main"><div class="shell preview-shell">
    <a class="preview-back" href="/calendar/forms">← Back to Forms</a>
    <article class="preview-panel">
      <header class="preview-hero">
        <div class="preview-hero-top"><div><h1>${escapeHtml(form.title || 'Consultation form')}</h1></div><span class="preview-pill">Staff preview · Version ${escapeHtml(form.version || 0)}</span></div>
        <p>This is a read-only preview of the client questionnaire. Nothing you tap here is saved or submitted.</p>
        <div class="preview-meta">${serviceChips}</div>
      </header>
      ${sections || '<div class="empty">This form has no sections yet.</div>'}
      <section class="consent-card">
        <h2>Consent & declaration</h2>
        <p>${escapeHtml(form.consentText || 'No consent text is configured.')}</p>
        ${signatureRequired ? `<div class="signature-preview">${signedNameRequired ? '<div class="signature-line">Client full name</div>' : ''}${signedDateRequired ? '<div class="signature-line">Date signed</div>' : ''}<div class="signature-line">Digital signature</div></div>` : ''}
      </section>
      <p class="preview-warning">Preview only — client answers, signatures and practitioner notes are not being collected on this screen.</p>
    </article>
  </div></main></div></body></html>`;
}

function answerText(value) {
  if (value == null || String(value).trim() === '') return 'Not provided';
  const text = String(value);
  if (text.toLowerCase() === 'yes') return 'Yes';
  if (text.toLowerCase() === 'no') return 'No';
  return text;
}

function renderSubmissionAnswerItem(item = {}, answers = {}) {
  const key = String(item.key || '');
  const value = answers[key];
  const followKey = item.follow_up?.key ? String(item.follow_up.key) : '';
  const followValue = followKey ? answers[followKey] : null;
  const follow = followKey && followValue != null && String(followValue).trim()
    ? `<div class="follow-up"><strong>${escapeHtml(item.follow_up.label || 'Additional details')}</strong><div class="response-box answer">${escapeHtml(answerText(followValue))}</div></div>`
    : '';
  return `<div class="preview-item"><div class="preview-label">${escapeHtml(item.label || key)}</div><div class="response-box answer">${escapeHtml(answerText(value))}</div>${follow}</div>`;
}

function renderSubmissionGroup(group = {}, answers = {}) {
  const fields = Array.isArray(group.fields) ? group.fields : [];
  const questions = Array.isArray(group.questions) ? group.questions : [];
  return `<section class="preview-group"><h3>${escapeHtml(group.title || 'Details')}</h3>${[...fields, ...questions].map(item => renderSubmissionAnswerItem(item, answers)).join('')}</section>`;
}

function renderSubmissionPage(model = {}) {
  const form = model.form || {};
  const answers = model.answers || {};
  const sections = (form.sections || []).map(section => {
    const groups = Array.isArray(section.definition?.groups) ? section.definition.groups : [];
    return `<section class="preview-section"><div class="preview-section-head"><h2>${escapeHtml(section.title || 'Consultation')}</h2><span>Signed form</span></div>${groups.map(group => renderSubmissionGroup(group, answers)).join('')}</section>`;
  }).join('');
  const appointment = model.appointment || {};
  const appointmentWhen = formatDateTime(appointment.startsAt);
  const treatment = (appointment.services || []).join(' + ');
  const practitioner = (appointment.practitioners || []).join(' & ');
  const signed = formatDateTime(model.signedAt);
  const signatureName = String(model.signature?.name || '');
  const metaChips = [model.isTest ? 'Private test' : treatment, practitioner, appointmentWhen].filter(Boolean)
    .map(text => `<span class="chip">${escapeHtml(text)}</span>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(model.clientName || 'Client')} — Form submission</title><style>${workspaceShellStyles()}${formsStyles()}</style></head><body data-workspace-form-submission="true"><div class="workspace-frame">${renderWorkspaceNavigation({
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
  })}<main class="workspace-main"><div class="shell preview-shell">
    <a class="preview-back" href="/calendar/forms">← Back to Forms</a>
    ${model.isTest ? '<div class="test-banner"><strong>TEST SUBMISSION.</strong> This isolated submission is not attached to a client or appointment.</div>' : '<div class="sensitive-banner"><strong>Private health information.</strong> View only when needed for treatment preparation and do not copy it into WhatsApp or ordinary Calendar notes.</div>'}
    <article class="submission-panel">
      <header class="preview-hero">
        <div class="preview-hero-top"><div><h1>${escapeHtml(model.clientName || 'Client')}</h1><p>${escapeHtml(form.title || 'Consultation form')}</p></div><span class="preview-pill">${model.isTest ? 'Test complete' : escapeHtml(labelStatus(model.status || 'completed'))}</span></div>
        <div class="preview-meta">${metaChips}</div>
      </header>
      ${sections || '<div class="empty">No questionnaire snapshot is available.</div>'}
      <section class="consent-card"><h2>Consent & declaration signed</h2><p>${escapeHtml(form.consentText || 'No declaration snapshot is available.')}</p>
        <div class="signature-preview"><div class="signature-line">Electronic signature<strong>${escapeHtml(signatureName || 'Not available')}</strong></div><div class="signature-line">Signed at<strong>${escapeHtml(signed || 'Not available')}</strong></div></div>
      </section>
      <p class="preview-warning">Read-only signed record. The encrypted stored submission is not modified when viewed.</p>
    </article>
  </div></main></div></body></html>`;
}

function renderFormsUnavailablePage({ message = 'Forms are temporarily unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forms — Shiloh Workspace</title><style>${workspaceShellStyles()}${formsStyles()}</style></head><body><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'forms' })}<main class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>Forms</h1><p>${escapeHtml(message)}</p></div></header><a class="preview-back" href="/calendar/forms">Back to Forms</a></div></main></div></body></html>`;
}

module.exports = {
  formsStyles,
  labelStatus,
  formHref,
  submissionHref,
  formatDateTime,
  renderSubmissionList,
  renderFormsPage,
  responsePlaceholder,
  renderPreviewItem,
  renderPreviewGroup,
  renderFormPreviewPage,
  answerText,
  renderSubmissionAnswerItem,
  renderSubmissionGroup,
  renderSubmissionPage,
  renderFormsUnavailablePage,
};
