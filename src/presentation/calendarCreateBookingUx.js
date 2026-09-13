const {
  SERVICE_FAMILIES,
  renderServiceFamilyIcon,
  serviceFamilyAccentCss,
  withServiceFamily,
} = require('./calendarServiceFamilyVisuals');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value || {}).replace(/</g, '\\u003c');
}

function styles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#6c7d75;--paper:#f7f5ef;--panel:#fffdf9;--line:#dfe5df;--leaf:#496b5a;--leaf-soft:#e7eee9;--warn:#795b20;--warn-soft:#fff5dc;--danger:#8a3f3f;--danger-soft:#f8eaea}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:980px;margin:0 auto;padding:22px 16px 40px}.topbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px}.topbar h1{font-size:1.45rem;margin:0}.topbar p{margin:4px 0 0;color:var(--muted)}a{color:var(--leaf);font-weight:700;text-decoration:none}.panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:0 4px 18px rgba(32,50,43,.04);margin-bottom:14px}.steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.field{display:grid;gap:6px}.field.wide{grid-column:1/-1}.field label{font-size:.82rem;font-weight:750}.field input,.field select{width:100%;min-height:44px;border:1px solid var(--line);border-radius:11px;padding:10px 11px;background:#fff;color:var(--ink);font:inherit}.selected-start{grid-column:1/-1;display:flex;align-items:center;min-height:44px;border:1px solid var(--line);border-radius:11px;padding:10px 12px;background:#fff;color:var(--muted);font-weight:700}.selected-start.ready{background:var(--leaf-soft);color:var(--leaf)}.selected-start.error{background:var(--danger-soft);color:var(--danger)}.actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:14px}.button{min-height:44px;border:1px solid var(--leaf);border-radius:999px;padding:9px 14px;background:var(--leaf);color:#fff;font:inherit;font-weight:750;cursor:pointer}.button.secondary{background:#fff;color:var(--leaf)}.button:disabled{opacity:.5;cursor:not-allowed}.status{white-space:pre-line;scroll-margin-block:20px;margin-top:12px;border:1px solid var(--line);border-radius:11px;padding:10px 12px;color:var(--muted);background:#fff}.status.ready{background:var(--leaf-soft);color:var(--leaf)}.status.warn{background:var(--warn-soft);color:var(--warn)}.status.error{background:var(--danger-soft);color:var(--danger)}.client-results{display:grid;gap:7px;margin-top:10px}.client-result{min-height:44px;display:flex;justify-content:space-between;gap:10px;align-items:center;text-align:left;border:1px solid var(--line);border-radius:11px;padding:10px;background:#fff;color:var(--ink);font:inherit;cursor:pointer}.client-result:hover{border-color:var(--leaf)}.client-result small{display:block;color:var(--muted);margin-top:2px}.selected{padding:10px 12px;border-radius:11px;background:var(--leaf-soft);margin-top:10px}.new-client-card{margin-top:12px;padding:14px;border:1px solid var(--line);border-radius:14px;background:#fff}.new-client-card h3{margin:0 0 5px;font-size:1rem}.new-client-card p{margin:0;color:var(--muted);line-height:1.45}.new-client-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.hint{font-size:.78rem;color:var(--muted);line-height:1.45}.selected-treatment,.service-value{display:inline-flex;align-items:center;gap:7px;min-width:0}.selected-treatment{min-height:30px;color:var(--muted);font-size:.8rem}.selected-treatment strong{color:var(--ink)}.service-family-icon{width:18px;height:18px;flex:0 0 18px;color:var(--leaf)}.review{display:grid;gap:7px;margin-top:10px}.review-row{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding:7px 0}.review-row:last-child{border-bottom:0}.review-row>span:first-child{color:var(--muted)}.guard-note{font-size:.8rem;color:var(--muted);line-height:1.5;margin:12px 0 0}@media(max-width:650px){.steps,.new-client-grid{grid-template-columns:1fr}.field.wide,.selected-start{grid-column:auto}.topbar{align-items:flex-start;flex-direction:column}.review-row{align-items:flex-start;flex-direction:column;gap:3px}}`;
}

function renderCalendarCreateBookingPage({ options = { staff: [], services: [] }, date = '', prefill = {}, clientScriptPath = '/calendar/book/client.js' } = {}) {
  const resolvedDate = prefill.date || date || '';
  const resolvedTime = prefill.time || '';
  const normalizedStaffId = prefill.staffId == null ? null : Number(prefill.staffId);
  const resolvedStaffId = Number.isSafeInteger(normalizedStaffId) && normalizedStaffId > 0 ? normalizedStaffId : null;
  const backParams = new URLSearchParams({ view: 'day' });
  if (resolvedDate) backParams.set('date', resolvedDate);
  if (resolvedStaffId) backParams.set('staff', String(resolvedStaffId));
  const backHref = `/calendar/read-only?${backParams.toString()}`;
  const visualOptions = {
    ...options,
    prefill: {
      date: resolvedDate,
      time: resolvedTime,
      staffId: resolvedStaffId,
    },
    services: (options.services || []).map(withServiceFamily),
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create Shiloh booking</title><style>${serviceFamilyAccentCss()}${styles()}</style><script src="${escapeHtml(clientScriptPath)}" defer></script></head><body data-calendar-create-booking="true"><div class="shell">
    <header class="topbar"><div><h1>Create booking</h1><p>Choose the client, treatment, practitioner and time.</p></div><div class="actions"><a data-back-calendar href="${escapeHtml(backHref)}">← Back to Calendar</a></div></header>
    <main>
      <section class="panel"><div class="steps">
        <div class="field"><label for="booking-date">Date</label><input id="booking-date" type="date" value="${escapeHtml(resolvedDate)}" required></div>
        <div class="field"><label for="booking-time">Start time</label><input id="booking-time" type="time" step="300"${resolvedTime ? ` value="${escapeHtml(resolvedTime)}"` : ''} required></div>
        <output class="selected-start" data-selected-start for="booking-date booking-time" role="status" aria-live="polite" aria-atomic="true">Choose date and start time.</output>
        <div class="field wide"><label for="client-search">Find client</label><div class="actions"><input id="client-search" type="search" autocomplete="off" placeholder="Name or mobile number"><button class="button secondary" type="button" data-client-search>Find client</button></div><div class="client-results" data-client-results></div><div class="selected" data-selected-client hidden></div>
          <div class="new-client-card" data-new-client-panel hidden><h3>New client</h3><p>Enter the client’s name and South African mobile number.</p><div class="new-client-grid"><div class="field"><label for="new-client-name">First name and surname</label><input id="new-client-name" type="text" maxlength="120" autocomplete="name" placeholder="Jane Doe"></div><div class="field"><label for="new-client-mobile">Mobile number</label><input id="new-client-mobile" type="tel" maxlength="40" autocomplete="tel" inputmode="tel" placeholder="082 123 4567"></div></div><div class="actions"><button class="button secondary" type="button" data-select-new-client>Use new client details</button></div><div class="hint">Shiloh will safely use an existing client when this exact mobile is already registered.</div></div>
        </div>
        <div class="field"><label for="service-select">Treatment</label><select id="service-select"><option value="">Choose treatment</option></select><div class="selected-treatment" data-selected-treatment hidden><span data-selected-treatment-icon></span><strong data-selected-treatment-name></strong></div></div>
        <div class="field"><label for="staff-select">Eligible practitioner</label><select id="staff-select" disabled><option value="">Choose treatment first</option></select></div>
      </div>
      <div class="actions"><button class="button" type="button" data-review-booking disabled>Review booking</button></div>
      <div class="status" role="status" aria-live="polite" data-booking-status>Choose Find client or New client, then date/time, treatment and practitioner.</div>
      <p class="guard-note">Search helps you find the right client. Shiloh rechecks the selected client, current mobile, treatment eligibility and availability before booking.</p>
      </section>
      <section class="panel" data-review-panel hidden><h2>Review booking</h2><div class="review" data-review></div>
        <p class="guard-note">Verify the exact client and mobile above. Shiloh checks the current client and mobile again immediately before creation and blocks the booking if either changed.</p>
        <div class="actions"><button class="button" type="button" data-create-booking disabled>Create booking</button><button class="button secondary" type="button" data-discard-booking disabled>Edit / discard review</button></div><p class="guard-note">Final creation rechecks clinic hours, practitioner schedule, blocks and appointment conflicts transactionally. Initial confirmation is queued durably before commit.</p></section>
    </main>
    <script type="application/json" id="calendar-booking-options">${safeJson(visualOptions)}</script>
  </div></body></html>`;
}

function calendarCreateBookingClientScript() {
  const familyIcons = Object.fromEntries(
    Object.keys(SERVICE_FAMILIES).map((key) => [key, renderServiceFamilyIcon(key)])
  );
  return `(function(){
'use strict';
var API='/calendar/book';
var AUTH='/calendar/staff-auth';
var FAMILY_ICONS=${safeJson(familyIcons)};
var options={staff:[],services:[],prefill:{}};
try{options=JSON.parse((document.getElementById('calendar-booking-options')||{}).textContent||'{}');}catch(_error){}
var selectedClient=null;
var newClientDraft=null;
var prepared=false;
var START_INCREMENT_MINUTES=5;
var MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var WEEKDAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function el(selector){return document.querySelector(selector);}
function setStatus(message,tone){var node=el('[data-booking-status]');if(!node)return;node.textContent=message;node.classList.toggle('error',tone==='error'||tone===true);node.classList.toggle('ready',tone==='ready');node.classList.toggle('warn',tone==='warn');if(tone==='error'||tone===true||tone==='warn'){node.setAttribute('tabindex','-1');node.focus({preventScroll:true});node.scrollIntoView({block:'nearest'});}}
function json(response){return response.json().catch(function(){return {};});}
function post(url,payload,csrfToken){var headers={'Content-Type':'application/json','Accept':'application/json'};if(csrfToken)headers['x-shiloh-csrf-token']=csrfToken;return fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers,body:JSON.stringify(payload||{})});}
async function csrf(){var response=await post(AUTH+'/csrf',{});if(!response.ok)throw new Error('SESSION');var body=await json(response);if(!body.csrfToken)throw new Error('SESSION');return body.csrfToken;}
function setFormLocked(locked){['#booking-date','#booking-time','#client-search','[data-client-search]','#new-client-name','#new-client-mobile','[data-select-new-client]','#service-select','[data-review-booking]','[data-client-mode-existing]','[data-client-mode-new]'].forEach(function(selector){var node=el(selector);if(node)node.disabled=!!locked;});var staff=el('#staff-select');if(staff)staff.disabled=!!locked||!Number(el('#service-select').value);}
function hideReview(){var panel=el('[data-review-panel]');if(panel)panel.hidden=true;var create=el('[data-create-booking]');if(create)create.disabled=true;var discard=el('[data-discard-booking]');if(discard)discard.disabled=true;}
function resetReview(){prepared=false;hideReview();}
function leapYear(year){return year%4===0&&(year%100!==0||year%400===0);}
function parseLocalDate(value){var match=String(value||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);if(!match)return null;var year=Number(match[1]);var month=Number(match[2]);var day=Number(match[3]);var days=[31,leapYear(year)?29:28,31,30,31,30,31,31,30,31,30,31];if(month<1||month>12||day<1||day>days[month-1])return null;return{year:year,month:month,day:day,value:match[0]};}
function parseLocalTime(value){var match=String(value||'').match(/^([01]\\d|2[0-3]):([0-5]\\d)$/);return match?{hour:Number(match[1]),minute:Number(match[2]),value:match[0]}:null;}
function weekdayIndex(date){var year=date.year;var offsets=[0,3,2,5,0,3,5,1,4,6,2,4];if(date.month<3)year-=1;return(year+Math.floor(year/4)-Math.floor(year/100)+Math.floor(year/400)+offsets[date.month-1]+date.day)%7;}
function startInputState(checkNative){var dateInput=el('#booking-date');var timeInput=el('#booking-time');var dateValue=String(dateInput.value||'');var timeValue=String(timeInput.value||'');if(!dateValue)return{ok:false,message:'Choose a date.'};var date=parseLocalDate(dateValue);if(!date||(checkNative&&typeof dateInput.checkValidity==='function'&&!dateInput.checkValidity()))return{ok:false,message:'Choose a valid date.'};if(!timeValue)return{ok:false,message:'Choose a start time.'};var time=parseLocalTime(timeValue);if(!time)return{ok:false,message:'Choose a valid start time.'};if(time.minute%START_INCREMENT_MINUTES!==0)return{ok:false,offStep:true,message:'Choose a start time in 5-minute increments, for example 09:00.'};if(checkNative&&typeof timeInput.checkValidity==='function'&&!timeInput.checkValidity())return{ok:false,message:timeInput.validity&&timeInput.validity.stepMismatch?'Choose a start time in 5-minute increments, for example 09:00.':'Choose a valid start time.'};return{ok:true,date:date.value,time:time.value,label:WEEKDAY_NAMES[weekdayIndex(date)]+' '+date.day+' '+MONTH_NAMES[date.month-1]+' • '+time.value};}
function updateSelectedStart(state){var node=el('[data-selected-start]');if(!node)return;var current=state||startInputState(false);node.textContent=current.ok?current.label:current.message;node.classList.toggle('ready',current.ok);node.classList.toggle('error',current.offStep===true);}
function formatDate(value){if(!value)return'';var date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);}
function serviceFamilyKey(service){return service&&service.serviceFamily&&service.serviceFamily.key||null;}
function serviceValue(text,familyKey){var value=document.createElement('strong');value.className='service-value';if(familyKey&&FAMILY_ICONS[familyKey])value.innerHTML=FAMILY_ICONS[familyKey];var name=document.createElement('span');name.textContent=text;value.appendChild(name);return value;}
function updateSelectedTreatment(service){var node=el('[data-selected-treatment]');if(!node)return;if(!service){node.hidden=true;el('[data-selected-treatment-icon]').textContent='';el('[data-selected-treatment-name]').textContent='';return;}var familyKey=serviceFamilyKey(service);var icon=el('[data-selected-treatment-icon]');icon.innerHTML=familyKey&&FAMILY_ICONS[familyKey]||'';el('[data-selected-treatment-name]').textContent=service.name;node.hidden=false;node.setAttribute('data-service-family',familyKey||'unmapped');}
function populateServices(){var select=el('#service-select');(options.services||[]).forEach(function(service){var option=document.createElement('option');option.value=String(service.id);option.textContent=service.name;select.appendChild(option);});}
function populateStaff(){var serviceId=Number(el('#service-select').value);var select=el('#staff-select');select.textContent='';var first=document.createElement('option');first.value='';first.textContent=serviceId?'Choose practitioner':'Choose treatment first';select.appendChild(first);var service=(options.services||[]).find(function(item){return Number(item.id)===serviceId;});updateSelectedTreatment(service);if(!service){select.disabled=true;resetReview();return;}var permitted=new Set((service.staffIds||[]).map(Number));(options.staff||[]).filter(function(item){return permitted.has(Number(item.id));}).forEach(function(person){var option=document.createElement('option');option.value=String(person.id);option.textContent=person.displayName;select.appendChild(option);});var prefillStaffId=Number(options.prefill&&options.prefill.staffId);if(prefillStaffId&&permitted.has(prefillStaffId)&&select.querySelector('option[value="'+String(prefillStaffId)+'"]'))select.value=String(prefillStaffId);select.disabled=false;resetReview();}
function showSelected(text,mode){var node=el('[data-selected-client]');node.hidden=false;node.textContent=text;node.setAttribute('data-client-selection',mode||'existing');}
function clearSelected(){var node=el('[data-selected-client]');node.hidden=true;node.textContent='';node.removeAttribute('data-client-selection');}
function selectClient(client){selectedClient=client;newClientDraft=null;showSelected(client.displayName+(client.contactHint?' — '+client.contactHint:''),'existing');el('[data-review-booking]').disabled=false;resetReview();}
function selectNewClientDraft(){var name=String(el('#new-client-name').value||'').trim().replace(/\\s+/g,' ');var mobile=String(el('#new-client-mobile').value||'').trim();if(name.length<2){setStatus('Enter a valid client name.','error');return;}if(!mobile){setStatus('Enter the client’s South African mobile number.','error');return;}selectedClient=null;newClientDraft={name:name,mobile:mobile};showSelected('New client — '+name+' — mobile supplied','new');el('[data-review-booking]').disabled=false;resetReview();setStatus('New client details selected. Review will safely create or find the client by exact mobile.');}
async function searchClients(){var query=String(el('#client-search').value||'').trim();if(query.length<2){setStatus('Enter at least two characters of a client name or number.','error');return;}resetReview();setStatus('Finding clients…');var response=await post(API+'/client-search',{query:query});var body=await json(response);var results=el('[data-client-results]');results.textContent='';if(!response.ok){setStatus(body.error||'Client search is unavailable.','error');return;}if(!body.clients||!body.clients.length){selectedClient=null;clearSelected();el('[data-review-booking]').disabled=true;setStatus('No client matched. Choose New client if this person is not yet registered.','warn');return;}body.clients.forEach(function(client){var button=document.createElement('button');button.type='button';button.className='client-result';var main=document.createElement('span');main.textContent=client.displayName;var small=document.createElement('small');small.textContent=[client.profileStatus,client.contactHint].filter(Boolean).join(' • ');main.appendChild(small);var choose=document.createElement('strong');choose.textContent='Select';button.appendChild(main);button.appendChild(choose);button.addEventListener('click',function(){selectClient(client);setStatus('Client explicitly selected.');});results.appendChild(button);});setStatus(body.ambiguous?'Multiple clients matched. Explicitly select one; Shiloh will not choose automatically.':'Explicitly select the client to continue.');}
function reviewRows(review){var service=(options.services||[]).find(function(item){return Number(item.id)===Number(review.service.id);})||review.service;var rows=[['Client',review.client.displayName],['Mobile',review.client.mobile||'unavailable'],['Treatment',review.service.name,serviceFamilyKey(service)],['Practitioner',review.practitioner.displayName],['Date / start',formatDate(review.startsAt)],['Duration',review.durationMinutes+' minutes'],['Price',review.price]];if(review.client.created)rows.splice(1,0,['Client record','New client created']);else if(review.client.matchedExisting)rows.splice(1,0,['Client record','Existing client found by exact mobile']);return rows;}
async function prepare(){resetReview();if(!selectedClient&&!newClientDraft){setStatus('Choose Find client or New client and complete that selection first.','error');return;}var start=startInputState(true);updateSelectedStart(start);if(!start.ok){setStatus(start.message,'error');return;}var date=start.date;var time=start.time;var serviceId=Number(el('#service-select').value);var staffId=Number(el('#staff-select').value);if(!serviceId||!staffId){setStatus('Choose treatment and eligible practitioner.','error');return;}var payload={serviceId:serviceId,staffId:staffId,date:date,time:time};if(selectedClient&&selectedClient.id)payload.clientId=selectedClient.id;else payload.newClient={name:newClientDraft.name,mobile:newClientDraft.mobile};setStatus('Rechecking the client, treatment, practitioner and availability…');try{var token=await csrf();var response=await post(API+'/prepare',payload,token);token='';var body=await json(response);if(!response.ok||body.status!=='pending_confirmation'){setStatus(body.error||body.reply||'That booking cannot be prepared.','error');return;}var review=el('[data-review]');review.textContent='';reviewRows(body.review).forEach(function(row){var line=document.createElement('div');line.className='review-row';var label=document.createElement('span');label.textContent=row[0];var value=row[2]?serviceValue(row[1],row[2]):document.createElement('strong');if(!row[2])value.textContent=row[1];line.appendChild(label);line.appendChild(value);review.appendChild(line);});selectedClient=body.review.client;newClientDraft=null;showSelected(body.review.client.displayName+' — '+body.review.client.contactHint,'existing');el('[data-review-panel]').hidden=false;el('[data-discard-booking]').disabled=false;el('[data-create-booking]').disabled=false;prepared=true;setFormLocked(true);setStatus('Review prepared. Verify the exact client and mobile, then create the booking.','ready');}catch(_error){setStatus('Your secure session could not prepare this booking. Reopen Calendar from Shiloh Admin if needed.','error');}}
function calendarHistoryReturnAvailable(){try{var ref=new URL(document.referrer);return ref.origin===location.origin&&(ref.pathname==='/calendar/workspace'||ref.pathname==='/calendar/read-only');}catch(_error){return false;}}
async function discardPrepared(navigateTo){if(!prepared){if(navigateTo==='history'){history.back();return;}if(navigateTo)window.location.assign(navigateTo);return;}setStatus('Discarding pending booking review…');try{var token=await csrf();var response=await post(API+'/discard',{},token);token='';var body=await json(response);if(!response.ok){setStatus(body.error||'Shiloh could not safely discard the pending review.','error');return;}prepared=false;hideReview();setFormLocked(false);el('[data-review-booking]').disabled=!selectedClient&&!newClientDraft;if(navigateTo){if(navigateTo==='history'){history.back();return;}window.location.assign(navigateTo);return;}setStatus('Pending booking review discarded. No appointment was created and the client record remains unchanged.');}catch(_error){setStatus('Shiloh could not safely discard the pending review. Keep this page open and retry.','error');}}
async function confirm(){if(!prepared)return;var button=el('[data-create-booking]');button.disabled=true;el('[data-discard-booking]').disabled=true;setStatus('Final client/mobile, authority, availability and conflict check in progress…');try{var token=await csrf();var response=await post(API+'/confirm',{},token);token='';var body=await json(response);if(!response.ok||body.status!=='created'){prepared=false;hideReview();setFormLocked(false);el('[data-review-booking]').disabled=!selectedClient&&!newClientDraft;setStatus(body.error||body.reply||'The booking changed before creation. Nothing was created; prepare it again.','warn');return;}prepared=false;hideReview();setFormLocked(true);var delivery=body.customerConfirmation||{};if(delivery.status!=='sent'){if(delivery.status==='delivery_status_uncertain'){setStatus('BOOKED — CLIENT CONFIRMATION DELIVERY STATUS UNCERTAIN. Verify with the client before resending. Appointment #'+String(body.appointmentId||'')+'.','error');return;}var retry=delivery.status==='retry_pending'?'Automatic retry is queued. ':'';setStatus('BOOKED — CLIENT CONFIRMATION NOT SENT. '+retry+'Confirm this booking manually with the client now. Appointment #'+String(body.appointmentId||'')+'.','error');return;}var params=new URLSearchParams({view:'day',date:el('#booking-date').value});var returnStaffId=Number(options.prefill&&options.prefill.staffId);if(returnStaffId&&(options.staff||[]).some(function(person){return Number(person.id)===returnStaffId;}))params.set('staff',String(returnStaffId));setStatus('Booking created and client confirmation sent. Refreshing Calendar…','ready');window.location.assign('/calendar/read-only?'+params.toString());}catch(_error){el('[data-discard-booking]').disabled=false;button.disabled=false;setStatus('Shiloh could not complete the booking. Refresh Calendar before retrying.','error');}}
populateServices();
updateSelectedStart();
el('#service-select').addEventListener('change',populateStaff);
el('#staff-select').addEventListener('change',resetReview);
function handleStartInput(){resetReview();updateSelectedStart();}
el('#booking-date').addEventListener('input',handleStartInput);
el('#booking-date').addEventListener('change',handleStartInput);
el('#booking-time').addEventListener('input',handleStartInput);
el('#booking-time').addEventListener('change',handleStartInput);
el('[data-client-search]').addEventListener('click',searchClients);
el('#client-search').addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();searchClients();}});
el('[data-select-new-client]').addEventListener('click',selectNewClientDraft);
el('[data-review-booking]').addEventListener('click',prepare);
el('[data-discard-booking]').addEventListener('click',function(){discardPrepared(null);});
el('[data-create-booking]').addEventListener('click',confirm);
window.addEventListener('calendar-client-mode',function(event){var mode=event.detail&&event.detail.mode;selectedClient=null;newClientDraft=null;clearSelected();resetReview();el('[data-review-booking]').disabled=true;setStatus(mode==='new'?'Enter the new client’s name and mobile, then select Use new client details.':'Find a client and explicitly select one result.');});
var back=el('[data-back-calendar]');if(back)back.addEventListener('click',function(event){var useHistory=calendarHistoryReturnAvailable();if(!prepared){if(useHistory){event.preventDefault();history.back();}return;}event.preventDefault();discardPrepared(useHistory?'history':back.href);});
})();`;
}

module.exports = {
  escapeHtml,
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
};
