const { escapeHtml } = require('./workspaceShell');
const { BOOKING_POLICY_TEXT:POLICY_TEXT } = require('../config/bookingPolicyAuthority');
const { webPolicyHtml } = require('./paymentPolicyUx');

function couplesEnquiryItem(item) {
  const preferred = item.preferred_date ? String(item.preferred_date).slice(0,10) : 'Date flexible';
  return `<article class="booking-request" data-dashboard-planning-request="${escapeHtml(item.id)}" data-couples-enquiry>
    <div class="appointment-main"><span class="appointment-time">Request</span><div class="appointment-copy"><strong>${escapeHtml(item.client_name)}</strong><span>Couples Massage · Booking for two</span></div><span class="status-pill pending">Needs booking details</span></div>
    <p class="request-note">${escapeHtml(preferred)} · ${escapeHtml(item.preferred_daypart && item.preferred_daypart!=='any' ? item.preferred_daypart : 'Time flexible')}${item.practitioner_name ? ` · Prefers ${escapeHtml(item.practitioner_name)}` : ''}</p>
    ${item.special_occasion ? `<p class="request-note"><strong>Occasion:</strong> ${escapeHtml(item.occasion_note)}</p>` : ''}${item.client_note ? `<p class="request-note"><strong>Client note:</strong> ${escapeHtml(item.client_note)}</p>` : ''}
    <p class="request-note">This is an enquiry. Agree the missing details with the client, then arrange both appointments here.</p>
    <details data-couples-enquiry-details><summary class="button">Set appointment details</summary>
      <form data-couples-enquiry-form class="couples-enquiry-form" hidden>
        <fieldset><legend>Who is joining ${escapeHtml(item.client_name)}?</legend>
          <label>Guest’s first name and surname<input name="guestName" autocomplete="off" maxlength="120" required></label>
          <label>Guest’s mobile number<input name="guestMobile" type="tel" inputmode="tel" autocomplete="off" maxlength="20" required></label>
          <label class="couples-agreement"><input name="guestConsent" type="checkbox" required><span>The guest agrees to this booking and sharing these details with Shiloh.</span></label>
        </fieldset>
        <div class="proposal-fields"><label class="proposal-field"><span>${escapeHtml(item.client_name)}’s practitioner</span><select name="firstStaff" required></select></label>
          <label class="proposal-field"><span>Guest’s practitioner</span><select name="secondStaff" required></select></label>
          <label class="proposal-field"><span>Appointment date</span><input name="date" type="date" required></label>
          <button class="action-button" type="button" data-couples-enquiry-action="availability">Show shared times</button>
          <label class="proposal-field"><span>Shared appointment time</span><select name="slot" required disabled><option value="">Choose practitioners and check times</option></select></label>
        </div>
        <button class="action-button" type="submit">Review both appointments</button>
        <div data-couples-enquiry-review hidden><p class="request-note" data-couples-enquiry-summary></p>
          <details><summary>Booking Policy &amp; Terms</summary>${webPolicyHtml(POLICY_TEXT)}</details>
          <label class="couples-agreement"><input name="clientAgreed" type="checkbox"><span>The client has agreed to these exact details, the price and Shiloh’s Booking Policy &amp; Terms.</span></label>
          <button class="action-button complete" type="button" data-couples-enquiry-action="confirm" disabled>Confirm booking for both</button>
        </div>
      </form>
    </details><p class="operation-status request-operation-status" data-couples-enquiry-status role="status" aria-live="polite"></p>
  </article>`;
}

function couplesEnquiryClientScript() {
  return `(${couplesEnquiryBrowser.toString()})();`;
}

function couplesEnquiryBrowser() {
  'use strict';
  for (const card of document.querySelectorAll('[data-couples-enquiry]')) {
    const details=card.querySelector('[data-couples-enquiry-details]'),form=card.querySelector('form');
    const status=card.querySelector('[data-couples-enquiry-status]'),review=card.querySelector('[data-couples-enquiry-review]');
    const confirm=card.querySelector('[data-couples-enquiry-action="confirm"]');
    const state={busy:false,options:null,quote:null,requestId:null,slots:[]};
    const path='/calendar/workspace/planning-requests/'+encodeURIComponent(card.dataset.dashboardPlanningRequest)+'/couples';
    const fields=form.elements;
    function message(text,error=false) { status.textContent=text;status.dataset.tone=error?'error':'ready'; }
    function sync() { confirm.disabled=state.busy||!state.quote||!fields.clientAgreed.checked;fields.slot.disabled=state.busy||!state.slots.length; }
    function invalidate(slots=false) {
      state.quote=null;state.requestId=null;fields.clientAgreed.checked=false;review.hidden=true;
      if(slots){state.slots=[];fields.slot.replaceChildren(new Option('Check shared times again',''));}
      sync();
    }
    async function request(action,payload) {
      const mutation=action!=='options',headers={Accept:'application/json'};
      if(mutation){const csrf=await fetch('/calendar/staff-auth/csrf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(!csrf.ok)throw new Error('Sign in to Workspace again.');const token=await csrf.json();if(!token.csrfToken)throw new Error('Sign in to Workspace again.');
        headers['x-shiloh-csrf-token']=token.csrfToken;headers['Content-Type']='application/json';}
      const response=await fetch(path+(mutation?'/'+action:''),{method:mutation?'POST':'GET',credentials:'same-origin',cache:'no-store',headers,
        ...(action==='confirm'?{}:{signal:AbortSignal.timeout(20000)}),...(mutation?{body:JSON.stringify(payload)}:{})});
      const data=await response.json();if(!response.ok){const error=new Error(data.error||'Please review both appointments.');error.code=data.code;throw error;}return data;
    }
    async function run(action) {
      if(state.busy)return;
      if(action==='review'&&!form.reportValidity())return;
      if(action==='availability'&&(!fields.firstStaff.value||!fields.secondStaff.value||!fields.date.value)){message('Choose two practitioners and a date.',true);return;}
      if(action==='confirm'&&(!state.quote||!fields.clientAgreed.checked))return;
      if(action!=='options'&&fields.firstStaff.value===fields.secondStaff.value){message('Choose two different practitioners.',true);return;}
      const payload={staffIds:[Number(fields.firstStaff.value),Number(fields.secondStaff.value)],
        startsAt:fields.slot.value,guest:{name:fields.guestName.value.trim(),mobile:fields.guestMobile.value.trim(),consent:fields.guestConsent.checked}};
      state.busy=true;const controls=[...form.querySelectorAll('button,input,select')];controls.forEach(control=>control.disabled=true);
      message(action==='confirm'?'Arranging both appointments…':'Checking both appointment details…');
      let completed=false;
      try {
        if(action==='options') {
          state.options=await request('options');
          for(const select of [fields.firstStaff,fields.secondStaff]){select.replaceChildren(new Option('Choose practitioner',''));state.options.practitioners.forEach(person=>select.append(new Option(person.name,String(person.id))));}
          fields.date.value=state.options.preferredDate||'';form.hidden=false;message('Add the guest and choose a shared time.');
        } else if(action==='availability') {
          invalidate(true);const data=await request(action,{staffIds:payload.staffIds,date:fields.date.value});state.slots=data.slots;
          fields.slot.replaceChildren(new Option(data.slots.length?'Choose shared time':'No shared times available',''));
          data.slots.forEach(slot=>fields.slot.append(new Option(slot.time+' · Both practitioners available',slot.startsAt)));
          message(data.slots.length?'Choose a shared time, then review.':'No shared times are available. Try another date or practitioner.');
        } else if(action==='review') {
          invalidate();state.quote=await request(action,payload);review.hidden=false;
          const date=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(payload.startsAt));
          card.querySelector('[data-couples-enquiry-summary]').textContent=state.options.clientName+' & '+payload.guest.name+' · '+date+' · '+state.quote.treatments.map(item=>item.practitioner).join(' & ')+' · Total for two R'+state.quote.total+' · Required deposit R'+state.quote.deposit;
          message('Check both appointments and confirm the client’s agreement.');
        } else {
          state.requestId ||= crypto.randomUUID();
          const data=await request(action,{...payload,quoteHash:state.quote.quoteHash,requestId:state.requestId,clientAgreed:true,revision:state.options.revision});
          message(data.message);completed=true;setTimeout(()=>window.location.reload(),700);
        }
      } catch(error) {
        message(error.code?error.message:'We could not verify the response. Retry the same request safely or refresh Dashboard to check whether it was arranged.',true);
        if(error.code==='BOOKING_CART_QUOTE_CHANGED')invalidate();
      } finally {if(!completed){state.busy=false;controls.forEach(control=>control.disabled=false);sync();}}
    }
    details.addEventListener('toggle',()=>{if(details.open&&!state.options)run('options');});
    form.addEventListener('submit',event=>{event.preventDefault();run('review');});
    form.addEventListener('input',event=>{if(event.target===fields.clientAgreed){sync();return;}invalidate(['firstStaff','secondStaff','date'].includes(event.target.name));});
    form.addEventListener('click',event=>{const button=event.target.closest('[data-couples-enquiry-action]');if(button)run(button.dataset.couplesEnquiryAction);});
  }
}

module.exports={couplesEnquiryItem,couplesEnquiryClientScript};
