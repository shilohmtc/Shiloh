(() => {
  'use strict';
  const root = document.querySelector('[data-my-shiloh-couples]');
  if (!root) return;
  const get = selector => root.querySelector(selector);
  const state = { guest:null,serviceIds:[null,null],staffIds:[null,null],slot:null,quote:null,requestId:null,busy:false,generations:[0,0] };
  const submit = get('[data-couples-submit]');
  const rand = value => 'R' + Number(value).toFixed(2);
  function status(selector, message = '', error = false) { const node = get(selector); node.textContent = message; node.dataset.state = error ? 'error' : ''; }
  function step(number) {
    root.querySelectorAll('[data-couples-step]').forEach(node => {
      node.hidden = Number(node.dataset.couplesStep) !== number;
      if (!node.hidden) { node.scrollIntoView({ block:'start' }); const heading = node.querySelector('h2'); heading.tabIndex = -1; heading.focus({ preventScroll:true }); }
    });
  }
  function invalidate() { state.quote = null; state.requestId = null; get('[data-couples-policy]').checked = false; submit.disabled = true; }
  function busy(value) {
    state.busy = value;
    root.querySelectorAll('button').forEach(button => { button.disabled = value; });
    submit.disabled = value || !state.quote;
  }
  async function request(action, body, { reviewOnly = true } = {}) {
    const controller = new AbortController();
    const timeout = reviewOnly ? setTimeout(() => controller.abort(),20000) : null;
    try {
      const response = await fetch('/my-shiloh/api/booking/couples/' + action, {
        method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{ Accept:'application/json','Content-Type':'application/json','x-shiloh-csrf-token':root.dataset.csrf },body:JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.error || 'Please review your booking again.'); error.code = data.code; throw error; }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The check took too long. Please try again.');
      throw error;
    } finally { if (timeout) clearTimeout(timeout); }
  }
  const treatments = () => state.serviceIds.map((serviceId,index) => ({ serviceId,staffId:state.staffIds[index],startsAt:state.slot.startsAt }));
  function renderItems() {
    const host = get('[data-couples-review-items]'); host.replaceChildren();
    [0,1].forEach(index => {
      const row = document.createElement('div'); row.className = 'cart-item';
      const heading = document.createElement('strong'); heading.textContent = index ? state.guest.name : 'You';
      const treatment = document.createElement('small'); treatment.textContent = get(`[data-couples-service="${index}"]`).selectedOptions[0].textContent;
      const therapist = document.createElement('small'); therapist.textContent = get(`[data-couples-staff="${index}"]`).selectedOptions[0].textContent;
      const time = document.createElement('small');
      time.textContent = new Intl.DateTimeFormat('en-ZA',{ timeZone:'Africa/Johannesburg',weekday:'short',day:'numeric',month:'short',year:'numeric' }).format(new Date(state.slot.startsAt)) + ' · ' + state.slot.time + '–' + (index ? state.slot.guestEndTime : state.slot.endTime);
      row.append(heading,treatment,therapist,time); host.append(row);
    });
  }
  async function review() {
    invalidate(); step(4); renderItems(); get('[data-couples-retry]').hidden = true;
    get('[data-couples-total]').textContent = get('[data-couples-deposit]').textContent = 'Checking…';
    status('[data-couples-review-status]','Checking both appointments and your combined total…'); busy(true);
    try {
      state.quote = await request('review',{ guest:state.guest,treatments:treatments() });
      get('[data-couples-total]').textContent = rand(state.quote.total); get('[data-couples-deposit]').textContent = rand(state.quote.deposit);
      status('[data-couples-review-status]');
    } catch (error) {
      get('[data-couples-total]').textContent = get('[data-couples-deposit]').textContent = 'Not available yet';
      status('[data-couples-review-status]',error.message,true); get('[data-couples-retry]').hidden = false;
    } finally { busy(false); }
  }
  get('[data-couples-guest-form]').addEventListener('submit',event => {
    event.preventDefault(); const form = event.currentTarget;
    state.guest = { name:form.elements.name.value.trim(),mobile:form.elements.mobile.value.trim(),consent:form.elements.consent.checked };
    invalidate(); step(2);
  });
  root.querySelectorAll('[data-couples-service]').forEach(select => select.addEventListener('change',async () => {
    const index = Number(select.dataset.couplesService), generation = ++state.generations[index];
    state.serviceIds[index] = Number(select.value) || null; state.staffIds[index] = null; state.slot = null; invalidate(); status('[data-couples-selection-status]');
    const staff = get(`[data-couples-staff="${index}"]`); staff.replaceChildren(new Option('Choose a therapist','')); staff.disabled = true;
    const selector = `[data-couples-practitioner-status="${index}"]`; status(selector,'');
    if (!state.serviceIds[index]) return;
    status(selector,'Checking therapists…');
    try {
      const response = await fetch('/my-shiloh/api/booking/practitioners?serviceId=' + state.serviceIds[index],{ credentials:'same-origin',cache:'no-store' });
      const data = await response.json(); if (generation !== state.generations[index]) return;
      if (!response.ok) throw new Error(data.error || 'Please choose another treatment.');
      data.practitioners.forEach(person => staff.append(new Option(person.name,String(person.id)))); staff.disabled = false; status(selector,'');
    } catch (error) { if (generation === state.generations[index]) status(selector,error.message,true); }
  }));
  root.querySelectorAll('[data-couples-staff]').forEach(select => select.addEventListener('change',() => { state.staffIds[Number(select.dataset.couplesStaff)] = Number(select.value) || null; state.slot = null; invalidate(); status('[data-couples-selection-status]'); }));
  get('[data-couples-next]').addEventListener('click',() => {
    if (state.serviceIds.some(value => !value) || state.staffIds.some(value => !value)) { status('[data-couples-selection-status]','Choose a treatment and therapist for each person.',true); return; }
    if (state.staffIds[0] === state.staffIds[1]) { status('[data-couples-selection-status]','Choose two different therapists so both treatments can start together.',true); return; }
    status('[data-couples-selection-status]'); get('[data-couples-slots]').replaceChildren(); status('[data-couples-slot-status]'); step(3);
  });
  get('[data-couples-find]').addEventListener('click',async () => {
    if (state.busy) return;
    const date = get('[data-couples-date]').value;
    if (!date) { status('[data-couples-slot-status]','Choose a date first.',true); return; }
    const host = get('[data-couples-slots]'); host.replaceChildren(); invalidate(); busy(true); status('[data-couples-slot-status]','Checking when both therapists are available…');
    try {
      const data = await request('availability',{ serviceIds:state.serviceIds,staffIds:state.staffIds,date });
      status('[data-couples-slot-status]',data.slots.length ? 'Choose a shared start time.' : 'No shared times are available. Try another date or therapist.');
      data.slots.forEach(slot => { const button = document.createElement('button'); button.type = 'button'; button.className = 'slot'; button.textContent = slot.time + ' · Both therapists available'; button.addEventListener('click',() => { if (!state.busy) { state.slot = slot; review(); } }); host.append(button); });
    } catch (error) { status('[data-couples-slot-status]',error.message,true); }
    finally { busy(false); }
  });
  root.querySelectorAll('[data-couples-back]').forEach(button => button.addEventListener('click',() => { if (!state.busy) { invalidate(); step(Number(button.dataset.couplesBack)); } }));
  get('[data-couples-retry]').addEventListener('click',() => { if (!state.busy) review(); });
  root.querySelectorAll('[name="couples-occasion"]').forEach(input => input.addEventListener('change',() => { get('[data-couples-occasion]').disabled = input.value !== 'yes'; get('[data-couples-occasion-details]').hidden = input.value !== 'yes'; state.requestId = null; }));
  get('[data-couples-occasion]').addEventListener('input',() => { state.requestId = null; });
  submit.addEventListener('click',async () => {
    if (state.busy || !state.quote) return;
    const occasion = get('[name="couples-occasion"]:checked')?.value;
    if (!occasion || (occasion === 'yes' && !get('[data-couples-occasion]').value.trim())) { status('[data-couples-confirm-status]','Please answer the occasion question and add the details if needed.',true); return; }
    if (!get('[data-couples-policy]').checked) { status('[data-couples-confirm-status]','Please accept Shiloh’s Booking Policy & Terms first.',true); return; }
    state.requestId ||= crypto.randomUUID(); busy(true); status('[data-couples-confirm-status]','Sending your booking for two…');
    try {
      const data = await request('confirm',{ guest:state.guest,treatments:treatments(),quoteHash:state.quote.quoteHash,requestId:state.requestId,policyAccepted:true,specialOccasion:occasion === 'yes',occasionNote:occasion === 'yes' ? get('[data-couples-occasion]').value.trim() : '' },{ reviewOnly:false });
      get('[data-couples-success]').textContent = data.message; step(5);
    } catch (error) {
      if (error.code === 'BOOKING_CART_QUOTE_CHANGED') { busy(false); await review(); status('[data-couples-confirm-status]',error.message,true); return; }
      status('[data-couples-confirm-status]',error.code ? error.message : 'We could not verify the response. Check your bookings, or retry this same request safely.',true); busy(false);
    }
  });
})();
