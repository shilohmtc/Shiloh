(() => {
  'use strict';
  const root = document.querySelector('[data-my-shiloh-couples]');
  if (!root) return;
  const get = selector => root.querySelector(selector);
  const offerChoice = get('[data-use-morning-offer]');
  const pricingReviewAvailable = root.dataset.pricingReview === 'true';
  const offerPayload = () => pricingReviewAvailable ? {useMorningOffer:offerChoice?.checked!==false} : {};
  const state = { guest:null,guests:[],guestSignature:null,timing:'together',peopleGeneration:0,serviceIds:[null,null],staffIds:[null,null],slot:null,quote:null,requestId:null,busy:false,generations:[0,0] };
  const submit = get('[data-couples-submit]');
  const rand = value => 'R' + Number(value).toFixed(2);
  function status(selector, message = '', error = false) { const node = get(selector); node.textContent = message; node.dataset.state = error ? 'error' : ''; }
  function step(number) {
    root.querySelectorAll('[data-couples-step]').forEach(node => {
      node.hidden = Number(node.dataset.couplesStep) !== number;
      if (!node.hidden) { node.scrollIntoView({ block:'start' }); const heading = node.querySelector('h2'); heading.tabIndex = -1; heading.focus({ preventScroll:true }); }
    });
  }
  function invalidate() { const offer=get('[data-offer-price]');if(offer)offer.hidden=true;state.quote = null; state.requestId = null; get('[data-couples-policy]').checked = false; submit.disabled = true; }
  let busyControls = null;
  function busy(value) {
    state.busy = value;
    if (value && !busyControls) { busyControls = new Map([...root.querySelectorAll('button,input,select,textarea')].map(node=>[node,node.disabled])); busyControls.forEach((_,node)=>{ node.disabled=true; }); }
    if (!value && busyControls) { busyControls.forEach((disabled,node)=>{ node.disabled=disabled; }); busyControls=null; }
    submit.disabled = value || !state.quote;
  }
  async function request(action, body, { reviewOnly = true } = {}) {
    const controller = new AbortController();
    const timeout = reviewOnly ? setTimeout(() => controller.abort(),20000) : null;
    try {
      const response = await fetch('/my-shiloh/api/booking/couples/' + action, {
        method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{ Accept:'application/json','Content-Type':'application/json','x-shiloh-csrf-token':root.dataset.csrf,...(action === 'confirm' ? { 'x-shiloh-booking-attempt':state.requestId } : {}) },body:JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.error || 'Please review your booking again.'); error.code = data.code; error.supportReference = data.supportReference; error.incidentLinkSaved = data.incidentLinkSaved; throw error; }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The check took too long. Please try again.');
      throw error;
    } finally { if (timeout) clearTimeout(timeout); }
  }
  const guestPayload = () => state.guests.length === 1 ? { guest:state.guests[0] } : { guests:state.guests };
  const treatments = () => state.serviceIds.map((serviceId,index) => ({ serviceId,staffId:state.staffIds[index],startsAt:state.slot.appointmentStartsAt?.[index] || state.slot.startsAt }));
  function renderItems() {
    const host = get('[data-couples-review-items]'); host.replaceChildren();
    state.serviceIds.forEach((_,index) => {
      const row = document.createElement('div'); row.className = 'cart-item';
      const heading = document.createElement('strong'); heading.textContent = index ? state.guests[index-1].name : 'You';
      const treatment = document.createElement('small'); treatment.textContent = state.quote?.treatments?.[index] ? `${state.quote.treatments[index].service} · ${state.quote.treatments[index].durationMinutes} min · ${rand(state.quote.treatments[index].price)}` : get(`[data-couples-service="${index}"]`).selectedOptions[0].textContent;
      const therapist = document.createElement('small'); therapist.textContent = get(`[data-couples-staff="${index}"]`).selectedOptions[0].textContent;
      const time = document.createElement('small');
      time.textContent = new Intl.DateTimeFormat('en-ZA',{ timeZone:'Africa/Johannesburg',weekday:'short',day:'numeric',month:'short',year:'numeric' }).format(new Date(state.slot.appointmentStartsAt?.[index] || state.slot.startsAt)) + ' · ' + new Intl.DateTimeFormat('en-ZA',{ timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(state.slot.appointmentStartsAt?.[index] || state.slot.startsAt)) + '–' + (state.slot.endTimes?.[index] || (index ? state.slot.guestEndTime : state.slot.endTime));
      row.append(heading,treatment,therapist,time); host.append(row);
    });
  }
  async function review() {
    invalidate(); step(4); renderItems(); get('[data-couples-retry]').hidden = true;
    get('[data-couples-total]').textContent = get('[data-couples-deposit]').textContent = 'Checking…';
    status('[data-couples-review-status]','Checking everyone’s appointments and your combined total…'); busy(true);
    try {
      state.quote = await request('review',{ ...guestPayload(),...offerPayload(),treatments:treatments(),timing:state.timing });
      window.ShilohOfferPricing?.render(root,state.quote);
      renderItems();
      get('[data-couples-total]').textContent = rand(state.quote.total); get('[data-couples-deposit]').textContent = rand(state.quote.deposit);
      status('[data-couples-review-status]');
    } catch (error) {
      get('[data-couples-total]').textContent = get('[data-couples-deposit]').textContent = 'Not available yet';
      status('[data-couples-review-status]',error.message,true); get('[data-couples-retry]').hidden = false;
    } finally { busy(false); }
  }
  const personTemplate = get('[data-couples-person="0"]').cloneNode(true);
  function renumberGuests() {
    root.querySelectorAll('[data-couples-guest]').forEach((row,index) => {
      row.querySelector('legend').textContent = 'Guest ' + (index+1);
      const remove = row.querySelector('[data-family-remove]');
      if (remove) remove.textContent = 'Remove guest ' + (index+1);
      if (index) row.querySelectorAll('input:not([type]),input[type="text"],input[type="tel"]').forEach(input=>{
        input.closest('label').firstChild.textContent = 'Guest ' + (index+1) + (input.type === 'tel' ? ' mobile number' : ' first name and surname');
      });
    });
  }
  let guestCounter = 1;
  get('[data-couples-add-guest]').addEventListener('click',() => {
    const host = get('[data-couples-guests]');
    if (host.children.length >= 9) return;
    const number = ++guestCounter;
    const row = host.firstElementChild.cloneNode(true);
    row.dataset.couplesGuest = number;
    row.querySelector('legend').textContent = 'Guest ' + number;
    row.querySelectorAll('input').forEach(input => {
      const kind = input.type === 'checkbox' ? 'consent' : input.type === 'tel' ? 'mobile' : 'name';
      input.value = kind === 'consent' ? 'on' : ''; input.checked = false;
      input.name = 'guest-' + number + '-' + kind;
      input.id = 'family-guest-' + number + '-' + kind;
      if (kind !== 'consent') {
        input.closest('label').firstChild.textContent = kind === 'name' ? 'Guest ' + number + ' first name and surname' : 'Guest ' + number + ' mobile number';
        input.closest('label').htmlFor = input.id;
      }
    });
    row.querySelector('[data-family-remove]')?.remove();
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button--soft';
    remove.dataset.familyRemove = ''; remove.textContent = 'Remove guest ' + number;
    remove.addEventListener('click',() => { row.remove(); renumberGuests(); get('[data-couples-add-guest]').disabled = false; get('[data-couples-add-guest]').focus(); });
    row.append(remove); host.append(row); renumberGuests();
    get('[data-couples-add-guest]').disabled = host.children.length >= 9;
    row.querySelector('input').focus();
  });
  function bindService(select) {
    select.addEventListener('change',async () => {
      const index = Number(select.dataset.couplesService), peopleGeneration = state.peopleGeneration;
      const other = state.serviceIds.length === 2 ? get(`[data-couples-service="${1-index}"]`) : null;
      const named = select.selectedOptions[0]?.dataset.couplesNamed === 'true';
      if (named && other && other.value !== select.value) { other.value = select.value; other.dispatchEvent(new Event('change')); }
      else if (!named && other?.selectedOptions[0]?.dataset.couplesNamed === 'true') { other.value = ''; other.dispatchEvent(new Event('change')); }
      const generation = ++state.generations[index];
      state.serviceIds[index] = Number(select.value) || null; state.staffIds[index] = null; state.slot = null; invalidate(); status('[data-couples-selection-status]');
      const staff = get(`[data-couples-staff="${index}"]`); staff.replaceChildren(new Option('Choose a therapist','')); staff.disabled = true;
      const selector = `[data-couples-practitioner-status="${index}"]`; status(selector,'');
      if (!state.serviceIds[index]) return;
      status(selector,'Checking therapists…');
      try {
        const response = await fetch('/my-shiloh/api/booking/couples/practitioners?serviceId=' + state.serviceIds[index],{ credentials:'same-origin',cache:'no-store' });
        const data = await response.json(); if (peopleGeneration !== state.peopleGeneration || generation !== state.generations[index]) return;
        if (!response.ok) throw new Error(data.error || 'Please choose another treatment.');
        data.practitioners.forEach(person => staff.append(new Option(person.name,String(person.id)))); staff.disabled = false; status(selector,'');
      } catch (error) { if (peopleGeneration === state.peopleGeneration && generation === state.generations[index]) status(selector,error.message,true); }
    });
  }
  function bindStaff(select) { select.addEventListener('change',() => { state.staffIds[Number(select.dataset.couplesStaff)] = Number(select.value) || null; state.slot = null; invalidate(); status('[data-couples-selection-status]'); }); }
  function syncNamedTreatment() {
    const eligible = state.serviceIds.length === 2 && state.timing === 'together';
    root.querySelectorAll('[data-couples-service]').forEach(select => {
      const selectedNamed = select.selectedOptions[0]?.dataset.couplesNamed === 'true';
      select.querySelectorAll('[data-couples-named]').forEach(option => { option.disabled = !eligible; option.hidden = !eligible; });
      if (!eligible && selectedNamed) { select.value = ''; select.dispatchEvent(new Event('change')); }
    });
  }
  get('[data-couples-guest-form]').addEventListener('submit',event => {
    event.preventDefault();
    const guests = [...root.querySelectorAll('[data-couples-guest]')].map(row => ({ name:row.querySelector('input[type="text"],input:not([type])').value.trim(),mobile:row.querySelector('input[type="tel"]').value.trim(),consent:row.querySelector('input[type="checkbox"]').checked }));
    const mobiles = guests.map(person=>person.mobile.replace(/\D/g,'').replace(/^0/,'27'));
    if (new Set(mobiles).size !== mobiles.length) { status('[data-couples-guest-status]','Each guest needs their own mobile number.',true); return; }
    status('[data-couples-guest-status]');
    const signature = JSON.stringify(guests);
    if (signature !== state.guestSignature) {
      state.peopleGeneration++; state.guestSignature = signature; state.guests = guests; state.guest = guests[0];
      state.serviceIds = Array(guests.length+1).fill(null); state.staffIds = Array(guests.length+1).fill(null); state.generations = Array(guests.length+1).fill(0); state.slot = null;
      const host = get('[data-couples-people]'); host.replaceChildren();
      state.serviceIds.forEach((_,index) => {
        const card = personTemplate.cloneNode(true); card.dataset.couplesPerson = index;
        card.querySelector('legend').textContent = index ? guests[index-1].name : 'You';
        const service = card.querySelector('[data-couples-service]'), staff = card.querySelector('[data-couples-staff]'), message = card.querySelector('[data-couples-practitioner-status]');
        service.id = 'couples-service-' + index; service.dataset.couplesService = index; service.value = '';
        staff.id = 'couples-staff-' + index; staff.dataset.couplesStaff = index; staff.replaceChildren(new Option('Choose a treatment first','')); staff.disabled = true;
        message.dataset.couplesPractitionerStatus = index; message.textContent = '';
        card.querySelectorAll('label')[0].htmlFor = service.id; card.querySelectorAll('label')[1].htmlFor = staff.id;
        host.append(card); bindService(service); bindStaff(staff);
      });
      syncNamedTreatment();
      if (root.dataset.selectedService) { const selected = get('[data-couples-service="0"]'); selected.value = root.dataset.selectedService; if (selected.value && !selected.selectedOptions[0].disabled) selected.dispatchEvent(new Event('change')); else selected.value=''; }
    }
    invalidate(); step(2);
  });
  root.querySelectorAll('[data-couples-service]').forEach(bindService);
  root.querySelectorAll('[data-couples-staff]').forEach(bindStaff);
  root.querySelectorAll('[name="family-timing"]').forEach(input => input.addEventListener('change',() => {
    state.timing = input.value; state.slot = null; invalidate(); syncNamedTreatment();
    get('[data-family-timing-help]').textContent = state.timing === 'together' ? 'Everyone starts together. Each therapist is checked for the full duration of their treatment.' : 'Treatments follow the order above. We find an available time for each person after the previous treatment; there may be a wait between appointments. Review everyone’s exact times before sending.';
  }));
  if (root.dataset.selectedService) {
    const selected = get('[data-couples-service="0"]');
    selected.value = root.dataset.selectedService;
    if (selected.value) selected.dispatchEvent(new Event('change'));
  }
  get('[data-couples-next]').addEventListener('click',() => {
    if (state.serviceIds.some(value => !value) || state.staffIds.some(value => !value)) { status('[data-couples-selection-status]','Choose a treatment and therapist for each person.',true); return; }
    if (state.timing === 'together' && new Set(state.staffIds).size !== state.staffIds.length) { status('[data-couples-selection-status]','Choose a different therapist for each person to start together, or choose Take turns.',true); return; }
    status('[data-couples-selection-status]'); get('[data-couples-slots]').replaceChildren(); status('[data-couples-slot-status]'); step(3);
  });
  get('[data-couples-find]').addEventListener('click',async () => {
    if (state.busy) return;
    const date = get('[data-couples-date]').value;
    if (!date) { status('[data-couples-slot-status]','Choose a date first.',true); return; }
    const host = get('[data-couples-slots]'); host.replaceChildren(); invalidate(); busy(true); status('[data-couples-slot-status]','Checking available times for everyone…');
    try {
      const data = await request('availability',{ serviceIds:state.serviceIds,staffIds:state.staffIds,date,timing:state.timing });
      status('[data-couples-slot-status]',data.slots.length ? 'Choose a start time and review everyone’s appointments.' : 'No times are available for everyone. Try another date, therapist or timing choice.');
      data.slots.forEach(slot => { const button = document.createElement('button'); button.type = 'button'; button.className = 'slot'; button.textContent = slot.time + (state.timing === 'together' ? ' · Everyone starts together' : ' · Take turns'); button.addEventListener('click',() => { if (!state.busy) { state.slot = slot; review(); } }); host.append(button); });
    } catch (error) { status('[data-couples-slot-status]',error.message,true); }
    finally { busy(false); }
  });
  root.querySelectorAll('[data-couples-back]').forEach(button => button.addEventListener('click',() => { if (!state.busy) { invalidate(); step(Number(button.dataset.couplesBack)); } }));
  offerChoice?.addEventListener('change',()=>{invalidate();review();});
  get('[data-couples-retry]').addEventListener('click',() => { if (!state.busy) review(); });
  root.querySelectorAll('[name="couples-occasion"]').forEach(input => input.addEventListener('change',() => { get('[data-couples-occasion]').disabled = input.value !== 'yes'; get('[data-couples-occasion-details]').hidden = input.value !== 'yes'; state.requestId = null; }));
  get('[data-couples-occasion]').addEventListener('input',() => { state.requestId = null; });
  submit.addEventListener('click',async () => {
    if (state.busy || !state.quote) return;
    const occasion = get('[name="couples-occasion"]:checked')?.value;
    if (!occasion || (occasion === 'yes' && !get('[data-couples-occasion]').value.trim())) { status('[data-couples-confirm-status]','Please answer the occasion question and add the details if needed.',true); return; }
    if (!get('[data-couples-policy]').checked) { status('[data-couples-confirm-status]','Please accept Shiloh’s Booking Policy & Terms first.',true); return; }
    state.requestId ||= crypto.randomUUID(); busy(true); status('[data-couples-confirm-status]','Sending everyone’s booking request…');
    try {
      const data = await request('confirm',{ ...guestPayload(),...offerPayload(),timing:state.timing,treatments:treatments(),quoteHash:state.quote.quoteHash,requestId:state.requestId,policyAccepted:true,specialOccasion:occasion === 'yes',occasionNote:occasion === 'yes' ? get('[data-couples-occasion]').value.trim() : '' },{ reviewOnly:false });
      get('[data-couples-success]').textContent = data.message; step(5);
    } catch (error) {
      if (error.code === 'BOOKING_OFFER_QUOTE_CHANGED' || error.code === 'BOOKING_CART_QUOTE_CHANGED') { busy(false); await review(); status('[data-couples-confirm-status]',error.message,true); return; }
      const reference = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(error.supportReference || '') ? error.supportReference : null;
      const message = reference ? 'We could not complete your request. ' + (error.incidentLinkSaved === true
        ? 'We saved a support link in Shiloh. Quote this reference if you contact Reception. '
        : 'We could not save a client support link. Please contact Reception. ') + 'Support reference: ' + reference
        : error.code ? error.message : 'We could not verify the response. Check your bookings, or retry this same request safely.';
      status('[data-couples-confirm-status]',message,true); busy(false);
    }
  });
})();
