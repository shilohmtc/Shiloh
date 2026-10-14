'use strict';

const { escapeHtml } = require('./workspaceShell');
const { confirmationClientScript } = require('./workspaceConfirmation');

function planningRequestContact(item) {
  const mobile=String(item.client_mobile||'');
  const phone=/^27[678][0-9]{8}$/.test(mobile) ? `<a class="button" href="tel:+${mobile}">Call +${escapeHtml(mobile)}</a>` : '';
  const client=Number.isSafeInteger(Number(item.client_id))&&Number(item.client_id)>0 ? `<a class="button" href="/calendar/clients/${Number(item.client_id)}">Open client profile</a>` : '';
  const submitted=new Date(item.requested_at);
  const timestamp=item.requested_at && Number.isFinite(submitted.getTime()) ? new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(submitted) : '';
  const origin=item.source_channel==='my_shiloh' ? `<p class="request-note">Submitted through My Shiloh${timestamp ? ' · '+escapeHtml(timestamp) : ''}</p>` : '';
  return origin+(phone||client ? `<p class="request-note planning-contact">${[phone,client].filter(Boolean).join(' ')}</p>` : '');
}

function planningRequestCompletion(item) {
  const name=escapeHtml(item.client_name),key=escapeHtml(item.id);
  return `<section class="planning-completion" data-planning-completion data-enquiry-revision="${escapeHtml(item.updated_at ? new Date(item.updated_at).toISOString() : '')}" data-enquiry-client="${name}">
    <details data-attended-details><summary class="button">Already attended</summary>
      <p class="request-note">Select ${name}’s actual completed visit. If it is missing, record the past appointment, save its attendance outcome in Dashboard, then refresh visits. Treatment and guest details must match what actually happened.</p>
      <div class="request-actions"><a class="button" href="/calendar/book/past?clientName=${escapeHtml(encodeURIComponent(item.client_name||''))}">Record past appointment</a><button class="action-button" type="button" data-enquiry-refresh>Refresh completed visits</button></div>
      <label class="proposal-field" for="attended-visit-${key}"><span>Actual completed visit</span><select id="attended-visit-${key}" data-enquiry-visit disabled><option value="">Refresh completed visits</option></select></label>
      <p class="request-note" data-enquiry-visit-summary hidden></p>
      <button class="action-button complete" type="button" data-enquiry-action="attended" disabled>Confirm visit already attended</button>
    </details>
    <button class="action-button" type="button" data-enquiry-action="cancelled">Client cancelled</button>
    <p class="operation-status request-operation-status" data-enquiry-status role="status" aria-live="polite"></p>
  </section>`;
}

function planningCompletionBrowser() {
  'use strict';
  if(window.ShilohPlanningCompletion)return;
  window.ShilohPlanningCompletion=true;
  for(const section of document.querySelectorAll('[data-planning-completion]')) {
    const card=section.closest('[data-dashboard-planning-request]'),status=section.querySelector('[data-enquiry-status]');
    const select=section.querySelector('[data-enquiry-visit]'),summary=section.querySelector('[data-enquiry-visit-summary]');
    const state={busy:false,receipt:null,resolved:false};
    const path='/calendar/workspace/planning-requests/'+encodeURIComponent(card.dataset.dashboardPlanningRequest);
    function sync(){section.querySelectorAll('button').forEach(button=>{button.disabled=state.busy||state.resolved||(button.dataset.enquiryAction==='attended'&&!select.value);});select.disabled=state.busy||state.resolved||select.options.length<2;summary.hidden=!select.value;summary.textContent=select.value?select.selectedOptions[0].textContent:'';}
    select.addEventListener('change',()=>{state.receipt=null;sync();});
    async function readVisits(){const response=await fetch(path+'/appointments?kind=attended',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok){const e=new Error(data.error||'Visits could not be refreshed.');e.code=data.code;throw e;}return data;}
    section.addEventListener('click',async event=>{
      const button=event.target.closest('[data-enquiry-refresh],[data-enquiry-action]');if(!button||state.busy||state.resolved)return;
      state.busy=true;status.dataset.tone='ready';sync();
      try {
        if(button.hasAttribute('data-enquiry-refresh')) {
          status.textContent='Checking completed visits…';
          const data=await readVisits();section.dataset.enquiryRevision=data.revision;state.receipt=null;
          select.replaceChildren(new Option(data.appointments.length?'Choose actual completed visit':'No completed visits recorded',''));
          const format=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
          for(const item of data.appointments)select.add(new Option([format.format(new Date(item.startsAt)),item.serviceName,item.staffNames].filter(Boolean).join(' · '),String(item.id)));
          status.textContent=data.appointments.length?'Choose the actual visit attended.':'No completed visit is available. Record the past appointment and save its attendance outcome, then refresh visits.';
          return;
        }
        const action=button.dataset.enquiryAction;
        const payload={expectedRevision:section.dataset.enquiryRevision,confirmed:true,...(action==='attended'?{appointmentId:Number(select.value)}:{})};
        if(action==='attended'&&!payload.appointmentId)return;
        const confirmed=await window.ShilohConfirm({title:action==='cancelled'?'Close '+section.dataset.enquiryClient+'’s enquiry?':'Confirm '+section.dataset.enquiryClient+' already attended?',
          copy:action==='cancelled'?'The client no longer wants this enquiry. It will leave Needs attention and remain in their history. To cancel an existing Calendar booking, use Cancel appointment in Calendar.':
            select.selectedOptions[0].textContent+'. This completed visit will resolve the enquiry. The visit and its payment history will be retained.',
          cancel:'Keep enquiry',action:action==='cancelled'?'Client cancelled':'Confirm visit already attended',danger:action==='cancelled'});
        if(!confirmed)return;
        const fingerprint=JSON.stringify({action,payload});
        if(!state.receipt||state.receipt.fingerprint!==fingerprint)state.receipt={fingerprint,operationId:crypto.randomUUID()};
        payload.operationId=state.receipt.operationId;
        status.textContent='Saving enquiry outcome…';
        const csrf=await fetch('/calendar/staff-auth/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
        const token=await csrf.json();if(!csrf.ok||!token.csrfToken)throw new Error('Sign in to Workspace again.');
        const response=await fetch(path+'/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json','x-shiloh-csrf-token':token.csrfToken},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
        const data=await response.json();if(!response.ok){const e=new Error(data.error||'This enquiry could not be resolved.');e.code=data.code;throw e;}
        state.resolved=true;card.querySelectorAll('button,input,select').forEach(control=>control.disabled=true);
        status.textContent=action==='cancelled'?'Enquiry closed: client cancelled. Refreshing Dashboard…':'Enquiry resolved: visit already attended. Refreshing Dashboard…';
        card.querySelector('.status-pill').textContent=action==='cancelled'?'Client cancelled':'Already attended';
        setTimeout(()=>location.reload(),900);
      } catch(error) {
        status.dataset.tone='error';status.textContent=error.code?error.message:'We could not verify the result. Retry the same confirmation safely, or refresh Dashboard to check the current enquiry.';
      } finally {state.busy=false;sync();if(button.isConnected&&!button.disabled)button.focus();}
    });
  }
}

function planningRequestCompletionScript(){return confirmationClientScript()+`(${planningCompletionBrowser.toString()})();`;}

module.exports={planningRequestContact,planningRequestCompletion,planningRequestCompletionScript};
