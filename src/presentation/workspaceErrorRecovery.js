// Presentation only: recovery never retries a mutation or changes domain authority.
function workspaceErrorRecoveryClientScript() {
  return `(()=>{'use strict';if(window.ShilohErrorRecovery)return;
let source=null;
document.addEventListener('submit',event=>{source=event.target;},true);
document.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&!button.closest('[data-error-recovery-actions]'))source=button.closest('form')||button;},true);
function failure(body,response,fallback){const error=new Error(body?.error||fallback||'This action could not be completed.');error.code=body?.code;error.status=response?.status;error.recovery=body?.recovery;error.source=source;return error;}
function focus(node){if(!node?.isConnected)return;let parent=node.parentElement;while(parent){if(parent.hidden&&parent.id){const toggle=document.querySelector('[aria-controls="'+CSS.escape(parent.id)+'"]');if(toggle&&toggle.getAttribute('aria-expanded')!=='true')toggle.click();}parent=parent.parentElement;}node.scrollIntoView({block:'nearest'});node.focus();}
function field(origin){return origin?.matches('form')?origin.querySelector(':invalid:not(:disabled),input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)'):origin;}
function render(target,value,tone='ready',options={}){if(!target)return;const error=value instanceof Error?value:null;let message=error instanceof TypeError?'Workspace could not confirm this action.':String(error?.message||value||'');target.replaceChildren();target.dataset.tone=tone;target.setAttribute('role',tone==='error'?'alert':'status');
if(tone!=='error'){target.textContent=message;return;}
const origin=options.source||error?.source||source;const code=String(error?.code||'');const actions=[];let hint='';
if(code==='CALENDAR_OPERATION_SERVICE_MAPPING'&&error?.recovery?.kind==='service_mapping'){
 message=error?.recovery?.serviceHref?'This therapist is not assigned to all treatments in this booking.':'This therapist cannot be assigned to all treatments in this booking.';
 if(origin?.matches('[data-panel-action="appointment:reassign"]'))actions.push({label:'Choose another therapist',run:()=>focus(origin.elements.destinationStaffId)});
 if(/^\\/calendar\\/services\\/[1-9]\\d*#service-practitioners$/.test(error?.recovery?.serviceHref||''))actions.push({label:'Review therapist’s services',href:error.recovery.serviceHref});
 hint=actions.some(action=>action.href)?'Services opens in a new tab; your booking details stay here. Review each treatment before changing an assignment.':'Choose a therapist assigned to every treatment. Ask a clinic administrator if service setup needs correcting.';
}else if(/^CALENDAR_OPERATION_(?:CONFLICT|CLINIC_HOURS|STAFF_SCHEDULE|PAST_WINDOW|INVALID_(?:DATE|TIME|WINDOW))$/.test(code)){
 hint='Choose a time that fits clinic hours and the therapist’s availability.';if(origin?.isConnected)actions.push({label:'Choose another time',run:()=>focus(origin.querySelector('[name="date"],[name="starts"],[name="endsAt"]')||field(origin))});
}else if(error?.status===401||code==='WORKSPACE_SESSION_EXPIRED'){
 message='Your Workspace session has expired.';hint='Sign in in a new tab, then return here. Your entries stay on this page.';actions.push({label:'Sign in to Workspace',href:'/calendar/staff'});
}else if(code.includes('STALE')||code.includes('REVISION')||code.endsWith('_NOT_FOUND')||error?.status===404){
 hint='Your entries stay here. Open the latest record in a new tab and review it before making another change.';actions.push({label:'Review latest record',href:location.pathname+location.search});
}else if(error?.status===403||code.includes('FORBIDDEN')){
 hint='Ask a clinic administrator to review your access. Your entries stay here.';
}else{
 if(origin?.isConnected)actions.push({label:error?.status>=500||error instanceof TypeError?'Review and retry':'Review details',run:()=>focus(field(origin))});
 if(error?.status>=500||error instanceof TypeError)hint='Check your connection and review the current record before trying again. A lost response does not confirm whether a change was saved.';
}
if(options.actions)actions.unshift(...options.actions);
const text=document.createElement('span');text.className='shiloh-error-copy';text.textContent=message;target.appendChild(text);
if(hint){const detail=document.createElement('span');detail.className='shiloh-error-hint';detail.textContent=hint;target.appendChild(detail);}
if(actions.length){const controls=document.createElement('span');controls.dataset.errorRecoveryActions='true';controls.className='shiloh-error-actions';actions.forEach(action=>{const node=document.createElement(action.href?'a':'button');node.className='shiloh-error-action';node.textContent=action.label;if(action.href){node.href=action.href;node.target='_blank';node.rel='noopener';}else{node.type='button';node.addEventListener('click',action.run);}controls.appendChild(node);});target.appendChild(controls);}
target.tabIndex=-1;focus(target);
}
const style=document.createElement('style');style.dataset.workspaceErrorRecovery='true';style.textContent='.shiloh-error-copy,.shiloh-error-hint{display:block;overflow-wrap:anywhere}.shiloh-error-copy{font-weight:750}.shiloh-error-hint{margin-top:6px;font-size:.8rem;line-height:1.5}.shiloh-error-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.shiloh-error-action{display:inline-flex;align-items:center;justify-content:center;min-height:44px;max-width:100%;padding:9px 13px;border:1px solid #526b5e;border-radius:10px;background:#fffdf9;color:#294c3c;font:inherit;font-size:.8rem;font-weight:750;text-decoration:none;cursor:pointer;white-space:normal;text-align:center}.shiloh-error-action:focus-visible{outline:3px solid #294c3c;outline-offset:3px}[data-calendar-panel-status][data-tone="error"]{padding:12px;border:1px solid #d9b4b0;border-radius:10px;background:#f7e9e7;color:#743a32}@media(max-width:700px){.shiloh-error-actions{display:grid;grid-template-columns:minmax(0,1fr)}.shiloh-error-action{width:100%}}';document.head.appendChild(style);
window.ShilohErrorRecovery={failure,render,focus};})();`;
}

module.exports = { workspaceErrorRecoveryClientScript };
