function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createFormMarkup({ calendar = false } = {}) {
  const prefix = calendar ? 'calendar-' : 'workspace-';
  return `<form data-service-create-form data-create-context="${calendar ? 'calendar' : 'workspace'}" class="service-create-form">
    <div class="service-create-grid">
      <label>Service name<input data-create-name type="text" maxlength="180" autocomplete="off" required placeholder="Treatment name"></label>
      <label>Duration (minutes)<input data-create-duration type="number" min="1" max="1440" step="1" inputmode="numeric" required placeholder="60"></label>
      <label>Price (R)<input data-create-price type="number" min="0" step="0.01" inputmode="decimal" placeholder="650.00"></label>
      <label>Display price (optional)<input data-create-display-price type="text" maxlength="120" placeholder="From R650"></label>
      <label class="service-create-description">Website description<textarea data-create-description minlength="20" maxlength="2000" required placeholder="Describe what the client can expect in warm, simple language."></textarea><small>This approved wording appears on Shiloh’s Services and Booking pages when the service is available for online booking.</small></label>
    </div>
    <label class="service-create-check"><input data-create-variable type="checkbox"> Variable / from-price service</label>
    <fieldset class="service-create-practitioners"><legend>Practitioner assignment</legend><div data-create-practitioners>Loading eligible practitioners…</div></fieldset>
    <div class="service-create-actions"><button type="submit" data-create-submit>Create service</button>${calendar ? '<button type="button" data-create-cancel>Cancel</button>' : ''}</div>
    <div data-create-status role="status" aria-live="polite">${escapeHtml(prefix === 'calendar-' ? 'Create a canonical service and use it for this booking.' : 'Create one canonical service and assign its practitioners.')}</div>
  </form>`;
}

function sharedStyles() {
  return `.service-create-form{display:grid;gap:12px}.service-create-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.service-create-form label{display:grid;gap:5px;font-size:.8rem;font-weight:750}.service-create-form input[type=text],.service-create-form input[type=number],.service-create-form textarea{width:100%;min-height:44px;border:1px solid #cfd8d1;border-radius:10px;padding:9px 11px;background:#fff;color:#20322b;font:inherit}.service-create-form textarea{min-height:112px;resize:vertical;line-height:1.5}.service-create-description{grid-column:1/-1}.service-create-description small{color:#66776f;font-weight:500;line-height:1.45}.service-create-check{grid-template-columns:auto 1fr!important;align-items:center;justify-content:start}.service-create-practitioners{border:1px solid #dfe5df;border-radius:12px;padding:10px 12px}.service-create-practitioners legend{padding:0 5px;font-size:.78rem;font-weight:800}.service-create-practitioners [data-create-practitioners]{display:grid;gap:7px}.service-create-practitioners label{grid-template-columns:auto 1fr!important;align-items:center}.service-create-actions{display:flex;gap:8px;flex-wrap:wrap}.service-create-actions button{min-height:44px;border:1px solid #496b5a;border-radius:999px;padding:9px 14px;background:#496b5a;color:#fff;font:inherit;font-weight:800;cursor:pointer}.service-create-actions button+button{background:#fff;color:#496b5a}[data-create-status]{font-size:.78rem;color:#66776f}.service-create-form.is-error [data-create-status]{color:#8a3f3f}.service-create-form.is-ready [data-create-status]{color:#496b5a}@media(max-width:650px){.service-create-grid{grid-template-columns:1fr}.service-create-actions button{width:100%}}`;
}

function renderWorkspaceServiceCreationPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create service · Shiloh Workspace</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f3ed;color:#20322b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:820px;margin:0 auto;padding:22px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:16px}.top h1{margin:0;font-size:1.5rem}.top a{color:#496b5a;font-weight:800;text-decoration:none}.panel{background:#fffdf9;border:1px solid #dfe5df;border-radius:17px;padding:18px;box-shadow:0 8px 28px rgba(32,50,43,.06)}${sharedStyles()}</style><script src="/calendar/services/create.js" defer></script></head><body><main class="shell"><div class="top"><div><h1>Create service</h1><p>Create one canonical Shiloh treatment.</p></div><a href="/calendar/services">← Services</a></div><section class="panel">${createFormMarkup()}</section></main></body></html>`;
}

function injectWorkspaceServiceCreateAction(html) {
  const source = String(html || '');
  const anchor = '<main data-services-list-view>';
  if (!source.includes(anchor)) return source;
  return source.replace(anchor, `${anchor}<div data-service-primary-action style="display:flex;justify-content:flex-start;margin:0 0 12px"><a class="button primary" href="/calendar/services/new">+ Add service</a></div>`);
}

function injectCalendarInlineServiceCreation(html) {
  const source = String(html || '');
  const anchor = '<div class="field"><label for="staff-select">Eligible practitioner</label>';
  if (!source.includes(anchor)) return source;
  const block = `<div class="field wide" data-inline-service-create><button class="button secondary" type="button" data-create-toggle>+ Create a new / custom service</button><div data-create-panel hidden style="margin-top:10px;padding:14px;border:1px solid var(--line);border-radius:14px;background:#fff"><style>${sharedStyles()}</style>${createFormMarkup({ calendar: true })}</div></div>`;
  return source.replace(anchor, `${block}${anchor}`);
}

function serviceCreationClientScript() {
  return `(function(){'use strict';
var API='/calendar/services';var AUTH='/calendar/staff-auth';
function one(s,r){return(r||document).querySelector(s);}function all(s,r){return Array.from((r||document).querySelectorAll(s));}
function json(r){return r.json().catch(function(){return {};});}
function requestId(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID().replace(/-/g,'_');return 'svc_'+Date.now()+'_'+Math.random().toString(36).slice(2);}
async function csrf(){var r=await fetch(AUTH+'/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});var b=await json(r);if(!r.ok||!b.csrfToken)throw new Error('Your Shiloh session needs to be refreshed.');return b.csrfToken;}
function status(form,message,tone){var n=one('[data-create-status]',form);if(n)n.textContent=message;form.classList.toggle('is-error',tone==='error');form.classList.toggle('is-ready',tone==='ready');}
async function loadOptions(form){var r=await fetch(API+'/create-options',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});var b=await json(r);if(!r.ok)throw new Error(b.error||'Service creation is not available for this account.');var host=one('[data-create-practitioners]',form);host.textContent='';var current=one('#staff-select');var currentId=current&&Number(current.value);(b.practitioners||[]).forEach(function(p){var label=document.createElement('label');var input=document.createElement('input');input.type='checkbox';input.value=String(p.id);input.setAttribute('data-create-practitioner','');if((b.practitioners||[]).length===1||Number(p.id)===currentId)input.checked=true;var span=document.createElement('span');span.textContent=p.displayName;label.appendChild(input);label.appendChild(span);host.appendChild(label);});if(!(b.practitioners||[]).length)throw new Error('No active canonical practitioners are available.');}
async function submit(form){var selected=all('[data-create-practitioner]:checked',form).map(function(n){return Number(n.value);}).filter(Boolean);var payload={requestId:requestId(),name:one('[data-create-name]',form).value,durationMinutes:one('[data-create-duration]',form).value,price:one('[data-create-price]',form).value,displayPrice:one('[data-create-display-price]',form).value,customerDescription:one('[data-create-description]',form).value,variablePrice:one('[data-create-variable]',form).checked,staffIds:selected};var button=one('[data-create-submit]',form);button.disabled=true;status(form,'Creating canonical service…');try{var token=await csrf();var r=await fetch(API+'/create',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify(payload)});var b=await json(r);if(!r.ok||!b.service||!b.service.id)throw new Error(b.error||'Shiloh could not create this service.');status(form,'Service created.','ready');if(form.getAttribute('data-create-context')==='calendar'){var u=new URL(window.location.href);var d=one('#booking-date');if(d&&d.value)u.searchParams.set('date',d.value);u.searchParams.set('createdServiceId',String(b.service.id));window.location.assign(u.pathname+'?'+u.searchParams.toString());}else{window.location.assign('/calendar/services/'+encodeURIComponent(b.service.id));}}catch(e){button.disabled=false;status(form,e&&e.message?e.message:'Service creation failed closed.','error');}}
function initForm(form){loadOptions(form).catch(function(e){status(form,e.message,'error');var b=one('[data-create-submit]',form);if(b)b.disabled=true;});form.addEventListener('submit',function(e){e.preventDefault();submit(form);});}
all('[data-service-create-form]').forEach(initForm);var toggle=one('[data-create-toggle]');var panel=one('[data-create-panel]');if(toggle&&panel)toggle.addEventListener('click',function(){panel.hidden=!panel.hidden;if(!panel.hidden){var n=one('[data-create-name]',panel);if(n)n.focus();}});var cancel=one('[data-create-cancel]');if(cancel&&panel)cancel.addEventListener('click',function(){panel.hidden=true;});
var created=new URL(window.location.href).searchParams.get('createdServiceId');if(created){var select=one('#service-select');if(select&&all('option',select).some(function(o){return o.value===created;})){select.value=created;select.dispatchEvent(new Event('change',{bubbles:true}));}var clean=new URL(window.location.href);clean.searchParams.delete('createdServiceId');history.replaceState(null,'',clean.pathname+(clean.searchParams.toString()?'?'+clean.searchParams.toString():''));}
})();`;
}

module.exports = {
  createFormMarkup,
  sharedStyles,
  renderWorkspaceServiceCreationPage,
  injectWorkspaceServiceCreateAction,
  injectCalendarInlineServiceCreation,
  serviceCreationClientScript,
};
