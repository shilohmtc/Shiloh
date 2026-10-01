const { workspaceErrorRecoveryClientScript } = require('./workspaceErrorRecovery');
const { escapeHtml } = require('./workspaceShell');

const READ_ONLY_NOTE = '<div class="read-only-note">Access settings are view only here. Staff profile changes do not create or edit sign-in credentials.</div>';
const POLICY_STYLES = '<style>.access-policy-scope{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:0 0 13px}.access-policy-scope div{padding:10px 11px;border:1px solid var(--line);border-radius:11px;background:#fff}.access-policy-scope span{display:block;color:var(--muted);font-size:.68rem;margin-bottom:4px}.access-policy-scope strong{font-size:.82rem}.access-policy-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.access-policy-option{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:start;min-height:54px;padding:10px 11px;border:1px solid var(--line-strong);border-radius:11px;background:#fff;cursor:pointer}.access-policy-option input{width:18px;height:18px;margin:2px 0 0}.access-policy-option strong,.access-policy-option span{display:block}.access-policy-option .policy-copy span{margin-top:3px;color:var(--muted);font-size:.7rem;line-height:1.35}.access-policy-option.required{background:var(--leaf-soft);cursor:default}.policy-state{font-size:.67rem;color:var(--leaf);font-weight:800;white-space:nowrap}.access-policy-heading{margin:0 0 10px;font-size:.86rem}.access-policy-help{margin:8px 0 0;color:var(--muted);font-size:.72rem;line-height:1.45}@media(max-width:700px){.access-policy-scope,.access-policy-options{grid-template-columns:1fr}.access-policy-option{min-height:52px;align-items:center}.access-policy-option input{width:20px;height:20px}.policy-state{align-self:center}}</style>';

function isCompatibleLegacyAccessView(access) {
  return Boolean(access)
    && access.businessRole === 'employee_practitioner'
    && access.calendarScope === 'own_appointments'
    && access.serviceScope === 'own_services'
    && Array.isArray(access.capabilities)
    && access.capabilities.length === 0;
}

function eligibleEmployeePractitioner(staff = {}) {
  return staff.status === 'active'
    && staff.resource_type === 'practitioner'
    && staff.business_role === 'employee_practitioner';
}

function accessFormMarkup(staff, { mode = 'enable' } = {}) {
  const completion = mode === 'complete';
  const button = completion ? 'Complete Workspace access' : 'Enable Workspace access';
  const badge = completion ? 'Complete view-only access' : 'View-only practitioner preset';
  const contractMarker = completion ? 'adds <strong>appointment:view</strong> only' : 'appointment:view';
  const scopeNote = completion
    ? 'Keeps the existing WhatsApp identity, role and access boundaries and adds appointment viewing only. It does not add other access or create, reset or expose sign-in credentials.'
    : 'Creates one linked Workspace access profile with appointment viewing, own appointments and own services only. It does not allow booking changes, schedules, pricing, Staff management or Access management, and it does not create or reset sign-in credentials.';
  return `<div data-staff-access-management><p class="status-message" role="status" aria-live="polite" data-staff-access-status></p><form data-staff-access-enable-form data-access-mode="${mode}" data-access-contract="${contractMarker}" data-staff-id="${escapeHtml(staff.id)}" data-staff-revision="${escapeHtml(staff.revision)}"><div class="edit-grid"><div class="field wide"><label for="staff-access-whatsapp">Staff WhatsApp mobile</label><input id="staff-access-whatsapp" name="whatsappNumber" type="tel" inputmode="tel" autocomplete="tel" required maxlength="24" placeholder="e.g. 082 123 4567" aria-describedby="staff-access-scope"></div><div class="field wide"><label class="check-field"><input name="identityConfirmed" type="checkbox" required> I verified this is ${escapeHtml(staff.display_name)}’s current WhatsApp number.</label></div></div><div class="manage-actions"><button class="button primary" type="submit">${button}</button><span class="manage-badge">${badge}</span></div></form><div id="staff-access-scope" class="read-only-note">${scopeNote}</div></div>`;
}

function humanScope(value) {
  const raw = String(value || '').replace(/_/g, ' ').trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Not configured';
}

function accessPolicyMarkup(model = {}) {
  const policy = model.accessPolicy || {};
  const enabled = new Set(Array.isArray(policy.capabilities) ? policy.capabilities : []);
  const definitions = Array.isArray(policy.definitions) ? policy.definitions : [];
  const controls = definitions.map(item => {
    const mandatory = item.mandatory === true;
    const checked = mandatory || enabled.has(item.key);
    const requirement = mandatory ? '<span class="policy-state">Required</span>' : '';
    return `<label class="access-policy-option${mandatory ? ' required' : ''}" data-access-capability="${escapeHtml(item.key)}"><input type="checkbox" name="capability" value="${escapeHtml(item.key)}"${checked ? ' checked' : ''}${mandatory ? ' disabled aria-disabled="true"' : ''}><span class="policy-copy"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)}</span></span>${requirement}</label>`;
  }).join('');
  return `<div data-staff-access-management data-access-policy-editor><p class="status-message" role="status" aria-live="polite" data-staff-access-status></p><div class="access-policy-scope" aria-label="Fixed practitioner access"><div><span>Business role</span><strong>${escapeHtml(humanScope(policy.businessRole))}</strong></div><div><span>Calendar access</span><strong>${escapeHtml(humanScope(policy.calendarScope))}</strong></div><div><span>Service access</span><strong>${escapeHtml(humanScope(policy.serviceScope))}</strong></div></div><h3 class="access-policy-heading">Workspace access</h3><form data-staff-access-policy-form data-staff-id="${escapeHtml(model.staff?.id)}" data-access-revision="${escapeHtml(policy.revision)}"><div class="access-policy-options">${controls}</div>${policy.key==='workspace_retrospective_access_v1'?`<div class="field wide"><label for="retrospective-client-ids">Client record IDs (optional restriction)</label><input id="retrospective-client-ids" name="retrospectiveClientIds" inputmode="numeric" value="${escapeHtml(Array.isArray(policy.retrospectiveClientIds)?policy.retrospectiveClientIds.join(', '):'')}" placeholder="Leave blank for existing access"><span class="policy-copy">Comma-separated client record IDs. Existing staff, service and location access still applies.</span></div>`:''}<p class="access-policy-help"><strong>Complete / No-show visits</strong> is available only when this staff member’s appointment access and assignment are valid. Other booking and schedule changes are managed separately.</p><div class="manage-actions"><button class="button primary" type="submit">Save access</button><span class="manage-badge">Practitioner access</span></div></form><div class="read-only-note">This page does not change role, Calendar access, service access, WhatsApp identity, sign-in credentials, owner/admin access or protected security settings.</div></div>`;
}

function accessEnablementMarkup(model = {}) {
  if (model.accessManageAllowed !== true) return READ_ONLY_NOTE;
  const staff = model.staff || {};
  if (Number.isSafeInteger(Number(model.access?.id)) && Number(model.access.id) > 0) {
    return `<div data-staff-access-management><p class="read-only-note">Manage this person’s individual permissions in Staff access.</p><a class="button primary" href="/calendar/team/staff-access/${Number(model.access.id)}">Manage individual access</a></div>`;
  }
  if (model.access) {
    if (eligibleEmployeePractitioner(staff) && isCompatibleLegacyAccessView(model.access)) {
      return `${accessFormMarkup(staff, { mode: 'complete' })}<p class="footer-note">This completion option is available only when existing active access already matches the employee-practitioner settings and has no extra enabled access. Different or broader access remains unchanged.</p>`;
    }
    if (model.accessPolicy?.supported === true) return accessPolicyMarkup(model);
    const reason = model.accessPolicy?.reason
      ? '<div class="warning-note">This access setup cannot be edited with the simple practitioner controls.</div>'
      : '';
    return `<div data-staff-access-readonly data-access-contract="Existing access is preserved">${READ_ONLY_NOTE}${reason}<p class="footer-note">Existing access is unchanged. Protected, broader or incompatible access is not silently replaced.</p></div>`;
  }
  if (staff.status !== 'active') {
    return `${READ_ONLY_NOTE}<div class="warning-note">Workspace access can only be enabled for an active Staff profile. Reactivate the Staff profile first if that reflects the current clinic setup.</div>`;
  }
  if (staff.resource_type !== 'practitioner' || staff.business_role !== 'employee_practitioner') {
    return `${READ_ONLY_NOTE}<div class="warning-note">This access setup is only available for active employee practitioners. Other staff access is managed separately.</div>`;
  }
  return accessFormMarkup(staff, { mode: 'enable' });
}

function decorateStaffDetailAccessHtml(html, model = {}) {
  const source = String(html || '');
  const replacement = accessEnablementMarkup(model);
  if (!source.includes(READ_ONLY_NOTE)) return source;
  let result = source.replace(READ_ONLY_NOTE, replacement);
  const canEnableOrComplete = !model.access?.id && model.accessManageAllowed === true
    && eligibleEmployeePractitioner(model.staff || {})
    && (!model.access || isCompatibleLegacyAccessView(model.access));
  const canEditPolicy = !model.access?.id && model.accessManageAllowed === true && model.accessPolicy?.supported === true;
  if ((canEnableOrComplete || canEditPolicy) && !result.includes('/calendar/team/access-manage.js')) {
    result = result.replace('</head>', `${canEditPolicy ? POLICY_STYLES : ''}<script src="/calendar/team/access-manage.js" defer></script></head>`);
  }
  return result;
}

function workspaceStaffAccessClientScript() {
  return workspaceErrorRecoveryClientScript() + `(function(){'use strict';
var API='/calendar/team';var CSRF='/calendar/staff-auth/csrf';var ENABLE_SUFFIX='/access/enable';var COMPLETE_SUFFIX='/access/complete';var POLICY_SUFFIX='/access/policy';
function one(s,r){return(r||document).querySelector(s);}function requestId(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();return'T'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);}
function status(message,tone){var target=one('[data-staff-access-status]');if(!target)return;window.ShilohErrorRecovery.render(target,message,tone);}
async function json(response){try{return await response.json();}catch(_error){return{};}}
async function csrf(){var response=await fetch(CSRF,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});if(!response.ok)throw window.ShilohErrorRecovery.failure({},response,'Your secure Shiloh session has expired.');var body=await json(response);if(!body.csrfToken)throw new Error('A secure operation token could not be issued.');return body.csrfToken;}
function busy(form,on){Array.prototype.forEach.call(form.querySelectorAll('button,input'),function(el){if(on){el.dataset.shilohWasDisabled=el.disabled?'1':'0';el.disabled=true;}else{el.disabled=el.dataset.shilohWasDisabled==='1';delete el.dataset.shilohWasDisabled;}});}
var accessForm=one('[data-staff-access-enable-form]');if(accessForm)accessForm.addEventListener('submit',async function(e){e.preventDefault();var f=new FormData(accessForm);var completion=accessForm.dataset.accessMode==='complete';if(f.get('identityConfirmed')!=='on'){status('Verify the staff member’s current WhatsApp number before changing access.','error');return;}busy(accessForm,true);status(completion?'Completing Workspace access…':'Enabling Workspace access…','working');try{var token=await csrf();var suffix=completion?COMPLETE_SUFFIX:ENABLE_SUFFIX;var response=await fetch(API+'/'+accessForm.dataset.staffId+suffix,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify({requestId:requestId(),expectedRevision:accessForm.dataset.staffRevision,whatsappNumber:f.get('whatsappNumber'),identityConfirmed:true})});token='';var body=await json(response);if(!response.ok)throw window.ShilohErrorRecovery.failure(body,response,'Workspace access change could not be completed.');window.location.reload();}catch(err){status(err,'error');busy(accessForm,false);}});
var policyForm=one('[data-staff-access-policy-form]');if(policyForm)policyForm.addEventListener('submit',async function(e){e.preventDefault();var capabilities=Array.prototype.filter.call(policyForm.querySelectorAll('input[name="capability"]'),function(input){return input.checked;}).map(function(input){return input.value;});busy(policyForm,true);status('Saving practitioner access…','working');try{var token=await csrf();var response=await fetch(API+'/'+policyForm.dataset.staffId+POLICY_SUFFIX,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify({requestId:requestId(),expectedAccessRevision:policyForm.dataset.accessRevision,capabilities:capabilities,retrospectiveClientIds:(one('#retrospective-client-ids')?(one('#retrospective-client-ids').value.trim()?one('#retrospective-client-ids').value.split(',').map(function(v){return v.trim();}).filter(Boolean):null):undefined)})});token='';var body=await json(response);if(!response.ok)throw window.ShilohErrorRecovery.failure(body,response,'Staff access change could not be completed.');window.location.reload();}catch(err){status(err,'error');busy(policyForm,false);}});
})();`;
}

module.exports = {
  READ_ONLY_NOTE,
  POLICY_STYLES,
  isCompatibleLegacyAccessView,
  accessFormMarkup,
  accessPolicyMarkup,
  accessEnablementMarkup,
  decorateStaffDetailAccessHtml,
  workspaceStaffAccessClientScript,
};
