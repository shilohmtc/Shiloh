const { confirmationClientScript } = require('./workspaceConfirmation');
const {
  escapeHtml,
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');

function styles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#5f7168;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--warn:#8a623d;--warn-soft:#f5eee5;--danger:#8f433d;--danger-soft:#f7e9e7;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1240px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:16px}.brand h1{margin:0;font-size:1.55rem}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem}.topbar-side{display:grid;justify-items:end;gap:7px}.truth-note,.access-status,.muted{font-size:.75rem;color:var(--muted)}.signout-button,.button,.pager-link{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border:1px solid var(--line-strong);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.8rem;font-weight:750;text-decoration:none;cursor:pointer}.filter-panel,.panel{background:var(--panel);border:1px solid var(--line);border-radius:17px;box-shadow:var(--shadow)}.filter-panel{padding:13px;margin-bottom:12px}.filter-form{display:grid;grid-template-columns:minmax(220px,1fr) 160px auto;gap:9px;align-items:end}.field{display:grid;gap:5px}.field label,.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted)}.field input,.field select{width:100%;min-height:42px;border:1px solid var(--line-strong);border-radius:10px;padding:9px 11px;background:#fff;color:var(--ink);font:inherit}.button.primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.button.danger{border-color:#d9b4b0;color:var(--danger);background:var(--danger-soft)}.result-summary{display:flex;justify-content:space-between;gap:14px;align-items:center;margin:0 2px 9px;color:var(--muted);font-size:.78rem}.staff-list{display:grid;gap:6px}.staff-row{display:grid;grid-template-columns:minmax(180px,1.3fr) 120px minmax(150px,.8fr) 120px 90px 26px;gap:12px;align-items:center;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none}.staff-row:hover{border-color:var(--leaf);box-shadow:0 4px 16px rgba(32,50,43,.06)}.staff-name{font-weight:800}.small{font-size:.76rem;color:var(--muted)}.pill{display:inline-flex;width:max-content;border-radius:999px;padding:5px 8px;background:var(--leaf-soft);color:var(--leaf);font-size:.69rem;font-weight:800;text-transform:capitalize}.pill.inactive,.pill.review{background:var(--warn-soft);color:var(--warn)}.row-arrow{font-size:1.2rem;color:var(--muted)}.empty{padding:44px 18px;text-align:center;border:1px dashed var(--line-strong);border-radius:14px;background:var(--panel);color:var(--muted)}.pager,.detail-actions{display:flex;justify-content:space-between;gap:10px;margin-top:12px}.detail-actions{justify-content:flex-start;margin:0 0 12px}.panel{padding:17px;margin-bottom:12px}.panel h2{margin:3px 0 12px;font-size:1.15rem}.profile-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.profile-field{padding:11px;border:1px solid var(--line);border-radius:11px;background:#fff}.profile-field span{display:block;color:var(--muted);font-size:.7rem;margin-bottom:4px}.profile-field strong{font-size:.86rem}.service-list,.capability-list{display:flex;flex-wrap:wrap;gap:7px}.service-chip,.capability-chip{border:1px solid var(--line);border-radius:999px;padding:7px 9px;background:#fff;font-size:.76rem}.access-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:13px}.read-only-note,.warning-note{padding:11px;border-radius:11px;background:var(--leaf-soft);font-size:.77rem;line-height:1.45}.warning-note{background:var(--warn-soft);color:var(--warn)}.footer-note{margin:14px 0 0;color:var(--muted);font-size:.73rem;line-height:1.5}.manage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.edit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.edit-grid .wide{grid-column:span 2}.check-field{display:flex;gap:9px;align-items:center;min-height:42px;padding:9px 11px;border:1px solid var(--line-strong);border-radius:10px;background:#fff}.check-field input{width:auto;min-height:0}details>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:750}details>summary::after{content:'+';margin-left:auto}details[open]>summary::after{content:'−'}details>summary:focus-visible{outline:3px solid #9ebaaa;outline-offset:2px}.manage-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:12px}.status-message{min-height:20px;margin:0 0 12px;padding:8px 10px;border-radius:9px;background:var(--leaf-soft);font-size:.78rem}.status-message:empty{display:none}.status-message[data-tone="error"]{background:var(--danger-soft);color:var(--danger)}.status-message[data-tone="working"]{background:var(--warn-soft);color:var(--warn)}.create-panel{margin-bottom:12px}.create-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:9px;align-items:end}.manage-badge{font-size:.72rem;color:var(--leaf);font-weight:800}.read-only-badge{font-size:.72rem;color:var(--muted);font-weight:750}@media(max-width:1000px){.staff-row{grid-template-columns:minmax(160px,1fr) 110px minmax(140px,.8fr) 80px 26px}.staff-row .bookable{display:none}.profile-grid,.manage-grid{grid-template-columns:repeat(2,1fr)}.create-grid{grid-template-columns:repeat(2,1fr)}.create-grid .wide{grid-column:span 2}}@media(max-width:700px){.shell{padding:12px 10px 28px}.topbar{align-items:start;flex-direction:column}.topbar-side{justify-items:start;width:100%}.signout-button{min-height:44px}.filter-form,.manage-grid,.edit-grid,.create-grid{grid-template-columns:1fr}.edit-grid .wide,.create-grid .wide{grid-column:span 1}.field input,.field select,.button{min-height:46px}.button{width:100%}.result-summary{align-items:start;flex-direction:column}.staff-row{grid-template-columns:1fr auto;padding:13px}.staff-row .pill,.staff-row .small{grid-column:1}.staff-row .services-count,.staff-row .bookable{display:none}.row-arrow{grid-column:2;grid-row:1/5}.profile-grid,.access-grid{grid-template-columns:1fr}.pager-link{min-height:44px}.manage-actions{display:grid;grid-template-columns:1fr;width:100%}}`;
}

function label(value) {
  const text = String(value || 'Not configured').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function capabilityLabel(value) {
  const labels = {
    'appointment:view': 'View appointments',
    'appointment:create': 'Create appointments',
    'appointment:record_past': 'Record past appointments',
    'booking:update': 'Update bookings',
    'client:lookup': 'View clients',
    'client:notify': 'Send client notifications',
    'services:view': 'View services',
    'services:create': 'Add services',
    'services:manage': 'Manage services',
    'staff:view': 'View staff',
    'staff:manage': 'Manage staff',
    'staff_access:manage': 'Manage staff access',
    'schedule:manage': 'Manage schedules',
  };
  if (labels[value]) return labels[value];
  const words = String(value || '').replace(/[:_]+/g, ' ').trim();
  return words ? label(words) : 'Additional access';
}

function shellStart({ title, subtitle, displayName, calendarNavigationAllowed, clientsNavigationAllowed, staffAccessScriptPath, manageAllowed = false }) {
  const manageScript = manageAllowed ? '<script src="/calendar/team/manage.js" defer></script>' : '';
  const truth = manageAllowed ? '' : 'View only';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script>${manageScript}</head><body data-workspace-staff="true"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'staff', displayName, calendarHref: calendarNavigationAllowed ? '/calendar/read-only' : null, clientsHref: clientsNavigationAllowed ? '/calendar/clients' : null, staffHref: '/calendar/team' })}<div class="workspace-main"><div class="shell"><header class="topbar"><div class="brand"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="topbar-side"><span class="truth-note">${truth}</span></div></header>`;
}

function listHref({ query = '', status = 'active', offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (offset > 0) params.set('offset', String(offset));
  const suffix = params.toString();
  return `/calendar/team${suffix ? `?${suffix}` : ''}`;
}
function roleFor(row) {
  if (Number(row.active_admin_count) > 1) return 'Access needs review';
  return row.business_role ? label(row.business_role) : label(row.resource_type);
}

function createPanel() {
  return `<section class="panel create-panel" id="add-staff" data-staff-management><span class="eyebrow">Staff profile</span><h2>Add staff profile</h2><p class="status-message" role="status" aria-live="polite" data-staff-operation-status></p><form data-staff-create-form><div class="create-grid"><div class="field wide"><label for="new-staff-name">Display name</label><input id="new-staff-name" name="displayName" required maxlength="120" autocomplete="off"></div><div class="field"><label for="new-resource-type">Resource type</label><select id="new-resource-type" name="resourceType"><option value="practitioner">Practitioner</option><option value="business_resource">Business resource</option></select></div><div class="field"><label for="new-scheduling-type">Scheduling</label><select id="new-scheduling-type" name="schedulingType"><option value="regular">Regular</option><option value="freelance">Freelance</option><option value="system">System resource</option></select></div><div class="field"><label>Client booking</label><label class="check-field"><input name="clientBookable" type="checkbox"> Client-bookable</label></div><button class="button primary" type="submit">Add staff</button></div></form><p class="footer-note">Adds the staff profile only. It does not create Workspace access, sign-in setup or service assignments.</p></section>`;
}

function renderStaffListPage(model, options = {}) {
  const selectedStatus = model.status || 'all';
  const manageAllowed = model.manageAllowed === true;
  const rows = (model.staff || []).map(item => `<a class="staff-row" href="/calendar/team/${escapeHtml(item.id)}"><span class="staff-name">${escapeHtml(item.display_name)}</span><span class="pill ${item.status === 'inactive' ? 'inactive' : ''}">${escapeHtml(label(item.status))}</span><span class="small">${escapeHtml(roleFor(item))}</span><span class="small services-count">${Number(item.service_count) || 0} services</span><span class="small bookable">${item.client_bookable === true ? 'Client bookable' : 'Internal'}</span><span class="row-arrow" aria-hidden="true">›</span></a>`).join('');
  const statusOptions = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']]
    .map(([value, text]) => `<option value="${value}"${selectedStatus === value || (!model.status && value === 'all') ? ' selected' : ''}>${text}</option>`).join('');
  const prev = model.offset > 0 ? `<a class="pager-link" href="${escapeHtml(listHref({ query: model.query, status: selectedStatus, offset: Math.max(0, model.offset - model.pageSize) }))}">Previous</a>` : '<span></span>';
  const next = model.hasMore ? `<a class="pager-link" href="${escapeHtml(listHref({ query: model.query, status: selectedStatus, offset: model.offset + model.pageSize }))}">Next</a>` : '<span></span>';
  const accessLink = model.accessManageAllowed === true ? '<nav class="detail-actions"><a class="button primary" href="/calendar/team/workspace-access">Manage Workspace access</a></nav>' : '';
  const addAction = manageAllowed ? `<details class="panel" id="add-staff-panel"><summary data-staff-primary-action>Add staff</summary>${createPanel()}</details>` : '';
  return `${shellStart({ title: 'Staff', subtitle: 'People, availability and access.', displayName: model.authority?.displayName, manageAllowed, ...options })}<main data-staff-list-view>${accessLink}${addAction}<section class="filter-panel"><form class="filter-form" method="get" action="/calendar/team"><div class="field"><label for="staff-search">Search staff</label><input id="staff-search" name="q" type="search" value="${escapeHtml(model.query || '')}" placeholder="Name" maxlength="120"></div><div class="field"><label for="staff-status">Status</label><select id="staff-status" name="status">${statusOptions}</select></div><button class="button primary" type="submit">Search</button></form></section><div class="result-summary"><span>${model.staff.length} staff member${model.staff.length === 1 ? '' : 's'} on this page</span></div><section class="staff-list" aria-label="Staff">${rows || '<div class="empty">No staff found.</div>'}</section><nav class="pager" aria-label="Staff result pages">${prev}${next}</nav></main><p class="footer-note">${manageAllowed ? 'Access and service assignments are managed separately.' : 'View only'}</p></div></div></div></body></html>`;
}

function editPanel(staff) {
  const scheduling = staff.resource_type === 'business_resource'
    ? '<option value="system" selected>System resource</option>'
    : `<option value="regular"${staff.scheduling_type === 'regular' ? ' selected' : ''}>Regular</option><option value="freelance"${staff.scheduling_type === 'freelance' ? ' selected' : ''}>Freelance</option>`;
  const bookingControl = staff.resource_type === 'business_resource'
    ? '<div class="field"><label>Client booking</label><div class="check-field muted">Business resources cannot be client-bookable</div></div>'
    : `<div class="field"><label>Client booking</label><label class="check-field"><input name="clientBookable" type="checkbox"${staff.client_bookable === true ? ' checked' : ''}> Client-bookable</label></div>`;
  return `<section class="panel" data-staff-management><span class="eyebrow">Profile</span><h2>Edit staff profile</h2><p class="status-message" role="status" aria-live="polite" data-staff-operation-status></p><form data-staff-edit-form data-staff-id="${escapeHtml(staff.id)}" data-staff-revision="${escapeHtml(staff.revision)}"><div class="edit-grid"><div class="field wide"><label for="staff-display-name">Display name</label><input id="staff-display-name" name="displayName" required maxlength="120" value="${escapeHtml(staff.display_name)}"></div><div class="field"><label for="staff-scheduling-type">Scheduling</label><select id="staff-scheduling-type" name="schedulingType">${scheduling}</select></div>${bookingControl}</div><div class="manage-actions"><button class="button primary" type="submit">Save profile</button><span class="manage-badge">Resource type cannot be changed after creation</span></div></form></section>`;
}

function statusPanel(staff) {
  const next = staff.status === 'active' ? 'inactive' : 'active';
  const action = next === 'inactive' ? 'Deactivate staff' : 'Reactivate staff';
  return `<section class="panel" data-staff-management><span class="eyebrow">Status</span><h2>${escapeHtml(label(staff.status))}</h2><p class="status-message" role="status" aria-live="polite" data-staff-operation-status></p><form data-staff-status-form data-staff-name="${escapeHtml(staff.display_name)}" data-staff-id="${escapeHtml(staff.id)}" data-staff-revision="${escapeHtml(staff.revision)}"><input type="hidden" name="status" value="${next}"><button class="button ${next === 'inactive' ? 'danger' : 'primary'}" type="submit">${action}</button></form><div class="warning-note">${next === 'inactive' ? 'Deactivation stops new booking eligibility and disables linked Workspace access. Existing appointments, service assignments and history are preserved.' : 'Reactivation restores the profile to active. Booking still depends on client-bookable status and an active assigned service.'}</div></section>`;
}

function renderStaffDetailPage(model, options = {}) {
  const staff = model.staff;
  const manageAllowed = model.manageAllowed === true;
  const services = (model.services || []).map(service => `<span class="service-chip">${escapeHtml(service.name)}${service.status === 'inactive' ? ' • inactive' : ''}</span>`).join('');
  const access = model.access;
  const capabilities = access?.capabilities?.length ? access.capabilities.map(cap => `<span class="capability-chip" data-access-key="${escapeHtml(cap)}">${escapeHtml(capabilityLabel(cap))}</span>`).join('') : '<span class="muted">No enabled Workspace access is linked.</span>';
  const accessBody = access ? `<div class="access-grid"><div class="profile-field"><span>Business role</span><strong>${escapeHtml(label(access.businessRole))}</strong></div><div class="profile-field"><span>Calendar access</span><strong>${escapeHtml(label(access.calendarScope))}</strong></div><div class="profile-field"><span>Service access</span><strong>${escapeHtml(label(access.serviceScope))}</strong></div></div><span class="eyebrow">Enabled access</span><details><summary>View enabled access</summary><div class="capability-list">${capabilities}</div></details>` : '<p class="muted">No active Workspace access is linked to this staff member.</p>';
  const accessV2Link = model.accessManageAllowed === true ? `<a class="button primary" href="${access?.id ? `/calendar/team/staff-access/${escapeHtml(access.id)}` : '/calendar/team/workspace-access'}">Manage Workspace access</a>` : '';
  return `${shellStart({ title: 'Staff detail', subtitle: 'Staff profile and current access.', displayName: model.authority?.displayName, manageAllowed, ...options })}<main data-staff-detail-view data-staff-manage-allowed="${manageAllowed ? 'true' : 'false'}"><nav class="detail-actions"><a class="button" href="/calendar/team">← Back to Staff</a>${accessV2Link}</nav><section class="panel"><span class="eyebrow">Staff profile</span><h2>${escapeHtml(staff.display_name)}</h2><div class="profile-grid"><div class="profile-field"><span>Status</span><strong>${escapeHtml(label(staff.status))}</strong></div><div class="profile-field"><span>Resource type</span><strong>${escapeHtml(label(staff.resource_type))}</strong></div><div class="profile-field"><span>Scheduling</span><strong>${escapeHtml(label(staff.scheduling_type))}</strong></div><div class="profile-field"><span>Client bookable</span><strong>${staff.client_bookable === true ? 'Yes' : 'No'}</strong></div></div></section>${manageAllowed ? `<div class="manage-grid">${editPanel(staff)}${statusPanel(staff)}</div>` : '<section class="panel"><h2>View only</h2><p class="muted">You can view this staff profile, but editing is not available.</p></section>'}<section class="panel"><span class="eyebrow">Services</span><h2>Assigned services</h2><div class="service-list">${services || '<span class="muted">No service assignments.</span>'}</div><p class="read-only-badge">Service assignments are view only here. Manage them from Workspace → Services.</p></section><section class="panel"><span class="eyebrow">Access</span><h2>Current access</h2>${accessBody}<div class="read-only-note">Access settings are view only here. Staff profile changes do not create or edit sign-in credentials.</div></section></main><p class="footer-note">Private contact and sign-in details are not shown here.</p></div></div></div></body></html>`;
}

function workspaceStaffManageClientScript() {
  return confirmationClientScript() + `(function(){'use strict';
var API='/calendar/team';var AUTH='/calendar/staff-auth';
function one(s,r){return(r||document).querySelector(s);}function requestId(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();return'T'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);}
function status(message,tone,root){var target=one('[data-staff-operation-status]',root)||one('[data-staff-operation-status]');if(!target)return;target.textContent=String(message||'');target.dataset.tone=tone||'ready';}
async function json(response){try{return await response.json();}catch(_error){return{};}}
async function csrf(){var response=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});if(!response.ok)throw new Error('Your secure Shiloh session has expired.');var body=await json(response);if(!body.csrfToken)throw new Error('A secure operation token could not be issued.');return body.csrfToken;}
async function post(path,payload){var token=await csrf();var response=await fetch(API+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify(payload||{})});token='';var body=await json(response);if(!response.ok)throw new Error(body.error||'Staff change could not be completed.');return body;}
function busy(form,on){Array.prototype.forEach.call(form.querySelectorAll('button,input,select'),function(el){el.disabled=on;});}
var create=one('[data-staff-create-form]');if(create){create.addEventListener('submit',async function(e){e.preventDefault();var f=new FormData(create);busy(create,true);status('Adding staff profile…','working',create.closest('[data-staff-management]'));try{var type=String(f.get('resourceType')||'practitioner');var result=await post('/create',{requestId:requestId(),displayName:f.get('displayName'),resourceType:type,schedulingType:type==='business_resource'?'system':f.get('schedulingType'),clientBookable:type==='business_resource'?false:f.get('clientBookable')==='on'});window.location.assign(API+'/'+result.staffId);}catch(err){status(err.message,'error',create.closest('[data-staff-management]'));busy(create,false);}});}
var edit=one('[data-staff-edit-form]');if(edit){edit.addEventListener('submit',async function(e){e.preventDefault();var f=new FormData(edit);busy(edit,true);status('Saving staff profile…','working',edit.closest('[data-staff-management]'));try{await post('/'+edit.dataset.staffId+'/update',{requestId:requestId(),expectedRevision:edit.dataset.staffRevision,displayName:f.get('displayName'),schedulingType:f.get('schedulingType'),clientBookable:f.get('clientBookable')==='on'});window.location.reload();}catch(err){status(err.message,'error',edit.closest('[data-staff-management]'));busy(edit,false);}});}
var lifecycle=one('[data-staff-status-form]');if(lifecycle){lifecycle.addEventListener('submit',async function(e){e.preventDefault();var next=String(new FormData(lifecycle).get('status')||'');if(next==='inactive'&&!(await window.ShilohConfirm({title:'Deactivate '+lifecycle.dataset.staffName+'?',copy:'Existing appointments and history stay intact. New bookings and linked Workspace access will stop.',cancel:'Keep active',action:'Deactivate staff'})))return;busy(lifecycle,true);try{await post('/'+lifecycle.dataset.staffId+'/status',{requestId:requestId(),expectedRevision:lifecycle.dataset.staffRevision,status:next});window.location.reload();}catch(err){status(err.message,'error',lifecycle.parentElement);busy(lifecycle,false);}});}
})();`;
}

function renderStaffUnavailablePage({ code = 'WORKSPACE_STAFF_UNAVAILABLE', message = 'Staff is unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff unavailable — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style></head><body><div class="shell"><section class="empty"><h1>Staff unavailable</h1><p>${escapeHtml(message)}</p><small>Reference: ${escapeHtml(code)}</small></section></div></body></html>`;
}

module.exports = {
  label,
  capabilityLabel,
  roleFor,
  renderStaffListPage,
  renderStaffDetailPage,
  workspaceStaffManageClientScript,
  renderStaffUnavailablePage,
};
