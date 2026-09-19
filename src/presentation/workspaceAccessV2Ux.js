const { escapeHtml, workspaceShellStyles, renderWorkspaceNavigation } = require('./workspaceShell');

const CAPABILITY_LABELS = Object.freeze({
  'appointment:view': 'View appointments and Dashboard',
  'appointment:create': 'Create bookings',
  'appointment:record_past': 'Record past appointments',
  'appointment:adjust_end': 'Adjust appointment end time',
  'booking:update': 'Complete or mark visits no-show',
  'calendar:booking:reschedule': 'Reschedule bookings',
  'calendar:booking:cancel': 'Cancel bookings',
  'calendar:booking:reassign': 'Reassign practitioners',
  'client:lookup': 'View clients and communication evidence',
  'client:manage': 'Add, edit and archive clients',
  'client:notify': 'Send ordinary client notifications',
  'client:delete': 'Permanently delete clients',
  'services:view': 'View services',
  'services:create': 'Add services',
  'services:manage': 'Manage the business-wide service catalogue and practitioner assignments',
  'service:pricing': 'Manage pricing',
  'staff:services:view': 'View staff service assignments',
  'schedule:manage': 'Manage clinic hours, closures and schedules',
  'staff:view': 'View Staff',
  'staff:manage': 'Manage Staff profiles',
  'staff_access:manage': 'Manage Workspace access',
  'staff_auth:reset': 'Reset staff authentication',
  'walkin:create': 'Register walk-in clients',
  'loyalty:redeem': 'Redeem loyalty rewards',
  'loyalty:view': 'View Shiloh Rewards',
  'loyalty:manage': 'Adjust Shiloh Rewards',
  'overflow:visible': 'View overflow availability',
});

function human(value) {
  const words = String(value || 'Not configured').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function capabilityLabel(key) {
  return CAPABILITY_LABELS[key] || human(String(key || '').replace(/:/g, ' '));
}

function styles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--strong:#c9d4cc;--leaf:#3f6653;--deep:#294c3c;--soft:#e7eee9;--warn:#8a623d;--warn-soft:#f5eee5;--danger:#8f433d;--danger-soft:#f7e9e7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1120px;margin:0 auto;padding:22px}.topbar,.actions,.row,.summary{display:flex;align-items:center;gap:10px}.topbar{justify-content:space-between;align-items:end;margin-bottom:16px}.topbar h1{margin:0;font-size:1.55rem}.topbar p,.muted,.note{color:var(--muted);font-size:.78rem;line-height:1.5}.panel,.principal{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:17px;margin-bottom:12px}.section-title{display:flex;justify-content:space-between;align-items:end;gap:12px}.section-title h2,.panel h2{margin:2px 0 10px;font-size:1.08rem}.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted)}.principal-list{display:grid;gap:7px}.principal{display:grid;grid-template-columns:minmax(160px,1fr) 110px 160px 130px 22px;gap:10px;align-items:center;margin:0;padding:12px;text-decoration:none}.principal strong{font-size:.88rem}.small{font-size:.74rem;color:var(--muted)}.pill{display:inline-flex;width:max-content;padding:5px 8px;border-radius:999px;background:var(--soft);color:var(--leaf);font-size:.68rem;font-weight:800}.pill.disabled,.pill.review{background:var(--warn-soft);color:var(--warn)}.button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border:1px solid var(--strong);border-radius:999px;padding:8px 13px;background:#fff;color:var(--ink);font:inherit;font-size:.79rem;font-weight:750;text-decoration:none;cursor:pointer}.button.primary{background:var(--deep);border-color:var(--deep);color:#fff}.button.danger{background:var(--danger-soft);border-color:#d9b4b0;color:var(--danger)}.button:disabled{opacity:.55;cursor:not-allowed}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}.summary div{padding:11px;border:1px solid var(--line);border-radius:11px;background:#fff}.summary span{display:block;color:var(--muted);font-size:.68rem;margin-bottom:4px}.summary strong{font-size:.84rem}.capability-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.capability-group{border:1px solid var(--line);border-radius:12px;background:#fff;padding:11px}.capability-group h3{font-size:.8rem;margin:0 0 7px}.capability-group ul{margin:0;padding-left:18px;color:var(--muted);font-size:.75rem;line-height:1.55}details{margin-top:11px}details summary{cursor:pointer;font-weight:750;font-size:.78rem}.field{display:grid;gap:5px;margin:9px 0}.field label{font-size:.7rem;font-weight:800;color:var(--muted)}.field input,.field select{width:100%;min-height:43px;padding:9px 11px;border:1px solid var(--strong);border-radius:10px;background:#fff;font:inherit}.check{display:flex;gap:8px;align-items:start;font-size:.76rem;line-height:1.4}.status{min-height:20px;padding:9px;border-radius:10px;background:var(--soft);font-size:.76rem}.status:empty{display:none}.status[data-tone="error"]{background:var(--danger-soft);color:var(--danger)}.preview{margin-top:10px;border:1px solid var(--strong);border-radius:12px;padding:11px;background:#fff}.preview[hidden]{display:none}.preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.preview-grid div{padding:9px;border-radius:9px;background:var(--paper);font-size:.74rem;line-height:1.5}.setup-link{display:block;margin:8px 0;padding:9px;border-radius:9px;background:var(--paper);font-size:.72rem;line-height:1.45;word-break:break-all}.warning{padding:10px;border-radius:10px;background:var(--warn-soft);color:var(--warn);font-size:.75rem;line-height:1.45}@media(max-width:700px){.shell{padding:12px 10px 28px}.topbar,.section-title{align-items:start;flex-direction:column}.principal{grid-template-columns:1fr auto;padding:14px}.principal .small{grid-column:1}.principal .arrow{grid-column:2;grid-row:1/5}.summary,.capability-groups,.preview-grid{grid-template-columns:1fr}.actions{display:grid;grid-template-columns:1fr;width:100%}.button{min-height:46px;width:100%}}`;
}

function shell({ title, subtitle, displayName, body, script = false, calendarNavigationAllowed = false, clientsNavigationAllowed = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Shiloh Workspace</title><style>${workspaceShellStyles()}${styles()}</style>${script ? '<script src="/calendar/team/workspace-access/client.js" defer></script>' : ''}</head><body data-workspace-access-v2="true"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'staff', displayName, calendarHref: calendarNavigationAllowed ? '/calendar/read-only' : null, clientsHref: clientsNavigationAllowed ? '/calendar/clients' : null, staffHref: '/calendar/team' })}<div class="workspace-main"><div class="shell"><header class="topbar"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><a class="button" href="/calendar/team">← Staff</a></header>${body}</div></div></div></body></html>`;
}

function principalRow(item) {
  return `<a class="principal" href="/calendar/team/workspace-access/${escapeHtml(item.id)}"><strong>${escapeHtml(item.displayName)}</strong><span class="pill${item.active ? '' : ' disabled'}">${item.active ? 'Enabled' : 'Disabled'}</span><span class="small">${escapeHtml(item.principalLabel)}</span><span class="small">${escapeHtml(item.preset.label)}</span><span class="arrow" aria-hidden="true">›</span></a>`;
}

function renderAccessListPage(model = {}) {
  const staff = (model.staffLinked || []).map(principalRow).join('') || '<div class="panel muted">No staff-linked Workspace principals.</div>';
  const other = (model.sharedOrOther || []).map(principalRow).join('') || '<div class="panel muted">No shared or other Workspace principals.</div>';
  const create = model.receptionPresent ? '' : `<section class="panel"><span class="eyebrow">Shared access</span><h2>Add Shiloh Reception</h2><p class="note">Creates only the bounded Reception preset. No Staff profile or sign-in secret is created.</p><form data-reception-create-form><div class="field"><label for="reception-mobile">Canonical Reception mobile</label><input id="reception-mobile" name="whatsappNumber" type="tel" inputmode="tel" autocomplete="tel" required maxlength="24"></div><label class="check"><input name="identityConfirmed" type="checkbox" required> I verified this is the clinic-controlled Shiloh Reception mobile.</label><div class="actions"><button class="button primary" type="submit">Create Reception access</button></div></form><p class="status" role="status" aria-live="polite" data-access-status></p></section>`;
  return shell({ title: 'Workspace access', subtitle: 'People and shared principals with canonical Workspace authority.', displayName: model.authority?.displayName, calendarNavigationAllowed: model.calendarNavigationAllowed, clientsNavigationAllowed: model.clientsNavigationAllowed, script: true, body: `<main><section><div class="section-title"><div><span class="eyebrow">Staff</span><h2>Staff-linked access</h2></div></div><div class="principal-list">${staff}</div></section><section><div class="section-title"><div><span class="eyebrow">Shared / other</span><h2>Other Workspace access</h2></div></div><div class="principal-list">${other}</div></section>${create}<p class="note">Private mobiles, authenticator secrets, recovery material and sessions are never shown here.</p></main>` });
}

function summaryMarkup(principal) {
  return `<div class="summary"><div><span>Workspace access</span><strong>${principal.active ? 'Enabled' : 'Disabled'}</strong></div><div><span>Principal</span><strong>${escapeHtml(principal.principalLabel)}</strong></div><div><span>Preset</span><strong>${escapeHtml(principal.preset.label)}${principal.preset.status === 'needs_review' ? ' · needs review' : ''}</strong></div><div><span>Business role</span><strong>${escapeHtml(human(principal.businessRole))}</strong></div><div><span>Calendar scope</span><strong>${escapeHtml(human(principal.calendarScope))}</strong></div><div><span>Service scope</span><strong>${escapeHtml(human(principal.serviceScope))}</strong></div></div>`;
}

function capabilityMarkup(principal) {
  const groups = (principal.capabilityGroups || []).map(group => `<div class="capability-group"><h3>${escapeHtml(group.label)}</h3><ul>${group.capabilities.map(key => `<li>${escapeHtml(capabilityLabel(key))}</li>`).join('')}</ul></div>`).join('');
  const raw = principal.capabilities.map(key => `<li><code>${escapeHtml(key)}</code></li>`).join('');
  return `<section class="panel"><span class="eyebrow">Effective access</span><h2>Capabilities by clinic task</h2><div class="capability-groups">${groups || '<span class="muted">No enabled capabilities.</span>'}</div><details><summary>Advanced capability details</summary><ul>${raw || '<li>None</li>'}</ul></details></section>`;
}

function presetPanel(principal) {
  if (!(principal.staff?.status === 'active' && principal.staff?.resourceType === 'practitioner' && principal.staff?.businessRole === 'employee_practitioner') && !principal.receptionIdentity) {
    return '<section class="panel"><span class="eyebrow">Changes</span><h2>Protected principal</h2><p class="warning">This owner, business-control or custom principal is visible but read only in this bounded Access V2 unit.</p></section>';
  }
  const preset = principal.receptionIdentity ? 'shiloh_reception_v1' : 'employee_practitioner_v1';
  const label = principal.receptionIdentity ? 'Apply Reception preset' : 'Apply Practitioner preset';
  return `<section class="panel"><span class="eyebrow">Preset</span><h2>${escapeHtml(label)}</h2><p class="note">Presets are server-defined. Applying one changes only role, scopes and explicit capabilities; identity and credentials stay with this principal.</p><form data-access-preset-form data-principal-id="${escapeHtml(principal.id)}" data-principal-revision="${escapeHtml(principal.revision)}"><input type="hidden" name="preset" value="${preset}"><button class="button primary" type="submit">${escapeHtml(label)}</button></form><p class="status" role="status" aria-live="polite" data-access-status></p></section>`;
}

function deviceSigninPanel(principal) {
  if (!principal.receptionIdentity || !principal.active) return '';
  return `<section class="panel"><span class="eyebrow">Security</span><h2>Set up device sign-in</h2><p class="note">Create a fresh passkey setup link for the existing Shiloh Reception principal. This adds a device credential; it does not remove existing passkeys or change Reception access.</p><p class="warning">The setup link is sensitive, single-use and expires after 10 minutes. Open it only on the dedicated Reception phone.</p><form data-device-signin-form data-principal-id="${escapeHtml(principal.id)}"><button class="button primary" type="submit">Set up device sign-in</button></form><div class="preview" data-device-signin-result hidden><strong>Reception setup link ready</strong><p class="note">Copy this link to the Reception phone and open it there before it expires.</p><code class="setup-link" data-device-signin-url></code><div class="actions"><a class="button" data-device-signin-open rel="noreferrer">Open setup link</a><button class="button" type="button" data-device-signin-copy>Copy setup link</button></div></div><p class="status" role="status" aria-live="polite" data-access-status></p></section>`;
}

function copyPanel(principal, sources) {
  if (!principal.staff || principal.staff.status !== 'active' || principal.staff.resourceType !== 'practitioner' || principal.staff.businessRole !== 'employee_practitioner') return '';
  const options = sources.map(source => `<option value="${escapeHtml(source.id)}" data-source-revision="${escapeHtml(source.revision)}">${escapeHtml(source.displayName)}</option>`).join('');
  return `<section class="panel"><span class="eyebrow">Copy access</span><h2>Copy from another practitioner</h2><p class="note">Copies only the compatible practitioner role, scopes and operational capabilities. It never copies mobile identity, authenticator, recovery, sessions, profile data or history.</p>${options ? `<form data-access-copy-form data-principal-id="${escapeHtml(principal.id)}" data-principal-revision="${escapeHtml(principal.revision)}"><div class="field"><label for="copy-source">Copy access from</label><select id="copy-source" name="sourcePrincipalId">${options}</select></div><div class="actions"><button class="button" type="button" data-copy-preview>Preview change</button><button class="button primary" type="submit" data-copy-save disabled>Save copied access</button></div><div class="preview" data-copy-preview-result hidden></div></form>` : '<p class="warning">No other compatible practitioner source is currently available.</p>'}<p class="status" role="status" aria-live="polite" data-access-status></p></section>`;
}

function lifecyclePanel(principal, operatorAdminId) {
  const lifecycleAllowed = principal.id !== Number(operatorAdminId)
    && (principal.receptionLifecycleAllowed || principal.practitionerLifecycleAllowed);
  if (!lifecycleAllowed) return '';
  const next = !principal.active;
  return `<section class="panel"><span class="eyebrow">Lifecycle</span><h2>${principal.active ? 'Disable Workspace access' : 'Re-enable Workspace access'}</h2><p class="note">${principal.active ? 'Disables sign-in without deleting identity, Staff, history or stored authority.' : 'Restores only this principal’s currently stored authority. No default capabilities are added.'}</p><form data-access-status-form data-principal-id="${escapeHtml(principal.id)}" data-principal-revision="${escapeHtml(principal.revision)}" data-active="${next}"><button class="button ${principal.active ? 'danger' : 'primary'}" type="submit">${principal.active ? 'Disable access' : 'Re-enable access'}</button></form><p class="status" role="status" aria-live="polite" data-access-status></p></section>`;
}

function renderAccessDetailPage(model = {}) {
  const p = model.principal;
  const body = `<main><section class="panel"><span class="eyebrow">Workspace principal</span><h2>${escapeHtml(p.displayName)}</h2>${summaryMarkup(p)}</section>${capabilityMarkup(p)}${deviceSigninPanel(p)}${presetPanel(p)}${copyPanel(p, model.copySources || [])}${lifecyclePanel(p, model.authority?.operatorAdminId)}<p class="note">Runtime authorization continues to use current canonical capabilities and scopes, never the human-readable preset label.</p></main>`;
  return shell({ title: 'Access detail', subtitle: 'Human-readable canonical authority, with protected advanced details.', displayName: model.authority?.displayName, calendarNavigationAllowed: model.calendarNavigationAllowed, clientsNavigationAllowed: model.clientsNavigationAllowed, body, script: true });
}

function workspaceAccessV2ClientScript() {
  return `(function(){'use strict';var API='/calendar/team/workspace-access';var CSRF='/calendar/staff-auth/csrf';
function one(s,r){return(r||document).querySelector(s);}function rid(){return window.crypto&&crypto.randomUUID?crypto.randomUUID():'A'+Date.now().toString(36)+Math.random().toString(36).slice(2);}async function json(r){try{return await r.json();}catch(_){return{};}}async function token(){var r=await fetch(CSRF,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:'{}'});var b=await json(r);if(!r.ok||!b.csrfToken)throw new Error('Your secure Shiloh session has expired.');return b.csrfToken;}function status(form,msg,tone){var p=form.closest('.panel'),el=one('[data-access-status]',p);if(el){el.textContent=msg||'';el.dataset.tone=tone||'ready';}}function busy(form,on){Array.prototype.forEach.call(form.querySelectorAll('button,input,select'),function(el){if(on){el.dataset.wasDisabled=el.disabled?'1':'0';el.disabled=true;}else{el.disabled=el.dataset.wasDisabled==='1';delete el.dataset.wasDisabled;}});}async function post(path,payload){var t=await token();var r=await fetch(API+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json','x-shiloh-csrf-token':t},body:JSON.stringify(payload)});t='';var b=await json(r);if(!r.ok)throw new Error(b.error||'Workspace access change failed closed.');return b;}
var create=one('[data-reception-create-form]');if(create)create.addEventListener('submit',async function(e){e.preventDefault();var f=new FormData(create);if(f.get('identityConfirmed')!=='on'){status(create,'Verify the clinic-controlled mobile first.','error');return;}busy(create,true);try{await post('/reception',{requestId:rid(),whatsappNumber:f.get('whatsappNumber'),identityConfirmed:true});location.reload();}catch(err){status(create,err.message,'error');busy(create,false);}});
var preset=one('[data-access-preset-form]');if(preset)preset.addEventListener('submit',async function(e){e.preventDefault();busy(preset,true);try{await post('/'+preset.dataset.principalId+'/preset',{requestId:rid(),expectedRevision:preset.dataset.principalRevision,preset:new FormData(preset).get('preset')});location.reload();}catch(err){status(preset,err.message,'error');busy(preset,false);}});
var device=one('[data-device-signin-form]');if(device){var devicePanel=device.closest('.panel'),deviceResult=one('[data-device-signin-result]',devicePanel),deviceUrl=one('[data-device-signin-url]',devicePanel),deviceOpen=one('[data-device-signin-open]',devicePanel),deviceCopy=one('[data-device-signin-copy]',devicePanel),currentSetupUrl='';device.addEventListener('submit',async function(e){e.preventDefault();busy(device,true);deviceResult.hidden=true;currentSetupUrl='';try{var b=await post('/'+device.dataset.principalId+'/device-signin-setup',{requestId:rid()});currentSetupUrl=String(b.setupUrl||'');if(!currentSetupUrl)throw new Error('Shiloh did not return a device setup link.');deviceUrl.textContent=currentSetupUrl;deviceOpen.href=currentSetupUrl;deviceResult.hidden=false;status(device,'Setup link created. Open it on the Reception phone within 10 minutes.','ready');busy(device,false);}catch(err){status(device,err.message,'error');busy(device,false);}});deviceCopy.addEventListener('click',async function(){if(!currentSetupUrl)return;try{await navigator.clipboard.writeText(currentSetupUrl);status(device,'Setup link copied. Open it only on the Reception phone.','ready');}catch(_){status(device,'Copy was blocked by the browser. Select the setup link above and copy it manually.','error');}});}
var lifecycle=one('[data-access-status-form]');if(lifecycle)lifecycle.addEventListener('submit',async function(e){e.preventDefault();var active=lifecycle.dataset.active==='true';if(!active&&!window.confirm('Disable this principal’s Workspace access? Identity and history will be preserved.'))return;busy(lifecycle,true);try{await post('/'+lifecycle.dataset.principalId+'/status',{requestId:rid(),expectedRevision:lifecycle.dataset.principalRevision,active:active});location.reload();}catch(err){status(lifecycle,err.message,'error');busy(lifecycle,false);}});
var copy=one('[data-access-copy-form]');if(copy){var preview=null,select=one('select',copy),save=one('[data-copy-save]',copy),output=one('[data-copy-preview-result]',copy);function source(){var o=select.options[select.selectedIndex];return{sourcePrincipalId:o.value,expectedSourceRevision:o.dataset.sourceRevision};}select.addEventListener('change',function(){preview=null;save.disabled=true;output.hidden=true;});one('[data-copy-preview]',copy).addEventListener('click',async function(){busy(copy,true);try{var s=source();preview=await post('/'+copy.dataset.principalId+'/copy-preview',{expectedRevision:copy.dataset.principalRevision,sourcePrincipalId:s.sourcePrincipalId,expectedSourceRevision:s.expectedSourceRevision});output.innerHTML='<div class="preview-grid"><div><strong>Before</strong><br>'+preview.before.capabilities.map(function(x){return x.replace(/[:_]/g,' ');}).join(', ')+'</div><div><strong>After</strong><br>'+preview.after.capabilities.map(function(x){return x.replace(/[:_]/g,' ');}).join(', ')+'</div></div><p class="note">Identity, credentials and profile data copied: No</p>';output.hidden=false;busy(copy,false);save.disabled=false;}catch(err){status(copy,err.message,'error');busy(copy,false);}});copy.addEventListener('submit',async function(e){e.preventDefault();if(!preview){status(copy,'Preview the current change before saving.','error');return;}busy(copy,true);try{var s=source();await post('/'+copy.dataset.principalId+'/copy',{requestId:rid(),expectedRevision:copy.dataset.principalRevision,sourcePrincipalId:s.sourcePrincipalId,expectedSourceRevision:s.expectedSourceRevision});location.reload();}catch(err){status(copy,err.message,'error');busy(copy,false);}});}
})();`;
}

module.exports = { CAPABILITY_LABELS, human, capabilityLabel, renderAccessListPage, renderAccessDetailPage, workspaceAccessV2ClientScript };
