const { escapeHtml } = require('./workspaceShell');

const MANAGE_STYLE = `.client-manage-panel{background:#fffdf9;border:1px solid #dce3dd;border-radius:17px;padding:17px;margin-bottom:12px;box-shadow:0 8px 28px rgba(32,50,43,.07)}.client-manage-panel h2{margin:3px 0 12px;font-size:1.15rem}.client-manage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.client-manage-grid .wide{grid-column:span 2}.client-manage-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:12px}.client-manage-status{min-height:20px;margin:0 0 12px;padding:8px 10px;border-radius:9px;background:#e7eee9;font-size:.78rem}.client-manage-status:empty{display:none}.client-manage-status[data-tone="error"]{background:#f5ebe6;color:#8a4138}.client-manage-status[data-tone="working"]{background:#f5eee5;color:#8a623d}.button.danger{border-color:#d9b4b0;color:#8a4138;background:#f5ebe6}.manage-note{font-size:.75rem;color:#56685f;line-height:1.5;margin:8px 0 0}@media(max-width:700px){.client-manage-grid{grid-template-columns:1fr}.client-manage-grid .wide{grid-column:span 1}.client-manage-actions{display:grid;grid-template-columns:1fr}.client-manage-actions .button{width:100%}}`;

function isTenantClientBase(model) {
  return model?.authority?.clientScope?.kind === 'tenant_staff';
}

function decorate(html) {
  return String(html || '')
    .replace('</style>', `${MANAGE_STYLE}</style>`)
    .replace('</head>', '<script src="/calendar/clients/manage.js" defer></script></head>')
    .replace('<span class="truth-note">View only</span>', '<span class="truth-note">Client management</span>');
}

function injectClientListManagement(html, model) {
  if (model?.manageAllowed !== true) return html;
  const tenant = isTenantClientBase(model);
  const note = tenant
    ? 'Adds this person to your client list. If Shiloh already knows this mobile number, the same client profile is used without exposing another client list.'
    : 'Adds this person to the clinic client list. If Shiloh already knows this mobile number, the existing client profile is used.';
  const panel = `<section class="client-manage-panel" data-client-create-panel data-tenant-client-base="${tenant ? 'true' : 'false'}"><span class="eyebrow">New client</span><h2>Add client</h2><p class="client-manage-status" role="status" aria-live="polite" data-client-operation-status></p><form data-client-create-form><div class="client-manage-grid"><div class="field"><label for="new-client-name">Name</label><input id="new-client-name" name="name" required maxlength="120" autocomplete="name"></div><div class="field"><label for="new-client-mobile">Mobile</label><input id="new-client-mobile" name="mobile" required inputmode="tel" autocomplete="tel" placeholder="082 123 4567"></div></div><div class="client-manage-actions"><button class="button primary" type="submit">Add client</button></div></form><p class="manage-note">${escapeHtml(note)}</p></section>`;
  return decorate(html)
    .replace('<main data-clients-list-view>', `<main data-clients-list-view data-tenant-client-base="${tenant ? 'true' : 'false'}">${panel}`)
    .replace('This page is view only. Client editing and messaging are not available here.', tenant
      ? 'This list contains only your clients. Client profile changes are available here; messaging remains separately controlled.'
      : 'Client profile changes are available to authorized staff. Messaging remains separately controlled.');
}

function genderOptions(current) {
  const options = [
    ['', 'Not recorded'],
    ['female', 'Female'],
    ['male', 'Male'],
    ['non_binary', 'Non-binary'],
    ['prefer_not_to_say', 'Prefer not to say'],
    ['other', 'Other'],
  ];
  return options.map(([value, label]) => `<option value="${value}"${String(current || '') === value ? ' selected' : ''}>${label}</option>`).join('');
}

function injectClientDetailManagement(html, model) {
  if (model?.manageAllowed !== true || !model?.client) return html;
  const client = model.client;
  const active = String(client.status || '') === 'active';
  const tenant = isTenantClientBase(model);
  const removeLabel = tenant ? 'Remove from my clients' : 'Archive client';
  const note = tenant
    ? 'Profile changes update this person’s Shiloh profile. Removing them from your clients does not delete the person, their appointment history, or any other clinic relationship.'
    : 'Profile changes update this person’s Shiloh profile. Archiving removes them from the active clinic client list without deleting appointment history.';
  const panel = `<section class="client-manage-panel" data-client-management data-client-id="${escapeHtml(client.id)}" data-client-revision="${escapeHtml(client.revision || '')}" data-tenant-client-base="${tenant ? 'true' : 'false'}"><span class="eyebrow">Client management</span><h2>Edit profile</h2><p class="client-manage-status" role="status" aria-live="polite" data-client-operation-status></p><form data-client-edit-form><div class="client-manage-grid"><div class="field wide"><label for="edit-client-name">Name</label><input id="edit-client-name" name="name" required maxlength="120" value="${escapeHtml(client.name || '')}"></div><div class="field"><label for="edit-client-mobile">Mobile</label><input id="edit-client-mobile" name="mobile" required inputmode="tel" value="${escapeHtml(client.normalized_mobile ? `+${client.normalized_mobile}` : '')}"></div><div class="field"><label for="edit-client-dob">Date of birth</label><input id="edit-client-dob" name="dateOfBirth" type="date" value="${escapeHtml(client.date_of_birth || '')}"></div><div class="field"><label for="edit-client-gender">Gender</label><select id="edit-client-gender" name="gender">${genderOptions(client.gender)}</select></div></div><div class="client-manage-actions"><button class="button primary" type="submit">Save client</button>${active ? `<button class="button danger" type="button" data-client-archive>${escapeHtml(removeLabel)}</button>` : ''}</div></form><p class="manage-note">${escapeHtml(note)}</p></section>`;
  return decorate(html).replace('<section class="history-panel">', `${panel}<section class="history-panel">`);
}

function workspaceClientsManageClientScript() {
  return `(function(){'use strict';
var API='/calendar/clients',AUTH='/calendar/staff-auth';
function one(s,r){return(r||document).querySelector(s);}function rid(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();return'C'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);}
function status(message,tone){var el=one('[data-client-operation-status]');if(!el)return;el.textContent=String(message||'');el.dataset.tone=tone||'ready';}
async function csrf(){var r=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});if(!r.ok)throw new Error('Your secure staff session needs to be refreshed.');var j=await r.json();if(!j.csrfToken)throw new Error('A secure action token could not be issued.');return j.csrfToken;}
async function post(path,payload){var token=await csrf();var r=await fetch(API+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json','X-Shiloh-Csrf-Token':token},body:JSON.stringify(payload)});var j={};try{j=await r.json();}catch(_e){}if(!r.ok){var e=new Error(j.error||'The client change could not be completed.');e.code=j.code;e.status=r.status;throw e;}return j;}
var create=one('[data-client-create-form]');if(create)create.addEventListener('submit',async function(ev){ev.preventDefault();status('Adding client…','working');var f=new FormData(create);try{var result=await post('/create',{requestId:rid(),name:f.get('name'),mobile:f.get('mobile')});window.location.assign(API+'/'+encodeURIComponent(result.clientId));}catch(e){status(e.message,'error');}});
var manage=one('[data-client-management]'),edit=one('[data-client-edit-form]');if(manage&&edit){var id=manage.dataset.clientId,revision=manage.dataset.clientRevision,tenant=manage.dataset.tenantClientBase==='true';edit.addEventListener('submit',async function(ev){ev.preventDefault();status('Saving client…','working');var f=new FormData(edit);try{await post('/'+encodeURIComponent(id)+'/update',{requestId:rid(),expectedRevision:revision,name:f.get('name'),mobile:f.get('mobile'),dateOfBirth:f.get('dateOfBirth')||null,gender:f.get('gender')||null});window.location.reload();}catch(e){status(e.message,'error');}});var archive=one('[data-client-archive]');if(archive)archive.addEventListener('click',async function(){var question=tenant?'Remove this person from your client list? Their Shiloh profile and other clinic relationships will not be deleted.':'Archive this client from the clinic client list? Appointment history will remain available.';if(!window.confirm(question))return;status(tenant?'Removing client…':'Archiving client…','working');try{await post('/'+encodeURIComponent(id)+'/archive',{requestId:rid(),expectedRevision:revision});window.location.assign(API+'?status=archived');}catch(e){status(e.message,'error');}});}
})();`;
}

module.exports = { injectClientListManagement, injectClientDetailManagement, workspaceClientsManageClientScript };
