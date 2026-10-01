const { workspaceErrorRecoveryClientScript } = require('./workspaceErrorRecovery');
const CREATE_FORM_MARKER = 'data-staff-create-form';
const ONBOARDING_FORM_MARKER = 'data-staff-onboarding-form';

function accessStepMarkup(accessManageAllowed) {
  if (accessManageAllowed !== true) {
    return '<div class="read-only-note" data-onboarding-access-unavailable>Staff profile creation is available. Workspace access must be enabled later by an operator with Staff access authority.</div>';
  }
  return `<div class="field wide" data-onboarding-access-step>
    <label for="new-workspace-access">Workspace access</label>
    <select id="new-workspace-access" name="workspaceAccess">
      <option value="none">No Workspace access</option>
      <option value="practitioner">Practitioner access</option>
    </select>
  </div>
  <div class="field wide" data-onboarding-identity hidden>
    <label for="new-staff-whatsapp">Staff WhatsApp mobile</label>
    <input id="new-staff-whatsapp" name="whatsappNumber" type="tel" inputmode="tel" autocomplete="tel" maxlength="24" placeholder="e.g. 082 123 4567">
  </div>
  <div class="field wide" data-onboarding-identity hidden>
    <label class="check-field"><input name="identityConfirmed" type="checkbox"> I verified this is the new staff member’s current WhatsApp number.</label>
  </div>`;
}

function decorateStaffListOnboardingHtml(html, model = {}) {
  const source = String(html || '');
  if (model.manageAllowed !== true || !source.includes(CREATE_FORM_MARKER)) return source;

  const accessStep = accessStepMarkup(model.accessManageAllowed === true);
  let result = source
    .replace('<span class="eyebrow">Staff profile</span><h2>Add staff profile</h2>', '<span class="eyebrow">Guided setup</span><h2>Add staff</h2>')
    .replace(CREATE_FORM_MARKER, `${ONBOARDING_FORM_MARKER} data-access-manage-allowed="${model.accessManageAllowed === true ? 'true' : 'false'}"`)
    .replace('<button class="button primary" type="submit">Add staff</button>', `${accessStep}<button class="button primary" type="submit">Create staff</button>`)
    .replace('Adds the staff profile only. It does not create Workspace access, sign-in setup or service assignments.', 'Create the canonical Staff profile first. If authorized, you can also enable the fixed practitioner Workspace preset in this same flow. Service assignments remain in Workspace → Services.')
    .replace('</head>', '<style>[data-onboarding-identity][hidden]{display:none!important}.onboarding-ready{padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--leaf-soft);line-height:1.45}.onboarding-ready h3{margin:0 0 6px;font-size:.95rem}.onboarding-ready p{margin:5px 0;font-size:.78rem}.onboarding-ready .button{margin-top:8px}.create-grid [data-onboarding-access-step],.create-grid [data-onboarding-identity]{grid-column:span 2}@media(max-width:700px){.create-grid [data-onboarding-access-step],.create-grid [data-onboarding-identity]{grid-column:span 1}.onboarding-ready .button{min-height:44px;width:100%}}</style><script src="/calendar/team/onboarding.js" defer></script></head>');
  return result;
}

function workspaceStaffOnboardingClientScript() {
  return workspaceErrorRecoveryClientScript() + `(function(){'use strict';
var API='/calendar/team';var AUTH='/calendar/staff-auth';
function one(s,r){return(r||document).querySelector(s);}function all(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
function requestId(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();return'T'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);}
async function json(response){try{return await response.json();}catch(_error){return{};}}
async function csrf(){var response=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});if(!response.ok)throw window.ShilohErrorRecovery.failure({},response,'Your secure Shiloh session has expired.');var body=await json(response);if(!body.csrfToken)throw new Error('A secure operation token could not be issued.');return body.csrfToken;}
async function post(path,payload){var token=await csrf();var response=await fetch(API+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify(payload||{})});token='';var body=await json(response);if(!response.ok){var error=new Error(body.error||'Staff setup could not be completed.');error.code=body.code||'';throw error;}return body;}
function busy(form,on){all('button,input,select',form).forEach(function(el){el.disabled=on;});}
function status(form,message,tone){var root=form.closest('[data-staff-management]')||document;var target=one('[data-staff-operation-status]',root);if(!target)return;window.ShilohErrorRecovery.render(target,message,tone);}
function setIdentityState(form){var type=String(one('[name="resourceType"]',form)?.value||'practitioner');var access=one('[name="workspaceAccess"]',form);if(!access)return;if(type!=='practitioner')access.value='none';access.disabled=type!=='practitioner';var enabled=type==='practitioner'&&access.value==='practitioner';all('[data-onboarding-identity]',form).forEach(function(row){row.hidden=!enabled;all('input',row).forEach(function(input){input.required=enabled;input.disabled=!enabled;});});}
function ready(form,staffId,accessEnabled,message){var root=form.closest('[data-staff-management]');if(!root)return;form.hidden=true;var box=document.createElement('div');box.className='onboarding-ready';box.setAttribute('data-onboarding-ready','true');var heading=document.createElement('h3');heading.textContent=accessEnabled?'Ready for device setup':'Staff profile created';box.appendChild(heading);var summary=document.createElement('p');summary.textContent=message;box.appendChild(summary);if(accessEnabled){var next=document.createElement('p');next.textContent='Open Staff access for this person. An authorized administrator signs in with a passkey, confirms the person and recorded mobile, then sends an SMS setup code and shares the private setup link with them.';box.appendChild(next);}else{var nextNoAccess=document.createElement('p');nextNoAccess.textContent='Workspace access and sign-in remain unchanged. An authorized operator can enable access later from this staff member’s Access section.';box.appendChild(nextNoAccess);}var services=document.createElement('p');services.textContent='Assign treatments separately from Workspace → Services when required.';box.appendChild(services);var link=document.createElement('a');link.className='button primary';link.href=API+'/'+encodeURIComponent(String(staffId));link.textContent='Open staff profile';box.appendChild(link);root.appendChild(box);}
var form=one('['+${JSON.stringify(ONBOARDING_FORM_MARKER)}+']');if(!form)return;var resource=one('[name="resourceType"]',form);var access=one('[name="workspaceAccess"]',form);if(resource)resource.addEventListener('change',function(){setIdentityState(form);});if(access)access.addEventListener('change',function(){setIdentityState(form);});setIdentityState(form);
form.addEventListener('submit',async function(event){event.preventDefault();var fields=new FormData(form);var type=String(fields.get('resourceType')||'practitioner');var wantsAccess=type==='practitioner'&&String(fields.get('workspaceAccess')||'none')==='practitioner';if(wantsAccess&&fields.get('identityConfirmed')!=='on'){status(form,'Verify the staff member’s current WhatsApp number before enabling Workspace access.','error');return;}busy(form,true);status(form,'Creating canonical Staff profile…','working');var created=null;try{created=await post('/create',{requestId:requestId(),displayName:fields.get('displayName'),resourceType:type,schedulingType:type==='business_resource'?'system':fields.get('schedulingType'),clientBookable:type==='business_resource'?false:fields.get('clientBookable')==='on'});}catch(error){status(form,error,'error');busy(form,false);return;}
if(!wantsAccess){ready(form,created.staffId,false,'The canonical Staff profile was created.');status(form,'','ready');return;}
status(form,'Staff profile created. Enabling least-privilege practitioner access…','working');try{await post('/'+created.staffId+'/access/enable',{requestId:requestId(),expectedRevision:created.revision,whatsappNumber:fields.get('whatsappNumber'),identityConfirmed:true});ready(form,created.staffId,true,'Staff profile and practitioner Workspace access are enabled.');status(form,'','ready');}catch(error){ready(form,created.staffId,false,'The Staff profile was created, but Workspace access was not enabled: '+error.message);status(form,'','ready');}});
})();`;
}

module.exports = {
  CREATE_FORM_MARKER,
  ONBOARDING_FORM_MARKER,
  accessStepMarkup,
  decorateStaffListOnboardingHtml,
  workspaceStaffOnboardingClientScript,
};
