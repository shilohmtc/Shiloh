const { escapeHtml, workspaceShellStyles, renderWorkspaceNavigation } = require('./workspaceShell');

function styles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#56685f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--warn:#8a623d;--warn-soft:#f5eee5;--danger:#8f433d;--danger-soft:#f7e9e7;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1240px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:16px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem}.topbar-side{display:grid;justify-items:end;gap:7px}.truth-note,.access-status,.muted{font-size:.75rem;color:var(--muted)}.signout-button,.button,.pager-link{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.8rem;font-weight:750;text-decoration:none;cursor:pointer}.filter-panel,.panel{background:var(--panel);border:1px solid var(--line);border-radius:17px;box-shadow:var(--shadow)}.filter-panel{padding:13px;margin-bottom:12px}.filter-form{display:grid;grid-template-columns:minmax(220px,1fr) 160px auto;gap:9px;align-items:end}.field{display:grid;gap:5px}.field label,.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted)}.field input,.field select{width:100%;min-height:42px;border:1px solid var(--line-strong);border-radius:10px;padding:9px 11px;background:#fff;color:var(--ink);font:inherit}.button.primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.button.danger{border-color:#d9b4b0;color:var(--danger);background:var(--danger-soft)}.result-summary{display:flex;justify-content:space-between;gap:14px;align-items:center;margin:0 2px 9px;color:var(--muted);font-size:.78rem}.service-list{display:grid;gap:6px}.service-row{display:grid;grid-template-columns:minmax(210px,1.35fr) minmax(145px,.8fr) 95px 120px 90px 100px 120px 26px;gap:12px;align-items:center;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none}.service-row:hover{border-color:var(--leaf);box-shadow:0 4px 16px rgba(32,50,43,.06)}.service-name{font-weight:800}.small{font-size:.76rem;color:var(--muted)}.pill{display:inline-flex;width:max-content;border-radius:999px;padding:5px 8px;background:var(--leaf-soft);color:var(--leaf);font-size:.69rem;font-weight:800;text-transform:capitalize}.pill.inactive,.pill.not-bookable{background:var(--warn-soft);color:var(--warn)}.row-arrow{font-size:1.2rem;color:var(--muted)}.empty{padding:44px 18px;text-align:center;border:1px dashed var(--line-strong);border-radius:14px;background:var(--panel);color:var(--muted)}.pager,.detail-actions{display:flex;justify-content:space-between;gap:10px;margin-top:12px}.detail-actions{justify-content:flex-start;margin:0 0 12px}.panel{padding:17px;margin-bottom:12px}.panel h2{margin:3px 0 12px;font-size:1.15rem}.profile-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.profile-field{padding:11px;border:1px solid var(--line);border-radius:11px;background:#fff}.profile-field span{display:block;color:var(--muted);font-size:.7rem;margin-bottom:4px}.profile-field strong{font-size:.86rem}.content-copy{margin:0 0 10px;white-space:pre-wrap;line-height:1.55;font-size:.87rem}.staff-list{display:grid;gap:7px}.staff-row{display:grid;grid-template-columns:minmax(180px,1fr) 120px 140px auto;gap:12px;padding:11px 12px;border:1px solid var(--line);border-radius:11px;background:#fff;align-items:center}.booking-note{padding:12px;border-radius:11px;background:var(--leaf-soft);font-size:.8rem;line-height:1.5}.booking-note.review{background:var(--warn-soft)}.footer-note{margin:14px 0 0;color:var(--muted);font-size:.73rem;line-height:1.5}.manage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.edit-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.edit-grid .wide{grid-column:span 3}.check-field{display:flex;gap:9px;align-items:center;min-height:42px;padding:9px 11px;border:1px solid var(--line-strong);border-radius:10px;background:#fff}.check-field input{width:auto;min-height:0}.manage-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:12px}.status-message{min-height:20px;margin:0 0 12px;padding:8px 10px;border-radius:9px;background:var(--leaf-soft);font-size:.78rem}.status-message:empty{display:none}.status-message[data-tone="error"]{background:var(--danger-soft);color:var(--danger)}.status-message[data-tone="working"]{background:var(--warn-soft);color:var(--warn)}.warning-copy{font-size:.78rem;line-height:1.5;color:var(--muted);margin:8px 0 0}.assignment-form{display:grid;grid-template-columns:minmax(200px,1fr) auto;gap:9px;align-items:end}.read-only-badge{font-size:.72rem;color:var(--muted);font-weight:750}.manage-badge{font-size:.72rem;color:var(--leaf);font-weight:800}@media(max-width:1000px){.service-row{grid-template-columns:minmax(180px,1.3fr) minmax(130px,.8fr) 90px 110px 95px 120px 26px}.service-row .assigned{display:none}.profile-grid,.manage-grid{grid-template-columns:repeat(2,1fr)}.edit-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.edit-grid .wide{grid-column:span 2}}@media(max-width:700px){.shell{padding:12px 10px 28px}.topbar{align-items:start;flex-direction:column}.topbar-side{justify-items:start;width:100%}.signout-button{min-height:44px}.filter-form,.manage-grid,.edit-grid,.assignment-form{grid-template-columns:1fr}.edit-grid .wide{grid-column:span 1}.field input,.field select,.button{min-height:46px}.button{width:100%}.result-summary{align-items:start;flex-direction:column}.service-row{grid-template-columns:1fr auto;padding:13px}.service-row .small,.service-row .pill{grid-column:1}.service-row .category,.service-row .assigned{display:none}.row-arrow{grid-column:2;grid-row:1/6}.profile-grid{grid-template-columns:1fr}.staff-row{grid-template-columns:1fr}.pager-link{min-height:44px}.manage-actions{display:grid;grid-template-columns:1fr;width:100%}}`;
}

function label(value) {
  const text = String(value || 'Not configured').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatPrice(service) {
  const display = String(service?.display_price || '').trim();
  if (display) return display;
  const raw = Number(service?.price);
  if (!Number.isFinite(raw)) return service?.variable_price === true ? 'Variable' : 'Not priced';
  const amount = new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(raw);
  return `${service?.variable_price === true ? 'From ' : ''}R ${amount}`;
}

function durationLabel(service) {
  const total = Number(service?.total_minutes || 0);
  const treatment = Number(service?.duration_minutes || 0);
  if (total > treatment && treatment > 0) return `${treatment} min treatment • ${total} min slot`;
  return total > 0 ? `${total} min` : 'Duration not set';
}

function shellStart({ title, subtitle, calendarNavigationAllowed, clientsNavigationAllowed, staffNavigationAllowed, staffAccessScriptPath, displayName = '', manageAllowed = false }) {
  const manageScript = manageAllowed ? '<script src="/calendar/services/manage.js" defer></script>' : '';
  const accessLabel = manageAllowed ? '' : '<span class="truth-note">View only</span>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script>${manageScript}</head><body data-workspace-services="true"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'services', displayName, calendarHref: calendarNavigationAllowed ? '/calendar/read-only' : null, clientsHref: clientsNavigationAllowed ? '/calendar/clients' : null, staffHref: staffNavigationAllowed ? '/calendar/team' : null, servicesHref: '/calendar/services' })}<div class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="topbar-side">${accessLabel}</div></header>`;
}

function listHref({ query = '', status = 'active', offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (offset > 0) params.set('offset', String(offset));
  const suffix = params.toString();
  return `/calendar/services${suffix ? `?${suffix}` : ''}`;
}

function renderServicesListPage(model, options = {}) {
  const selectedStatus = model.status || 'all';
  const rows = (model.services || [])
    .map((service) => {
      const eligible = service.booking_eligibility?.eligible === true;
      return `<a class="service-row" href="/calendar/services/${escapeHtml(service.id)}"><span class="service-name">${escapeHtml(service.name)}</span><span class="small category">${escapeHtml(service.category_name || 'Uncategorised')}</span><span class="small">${escapeHtml(durationLabel(service))}</span><span class="small">${escapeHtml(formatPrice(service))}</span><span class="pill ${service.status === 'inactive' ? 'inactive' : ''}">${escapeHtml(label(service.status))}</span><span class="small assigned">${Number(service.assigned_staff_count) || 0} assigned</span><span class="pill ${eligible ? '' : 'not-bookable'}">${eligible ? 'Available for booking' : 'Not available for booking'}</span><span class="row-arrow" aria-hidden="true">›</span></a>`;
    })
    .join('');
  const statusOptions = [
    ['active', 'Active'],
    ['inactive', 'Inactive'],
    ['all', 'All'],
  ]
    .map(([value, text]) => `<option value="${value}"${selectedStatus === value || (!model.status && value === 'all') ? ' selected' : ''}>${text}</option>`)
    .join('');
  const prev = model.offset > 0 ? `<a class="pager-link" href="${escapeHtml(listHref({ query: model.query, status: selectedStatus, offset: Math.max(0, model.offset - model.pageSize) }))}">Previous</a>` : '<span></span>';
  const next = model.hasMore ? `<a class="pager-link" href="${escapeHtml(listHref({ query: model.query, status: selectedStatus, offset: model.offset + model.pageSize }))}">Next</a>` : '<span></span>';
  return `${shellStart({ title: 'Services', subtitle: options.manageAllowed === true ? 'Manage services, pricing and practitioner assignments.' : 'Services, pricing and practitioners.', displayName: model.authority?.displayName, ...options })}<main data-services-list-view><section class="filter-panel"><form class="filter-form" method="get" action="/calendar/services"><div class="field"><label for="service-search">Search services</label><input id="service-search" name="q" type="search" value="${escapeHtml(model.query || '')}" placeholder="Service name" maxlength="120"></div><div class="field"><label for="service-status">Status</label><select id="service-status" name="status">${statusOptions}</select></div><button class="button primary" type="submit">Search</button></form></section><div class="result-summary"><span>${model.services.length} service${model.services.length === 1 ? '' : 's'} on this page</span></div><section class="service-list" aria-label="Services">${rows || '<div class="empty">No services found.</div>'}</section><nav class="pager" aria-label="Service result pages">${prev}${next}</nav></main></div></div></div></body></html>`;
}

function editPanel(service) {
  return `<section class="panel" data-service-management><span class="eyebrow">Service management</span><h2>Edit service</h2><p class="status-message" role="status" aria-live="polite" data-service-operation-status></p><form data-service-edit-form data-service-id="${escapeHtml(service.id)}" data-service-revision="${escapeHtml(service.revision)}"><div class="edit-grid"><div class="field wide"><label for="service-name">Service name</label><input id="service-name" name="name" required maxlength="180" value="${escapeHtml(service.name)}"></div><div class="field"><label for="duration-minutes">Treatment minutes</label><input id="duration-minutes" name="durationMinutes" type="number" min="0" step="1" required value="${escapeHtml(service.duration_minutes)}"></div><div class="field"><label for="processing-minutes">Processing minutes</label><input id="processing-minutes" name="processingTimeMinutes" type="number" min="0" step="1" required value="${escapeHtml(service.processing_time_minutes)}"></div><div class="field"><label for="extra-minutes">Extra minutes</label><input id="extra-minutes" name="extraTimeMinutes" type="number" min="0" step="1" required value="${escapeHtml(service.extra_time_minutes)}"></div><div class="field"><label for="service-price">Numeric price (R)</label><input id="service-price" name="price" type="number" min="0" max="9999999999.99" step="0.01" value="${escapeHtml(service.price == null ? '' : service.price)}"></div><div class="field"><label for="display-price">Display price</label><input id="display-price" name="displayPrice" maxlength="120" value="${escapeHtml(service.display_price || '')}" placeholder="Optional customer-facing price text"></div><div class="field"><label>Variable price</label><label class="check-field"><input name="variablePrice" type="checkbox"${service.variable_price === true ? ' checked' : ''}> Use variable/from pricing</label></div></div><div class="manage-actions"><button class="button primary" type="submit">Save service</button></div></form></section>`;
}

function statusPanel(service) {
  const target = service.status === 'active' ? 'inactive' : 'active';
  const labelText = target === 'inactive' ? 'Deactivate service' : 'Reactivate service';
  return `<section class="panel"><span class="eyebrow">Service status</span><h2>${escapeHtml(label(service.status))}</h2><form data-service-status-form data-service-id="${escapeHtml(service.id)}" data-service-revision="${escapeHtml(service.revision)}" data-target-status="${target}"><button class="button ${target === 'inactive' ? 'danger' : 'primary'}" type="submit">${labelText}</button></form><p class="warning-copy">${target === 'inactive' ? 'Deactivation stops this service from new-booking eligibility. Existing appointments and practitioner assignments are preserved.' : 'Reactivation restores service eligibility only when at least one assigned practitioner is active and client-bookable. Calendar still decides live slots.'}</p></section>`;
}

function practitionerPanels(model, manageAllowed) {
  const service = model.service;
  const assignedRows = (model.assignedStaff || [])
    .map((staff) => {
      const canRemove = manageAllowed && staff.resource_type === 'practitioner' && staff.id;
      return `<div class="staff-row"><strong>${escapeHtml(staff.display_name)}</strong><span class="pill ${staff.status === 'inactive' ? 'inactive' : ''}">${escapeHtml(label(staff.status))}</span><span class="small">${staff.client_bookable === true ? 'Client bookable' : 'Not client bookable'}</span>${canRemove ? `<form data-service-unassign-form data-service-id="${escapeHtml(service.id)}" data-staff-id="${escapeHtml(staff.id)}" data-service-revision="${escapeHtml(service.revision)}"><button class="button danger" type="submit">Remove</button></form>` : '<span class="read-only-badge">Relationship preserved</span>'}</div>`;
    })
    .join('');
  const assignable = (model.practitioners || []).filter((staff) => staff.assigned !== true && staff.status === 'active');
  const choices = assignable.map((staff) => `<option value="${escapeHtml(staff.id)}">${escapeHtml(staff.display_name)}${staff.client_bookable === true ? ' • client bookable' : ''}</option>`).join('');
  const assignForm = manageAllowed && choices ? `<form class="assignment-form" data-service-assign-form data-service-id="${escapeHtml(service.id)}" data-service-revision="${escapeHtml(service.revision)}"><div class="field"><label for="assign-practitioner">Assign active practitioner</label><select id="assign-practitioner" name="staffId" required><option value="">Choose practitioner</option>${choices}</select></div><button class="button primary" type="submit">Assign</button></form>` : manageAllowed ? '<p class="muted">No additional active practitioners are available to assign.</p>' : '';
  return `<section class="panel"><span class="eyebrow">Assigned staff</span><h2>Practitioner relationships</h2><div class="staff-list">${assignedRows || '<p class="muted">No practitioner assignments.</p>'}</div>${assignForm ? `<div style="margin-top:12px">${assignForm}</div>` : ''}<p class="warning-copy">Assignment changes affect future booking eligibility only. Historical appointment snapshots are not rewritten.</p></section>`;
}

function renderServiceDetailPage(model, options = {}) {
  const service = model.service;
  const eligibility = model.bookingEligibility || {};
  const content = String(service.customer_description || '').trim();
  const bookingNote = String(service.booking_note || '').trim();
  const manageAllowed = options.manageAllowed === true;
  return `${shellStart({ title: 'Service detail', subtitle: 'Service, pricing and practitioner assignments.', displayName: model.authority?.displayName, ...options })}<main data-service-detail-view data-service-manage-allowed="${manageAllowed ? 'true' : 'false'}"><nav class="detail-actions"><a class="button" href="/calendar/services">← Back to Services</a></nav><section class="panel"><span class="eyebrow">Offering</span><h2>${escapeHtml(service.name)}</h2><div class="profile-grid"><div class="profile-field"><span>Category</span><strong>${escapeHtml(service.category_name || 'Uncategorised')}</strong></div><div class="profile-field"><span>Status</span><strong>${escapeHtml(label(service.status))}</strong></div><div class="profile-field"><span>Duration</span><strong>${escapeHtml(durationLabel(service))}</strong></div><div class="profile-field"><span>Price</span><strong>${escapeHtml(formatPrice(service))}</strong></div></div></section>${manageAllowed ? `<div class="manage-grid">${editPanel(service)}${statusPanel(service)}</div>` : '<section class="panel"><h2>View only</h2><p class="muted">You can view this service, but editing is not available.</p></section>'}<section class="panel"><span class="eyebrow">Customer-facing content</span><h2>Service information</h2>${content ? `<p class="content-copy">${escapeHtml(content)}</p>` : '<p class="muted">No customer-facing description is configured.</p>'}${bookingNote ? `<p class="content-copy"><strong>Booking note:</strong> ${escapeHtml(bookingNote)}</p>` : ''}<p class="read-only-badge">Service descriptions and booking notes are view only.</p></section>${practitionerPanels(model, manageAllowed)}<section class="panel"><span class="eyebrow">Booking status</span><h2>Availability</h2><div class="booking-note ${eligibility.eligible ? '' : 'review'}">${eligibility.eligible ? `Available for booking: this service is active and ${Number(eligibility.clientBookableStaffCount) || 0} assigned staff member${Number(eligibility.clientBookableStaffCount) === 1 ? '' : 's'} are active and client-bookable.` : `Not available for booking: ${service.status !== 'active' ? 'the service is inactive' : 'there is no active client-bookable assigned staff member'}.`}</div></section></main></div></div></div></body></html>`;
}

function workspaceServicesManageClientScript() {
  return `(function(){'use strict';
var API='/calendar/services';var AUTH='/calendar/staff-auth';
function one(s,r){return(r||document).querySelector(s);}function all(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
function requestId(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();return'S'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);}
function status(message,tone){var target=one('[data-service-operation-status]');if(!target)return;target.textContent=String(message||'');target.dataset.tone=tone||'ready';}
async function json(response){try{return await response.json();}catch(_error){return{};}}
async function csrf(){var response=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});if(!response.ok)throw new Error('Your secure Shiloh session has expired.');var body=await json(response);if(!body.csrfToken)throw new Error('A secure operation token could not be issued.');return body.csrfToken;}
async function request(path,payload){var token=await csrf();var response=await fetch(API+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify(payload||{})});token='';var body=await json(response);if(!response.ok){var error=new Error(body.error||'The canonical Services operation failed closed.');error.code=body.code;throw error;}return body;}
async function finish(work,message){status('Checking and saving…','working');try{await work();status(message||'Saved. Refreshing Services…','ready');window.location.reload();}catch(error){status(error.message||'Nothing was changed. Reload Services and retry.','error');}}
var edit=one('[data-service-edit-form]');if(edit)edit.addEventListener('submit',function(event){event.preventDefault();var id=edit.dataset.serviceId;finish(function(){return request('/'+id+'/update',{expectedRevision:edit.dataset.serviceRevision,requestId:requestId(),name:edit.elements.name.value,durationMinutes:edit.elements.durationMinutes.value,processingTimeMinutes:edit.elements.processingTimeMinutes.value,extraTimeMinutes:edit.elements.extraTimeMinutes.value,price:edit.elements.price.value,displayPrice:edit.elements.displayPrice.value,variablePrice:edit.elements.variablePrice.checked});},'Service updated. Refreshing Services…');});
all('[data-service-status-form]').forEach(function(form){form.addEventListener('submit',function(event){event.preventDefault();var target=form.dataset.targetStatus;if(target==='inactive'&&!window.confirm('Deactivate this service for new bookings? Existing appointments and practitioner assignments will be preserved.'))return;finish(function(){return request('/'+form.dataset.serviceId+'/status',{expectedRevision:form.dataset.serviceRevision,requestId:requestId(),status:target});},'Service status updated. Refreshing Services…');});});
all('[data-service-assign-form]').forEach(function(form){form.addEventListener('submit',function(event){event.preventDefault();var staffId=Number(form.elements.staffId.value);if(!staffId)return;finish(function(){return request('/'+form.dataset.serviceId+'/practitioners/'+staffId+'/assign',{expectedRevision:form.dataset.serviceRevision,requestId:requestId()});},'Practitioner assigned. Refreshing Services…');});});
all('[data-service-unassign-form]').forEach(function(form){form.addEventListener('submit',function(event){event.preventDefault();if(!window.confirm('Remove this practitioner from future eligibility for this service? Existing appointments will not be changed.'))return;finish(function(){return request('/'+form.dataset.serviceId+'/practitioners/'+form.dataset.staffId+'/unassign',{expectedRevision:form.dataset.serviceRevision,requestId:requestId()});},'Practitioner removed. Refreshing Services…');});});
})();`;
}

function renderServicesUnavailablePage({ code = 'WORKSPACE_SERVICES_UNAVAILABLE', message = 'Services is unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Services unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style></head><body><div class="shell"><section class="empty"><h1>Services unavailable</h1><p>${escapeHtml(message)}</p><small>Reference: ${escapeHtml(code)}</small></section></div></body></html>`;
}

module.exports = {
  label,
  formatPrice,
  durationLabel,
  renderServicesListPage,
  renderServiceDetailPage,
  workspaceServicesManageClientScript,
  renderServicesUnavailablePage,
};