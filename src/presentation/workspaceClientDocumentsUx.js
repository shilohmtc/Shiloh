'use strict';

const { escapeHtml } = require('./workspaceShell');
const { renderClientDetailPage, formatDateTime, acceptanceChannelLabel } = require('./workspaceClientsUx');

const documentPrintStyles = `@media print{.workspace-sidebar,.workspace-menu-toggle,.workspace-mobile-header,.workspace-nav,.detail-actions,.document-actions,.footer-note,.topbar-side{display:none!important}.workspace-frame,.workspace-main,.shell{display:block!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important}.history-panel,.profile-panel,.submission-panel{box-shadow:none!important;background:white!important}.document-text{white-space:pre-wrap;overflow-wrap:anywhere}body{background:white!important}}`;

function clientHref(id) {
  return `/calendar/clients/${encodeURIComponent(String(id))}`;
}

function renderConsultationHistory(model) {
  if (model.consultationHistoryRestricted) return '<p>Your Workspace access does not include consultation form history.</p>';
  if (model.consultationHistoryUnavailable) return '<p role="status">Consultation form history is temporarily unavailable. Please try again.</p>';
  const history = model.consultationHistory;
  if (!history) return '';
  const rows = (history.items || []).map(item => {
    const signed = formatDateTime(item.signedAt);
    const href = `${clientHref(model.client.id)}/consultation-forms/${encodeURIComponent(item.reference)}`;
    return `<article class="policy-history-row"><div><strong>${escapeHtml(item.formTitle)}</strong><br><span>Booking #${escapeHtml(item.appointmentId)} · Signed ${escapeHtml(signed.date)} ${escapeHtml(signed.time)}</span></div><span>${escapeHtml((item.services || []).join(' + '))}</span><div>${item.canOpen ? `<a class="button" data-workspace-action="secondary" href="${href}">View signed form</a>` : '<span>Completed and signed · Private answers restricted</span>'}</div></article>`;
  }).join('');
  const page = history.page || 0;
  const pageHref = next => `${clientHref(model.client.id)}?formsPage=${next}&policyOffset=${model.policyOffset || 0}#consultation-documents`;
  return `<div class="policy-history-list">${rows || '<p>No completed consultation forms are recorded for this client.</p>'}</div><nav class="pager" aria-label="Consultation form history pages">${page > 0 ? `<a class="pager-link" href="${pageHref(page-1)}">Newer forms</a>` : '<span></span>'}${history.hasMore ? `<a class="pager-link" href="${pageHref(page+1)}">Older forms</a>` : ''}</nav>`;
}

function injectClientConsultationHistory(html, model) {
  const body = renderConsultationHistory(model);
  if (!body) return html;
  const section = `<section class="history-panel" id="consultation-documents" data-client-consultation-history style="margin-bottom:12px"><header class="section-heading"><div><span class="eyebrow">Documents &amp; consent</span><h2>Consultation forms</h2></div></header>${body}</section>`;
  return html.replace('<section class="history-panel"><header class="section-heading"><div><span class="eyebrow">History</span>', `${section}<section class="history-panel"><header class="section-heading"><div><span class="eyebrow">History</span>`);
}

function renderPolicyDocument(model) {
  const record = model.acceptance;
  const accepted = formatDateTime(record.accepted_at);
  const profile = clientHref(model.client.id);
  const content = `<main data-policy-document><nav class="detail-actions" aria-label="Document navigation"><a class="button" href="${profile}#policy-documents">← Back to client</a></nav><article class="history-panel"><header class="section-heading"><div><span class="eyebrow">Recorded acceptance #${escapeHtml(record.id)}</span><h2>Booking Policy &amp; Terms</h2></div></header><h3>${escapeHtml(model.client.name)}</h3><p>Version: <strong>${escapeHtml(record.policy_version)}</strong><br>Accepted: ${escapeHtml(accepted.date)} ${escapeHtml(accepted.time)} (South Africa)<br>Channel: ${escapeHtml(acceptanceChannelLabel(record.channel))}${record.appointment_id ? `<br>Booking #${escapeHtml(record.appointment_id)}` : ''}</p>${record.organiser_acceptance ? '<p>This is the booking organiser’s acceptance. It does not record the other guest’s personal acceptance or treatment consent.</p>' : ''}<p>Electronic acceptance is recorded through the channel shown above.</p><div class="document-actions"><button class="button" data-workspace-action="secondary" data-print-document type="button">Print / Save PDF</button></div>${record.policy_text_snapshot ? `<h3>Policy wording recorded at acceptance</h3><div class="document-text" style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(record.policy_text_snapshot)}</div>` : '<p role="status"><strong>Historical record: policy wording was not captured.</strong> The version and acceptance date are recorded above. The current policy cannot be used as proof of the wording accepted then.</p>'}</article></main>`;
  const shell = renderClientDetailPage({ authority: model.authority, client: model.client, appointments: [], historyOffset: 0, pageSize: 20 }, { calendarNavigationAllowed: true });
  return shell.replace('Client detail', 'Booking policy record')
    .replace('Client profile and appointment history.', 'Recorded acceptance and policy wording.')
    .replace('Only appointments linked to this client are shown.', 'Read-only acceptance record. Viewing or printing does not change it.')
    .replace(/<main data-client-detail-view>[\s\S]*?<\/main>/, content)
    .replace('</style>', `${documentPrintStyles}</style>`)
    .replace('</body>', '<script src="/calendar/clients/documents.js" defer></script></body>');
}

function documentClientScript() {
  return "'use strict';document.addEventListener('click',function(event){if(event.target.closest('[data-print-document]'))window.print();});";
}

module.exports = { clientHref, documentPrintStyles, renderConsultationHistory, injectClientConsultationHistory, renderPolicyDocument, documentClientScript };
