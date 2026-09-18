const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

const SPORTS_TEMPLATE_KEY = 'remedial_sports_massage_consultation';

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

function sportsAssessmentHref(reference) {
  return `/calendar/forms/submissions/client/${encodeURIComponent(String(reference || ''))}/assessment`;
}

function decorateSportsSubmissionHtml(html, model = {}) {
  if (model.kind !== 'client' || String(model.form?.templateKey || '') !== SPORTS_TEMPLATE_KEY) return html;
  const reference = String(model.reference || '');
  if (!/^\d+$/.test(reference)) return html;
  const marker = '<p class="preview-warning">';
  const link = `<div style="display:flex;justify-content:flex-end;margin-top:16px"><a class="submission-action" href="${escapeHtml(sportsAssessmentHref(reference))}">Open practitioner assessment →</a></div>`;
  return String(html || '').includes(marker)
    ? String(html).replace(marker, `${link}${marker}`)
    : String(html || '');
}

function assessmentStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#65736c;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--sand:#f2eee4;--amber:#8a642f;--amber-soft:#f7efe0;--red:#934f4b;--red-soft:#f6e7e5;--blue:#44698d;--blue-soft:#e8f0f7;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.assessment-shell{max-width:980px;margin:0 auto;padding:22px}.assessment-back{display:inline-flex;align-items:center;min-height:42px;margin-bottom:12px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 12px;background:#fff;color:var(--ink);text-decoration:none;font-size:.77rem;font-weight:800}.assessment-card{background:var(--panel);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:hidden}.assessment-hero{display:grid;gap:10px;padding:20px;border-bottom:1px solid var(--line)}.assessment-hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.assessment-hero h1{margin:0;font-size:1.5rem;line-height:1.15}.assessment-hero p{margin:4px 0 0;color:var(--muted);font-size:.82rem;line-height:1.45}.assessment-badge{flex:0 0 auto;border-radius:999px;padding:6px 9px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.67rem;font-weight:850}.assessment-meta{display:flex;gap:7px;flex-wrap:wrap}.assessment-chip{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;padding:5px 9px;background:#fff;border:1px solid var(--line);font-size:.7rem;font-weight:720}.assessment-note{margin:14px 20px 0;padding:12px 13px;border:1px solid #d9e2dc;border-radius:13px;background:var(--leaf-soft);color:#315141;font-size:.72rem;line-height:1.5}.assessment-section{padding:20px}.assessment-section+.assessment-section{border-top:1px solid var(--line)}.assessment-section h2{margin:0;font-size:1.02rem}.assessment-section>p{margin:5px 0 14px;color:var(--muted);font-size:.73rem;line-height:1.45}.assessment-table{display:grid;gap:8px}.assessment-row{display:grid;grid-template-columns:minmax(140px,.8fr) minmax(150px,.8fr) minmax(180px,1.4fr);gap:8px}.assessment-row.two{grid-template-columns:minmax(150px,.75fr) minmax(220px,1.5fr)}.assessment-input,.assessment-textarea{width:100%;border:1px solid var(--line-strong);border-radius:11px;padding:10px 11px;background:#fff;color:var(--ink);font:inherit;font-size:.78rem}.assessment-textarea{min-height:90px;resize:vertical}.assessment-input:focus,.assessment-textarea:focus{outline:2px solid var(--leaf-soft);border-color:var(--leaf)}.assessment-input:disabled,.assessment-textarea:disabled{background:#f5f5f1;color:#65736c}.body-legend{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 12px;font-size:.71rem;color:var(--muted)}.body-legend span{display:inline-flex;align-items:center;gap:6px}.body-dot{width:11px;height:11px;border-radius:50%;border:1px solid var(--line-strong);background:#fff}.body-dot.primary{background:var(--red);border-color:var(--red)}.body-dot.secondary{background:var(--blue);border-color:var(--blue)}.body-map{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.body-region{min-height:48px;border:1px solid var(--line-strong);border-radius:12px;padding:8px 9px;background:#fff;color:var(--ink);font:inherit;font-size:.72rem;font-weight:750;cursor:pointer;text-align:left;display:flex;align-items:center;justify-content:space-between;gap:6px}.body-region span{font-size:.61rem;color:var(--muted);font-weight:800}.body-region[data-state="primary"]{background:var(--red-soft);border-color:#d8aaa5;color:#6f3632}.body-region[data-state="secondary"]{background:var(--blue-soft);border-color:#aac0d4;color:#355a7a}.body-region:disabled{cursor:default;opacity:.82}.assessment-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:18px 20px;border-top:1px solid var(--line);background:#fbfaf6}.assessment-save{min-height:44px;border:1px solid var(--leaf);border-radius:999px;padding:9px 16px;background:var(--leaf);color:#fff;font:inherit;font-size:.78rem;font-weight:850;cursor:pointer}.assessment-save:disabled{opacity:.58;cursor:wait}.assessment-status{min-height:1em;color:var(--muted);font-size:.72rem;line-height:1.4}.assessment-status[data-state="saved"]{color:var(--leaf-deep);font-weight:760}.assessment-status[data-state="error"]{color:#7a3d39}.assessment-footer{margin:12px 0 0;color:var(--muted);font-size:.68rem;line-height:1.45;text-align:center}@media(max-width:760px){.assessment-shell{padding:70px 12px 24px}.assessment-hero,.assessment-section{padding:15px}.assessment-note{margin:12px 15px 0}.assessment-hero-top{display:grid}.assessment-hero h1{font-size:1.28rem}.assessment-row,.assessment-row.two{grid-template-columns:1fr}.body-map{grid-template-columns:repeat(2,minmax(0,1fr))}.body-region{min-height:52px}.assessment-actions{padding:15px;align-items:stretch}.assessment-save{width:100%}}`;
}

function normalizedRows(rows, count, factory) {
  const output = Array.isArray(rows) ? rows.slice(0, count) : [];
  while (output.length < count) output.push(factory());
  return output;
}

function renderPosturalRows(record, canEdit) {
  return normalizedRows(record.posturalAnalysis, 8, () => ({ area: '', muscleState: '', notes: '' })).map((row, index) => `
    <div class="assessment-row" data-postural-row>
      <input class="assessment-input" data-field="area" aria-label="Postural area ${index + 1}" placeholder="Area of body" value="${escapeHtml(row.area || '')}" ${canEdit ? '' : 'disabled'}>
      <input class="assessment-input" data-field="muscleState" aria-label="Muscle state ${index + 1}" placeholder="Muscle state / tension" value="${escapeHtml(row.muscleState || '')}" ${canEdit ? '' : 'disabled'}>
      <input class="assessment-input" data-field="notes" aria-label="Postural notes ${index + 1}" placeholder="Observation" value="${escapeHtml(row.notes || '')}" ${canEdit ? '' : 'disabled'}>
    </div>`).join('');
}

function renderPainMap(model, canEdit) {
  const selected = new Map((model.record?.painMap || []).map(item => [String(item.area || ''), String(item.state || '')]));
  return (model.bodyRegions || []).map(area => {
    const state = selected.get(area) || 'none';
    const stateLabel = state === 'primary' ? 'Primary' : state === 'secondary' ? 'Secondary' : 'None';
    return `<button class="body-region" type="button" data-body-region="${escapeHtml(area)}" data-state="${escapeHtml(state)}" aria-pressed="${state !== 'none' ? 'true' : 'false'}" ${canEdit ? '' : 'disabled'}>${escapeHtml(area)}<span data-region-state>${escapeHtml(stateLabel)}</span></button>`;
  }).join('');
}

function renderPainRows(record, canEdit) {
  return normalizedRows(record.painConcerns, 6, () => ({ area: '', description: '' })).map((row, index) => `
    <div class="assessment-row two" data-pain-row>
      <input class="assessment-input" data-field="area" aria-label="Pain concern area ${index + 1}" placeholder="Area of body" value="${escapeHtml(row.area || '')}" ${canEdit ? '' : 'disabled'}>
      <input class="assessment-input" data-field="description" aria-label="Pain concern description ${index + 1}" placeholder="Pain / concern description" value="${escapeHtml(row.description || '')}" ${canEdit ? '' : 'disabled'}>
    </div>`).join('');
}

function renderTechniqueRows(record, canEdit) {
  return normalizedRows(record.techniques, 6, () => ({ technique: '', reason: '' })).map((row, index) => `
    <div class="assessment-row two" data-technique-row>
      <input class="assessment-input" data-field="technique" aria-label="Technique ${index + 1}" placeholder="Technique performed" value="${escapeHtml(row.technique || '')}" ${canEdit ? '' : 'disabled'}>
      <input class="assessment-input" data-field="reason" aria-label="Technique reason ${index + 1}" placeholder="Reason for performing the technique" value="${escapeHtml(row.reason || '')}" ${canEdit ? '' : 'disabled'}>
    </div>`).join('');
}

function renderPractitionerRecordPage(model = {}) {
  const record = model.record || {};
  const appointment = model.appointment || {};
  const treatment = (appointment.services || []).join(' + ');
  const practitioners = (appointment.practitioners || []).join(' & ');
  const appointmentWhen = formatDateTime(appointment.startsAt);
  const chips = [treatment, practitioners, appointmentWhen].filter(Boolean)
    .map(text => `<span class="assessment-chip">${escapeHtml(text)}</span>`).join('');
  const canEdit = model.canEdit === true;
  const actionPath = sportsAssessmentHref(model.submissionId);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(model.clientName || 'Client')} — Practitioner assessment</title><style>${workspaceShellStyles()}${assessmentStyles()}</style><script src="/calendar/forms/assessment-client.js" defer></script></head><body data-workspace-sports-assessment="true"><div class="workspace-frame">${renderWorkspaceNavigation({
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
  })}<main class="workspace-main"><div class="assessment-shell">
    <a class="assessment-back" href="/calendar/forms/submissions/client/${escapeHtml(String(model.submissionId || ''))}">← Back to signed form</a>
    <article class="assessment-card">
      <header class="assessment-hero"><div class="assessment-hero-top"><div><h1>Remedial / Sports assessment</h1><p><strong>${escapeHtml(model.clientName || 'Client')}</strong> · practitioner working record</p></div><span class="assessment-badge">Practitioner only · encrypted</span></div><div class="assessment-meta">${chips}</div></header>
      <div class="assessment-note"><strong>Keep the client form and practitioner record separate.</strong> Use this page for your assessment, pain mapping, techniques and after-care notes. The client’s signed answers stay unchanged.</div>
      <form data-assessment-form data-action="${escapeHtml(actionPath)}" data-revision="${escapeHtml(String(model.revision || 0))}">
        <section class="assessment-section"><h2>Postural analysis</h2><p>Record only the observations that are useful for this treatment.</p><div class="assessment-table">${renderPosturalRows(record, canEdit)}</div></section>
        <section class="assessment-section"><h2>Body map</h2><p>Tap an area to cycle through none, primary concern and secondary concern.</p><div class="body-legend"><span><i class="body-dot primary"></i>Primary concern</span><span><i class="body-dot secondary"></i>Secondary concern</span></div><div class="body-map" role="group" aria-label="Pain and concern body map">${renderPainMap(model, canEdit)}</div></section>
        <section class="assessment-section"><h2>Pain / concern details</h2><p>Add a short description for the areas that need context.</p><div class="assessment-table">${renderPainRows(record, canEdit)}</div></section>
        <section class="assessment-section"><h2>Techniques performed</h2><p>Record the technique and the reason it was used.</p><div class="assessment-table">${renderTechniqueRows(record, canEdit)}</div></section>
        <section class="assessment-section"><h2>Recommendations & notes</h2><p>Keep after-care recommendations separate from your private practitioner notes.</p><label><span class="block-title">Lifestyle recommendations</span><textarea class="assessment-textarea" data-lifestyle aria-label="Lifestyle recommendations" placeholder="Recommendations for the client" ${canEdit ? '' : 'disabled'}>${escapeHtml(record.lifestyleRecommendations || '')}</textarea></label><label style="display:block;margin-top:12px"><span class="block-title">Practitioner notes</span><textarea class="assessment-textarea" data-practitioner-notes aria-label="Practitioner notes" placeholder="Private practitioner notes" ${canEdit ? '' : 'disabled'}>${escapeHtml(record.practitionerNotes || '')}</textarea></label></section>
        <div class="assessment-actions">${canEdit ? '<button class="assessment-save" type="submit" data-save>Save practitioner assessment</button>' : '<span class="assessment-badge">Read only</span>'}<span class="assessment-status" data-status role="status" aria-live="polite">${model.updatedAt ? `Last saved ${escapeHtml(formatDateTime(model.updatedAt))}` : 'Not saved yet'}</span></div>
      </form>
    </article>
    <p class="assessment-footer">This practitioner record is stored encrypted and is not copied into WhatsApp or ordinary Calendar notes.</p>
  </div></main></div></body></html>`;
}

function workspaceSportsAssessmentClientScript() {
  return `(function(){
'use strict';
var form=document.querySelector('[data-assessment-form]');if(!form)return;
var save=form.querySelector('[data-save]');var status=form.querySelector('[data-status]');
function setStatus(state,text){if(!status)return;status.dataset.state=state||'';status.textContent=text||'';}
function fieldRows(selector,keys){return Array.prototype.slice.call(form.querySelectorAll(selector)).map(function(row){var item={};keys.forEach(function(key){var el=row.querySelector('[data-field="'+key+'"]');item[key]=el?el.value.trim():'';});return item;}).filter(function(item){return keys.some(function(key){return item[key];});});}
function painMap(){return Array.prototype.slice.call(form.querySelectorAll('[data-body-region]')).map(function(button){var state=button.dataset.state||'none';return state==='none'?null:{area:button.dataset.bodyRegion,state:state};}).filter(Boolean);}
function payload(){return {revision:Number(form.dataset.revision||0),posturalAnalysis:fieldRows('[data-postural-row]',['area','muscleState','notes']),painMap:painMap(),painConcerns:fieldRows('[data-pain-row]',['area','description']),techniques:fieldRows('[data-technique-row]',['technique','reason']),lifestyleRecommendations:(form.querySelector('[data-lifestyle]')||{}).value||'',practitionerNotes:(form.querySelector('[data-practitioner-notes]')||{}).value||''};}
function safeJson(response){return response.json().catch(function(){return {};});}
function postJson(url,body,csrf){var headers={'Content-Type':'application/json','Accept':'application/json'};if(csrf)headers['x-shiloh-csrf-token']=csrf;return fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers,body:JSON.stringify(body||{})});}
Array.prototype.forEach.call(form.querySelectorAll('[data-body-region]:not(:disabled)'),function(button){button.addEventListener('click',function(){var current=button.dataset.state||'none';var next=current==='none'?'primary':current==='primary'?'secondary':'none';button.dataset.state=next;button.setAttribute('aria-pressed',next==='none'?'false':'true');var label=button.querySelector('[data-region-state]');if(label)label.textContent=next==='primary'?'Primary':next==='secondary'?'Secondary':'None';});});
form.addEventListener('submit',async function(event){event.preventDefault();if(!save)return;save.disabled=true;setStatus('','Saving securely…');var csrf='';try{var csrfResponse=await postJson('/calendar/staff-auth/csrf',{},null);if(csrfResponse.status===401){window.location.assign('/calendar/staff?reason=session');return;}if(!csrfResponse.ok)throw new Error('csrf');var csrfBody=await safeJson(csrfResponse);csrf=String(csrfBody.csrfToken||'');if(!csrf)throw new Error('csrf');var response=await postJson(form.dataset.action,payload(),csrf);csrf='';var body=await safeJson(response);if(response.status===401){window.location.assign('/calendar/staff?reason=session');return;}if(response.status===409){setStatus('error',body.error||'This assessment changed. Reload the page and try again.');return;}if(!response.ok){setStatus('error',body.error||'Could not save the assessment. Please check the form and try again.');return;}form.dataset.revision=String(body.revision||form.dataset.revision||0);setStatus('saved','Saved securely.');}catch(_error){setStatus('error','Could not save the assessment. Check your connection and try again.');}finally{csrf='';save.disabled=false;}});
})();`;
}

module.exports = {
  SPORTS_TEMPLATE_KEY,
  formatDateTime,
  sportsAssessmentHref,
  decorateSportsSubmissionHtml,
  assessmentStyles,
  renderPractitionerRecordPage,
  workspaceSportsAssessmentClientScript,
};
