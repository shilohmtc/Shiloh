(() => {
  'use strict';
  const root = document.querySelector('[data-my-shiloh-booking]');
  if (!root) return;
  const get = selector => root.querySelector(selector);
  const steps = [...root.querySelectorAll('[data-step]')];
  const progress = [...root.querySelectorAll('[data-progress]')];
  const state = { service:null, practitioner:null, slot:null, cart:[], quote:null, editing:null, requestId:null, busy:false, generation:0 };
  const status = get('[data-booking-status]');
  const slotStatus = get('[data-slot-status]');
  const confirmStatus = get('[data-confirm-status]');
  const cartStatus = get('[data-cart-status]');
  const retryReview = get('[data-retry-review]');
  const practitionersHost = get('[data-practitioners]');
  const slotsHost = get('[data-slots]');
  const dateInput = get('[data-booking-date]');
  const policyAccepted = get('[data-policy-accepted]');
  const occasionNote = get('[data-occasion-note]');
  const occasionDetails = get('[data-occasion-details]');
  const submit = get('[data-submit-booking]');
  const prepaidPackage = root.dataset.prepaidPackage === 'true';
  const rate = prepaidPackage ? 0 : Number(root.dataset.depositRate || 50);
  const multiple = !prepaidPackage && root.dataset.multipleBookings === 'true';
  const rand = value => 'R' + Number(value).toFixed(2);
  const current = () => state.service && state.practitioner && state.slot
    ? { service:state.service, practitioner:state.practitioner, slot:state.slot } : null;
  function selected() {
    const list = [...state.cart];
    const item = current();
    if (item) {
      if (state.editing !== null) list[state.editing] = item;
      else list.push(item);
    }
    return list;
  }
  const payload = list => list.map(item => ({ serviceId:item.service.id, staffId:item.practitioner.id, startsAt:item.slot.startsAt }));
  function clearCurrent() { state.service = state.practitioner = state.slot = null; state.editing = null; }
  function invalidate() { state.quote = null; state.requestId = null; policyAccepted.checked = false; }
  function step(number) {
    const showSaved = state.cart.length > 0 && Number(number) < 4;
    get('[data-cart-summary]').hidden = !showSaved;
    root.classList.toggle('has-saved-bookings', showSaved);
    get('[data-review-cart]').textContent = state.cart.length > 1 ? '← Back to your bookings' : '← Back to your booking';
    let active = null;
    steps.forEach(node => { node.hidden = Number(node.dataset.step) !== Number(number); if (!node.hidden) active = node; });
    progress.forEach(node => node.classList.toggle('is-active', Number(node.dataset.progress) === Math.min(Number(number),4)));
    active?.scrollIntoView({ block:'start', behavior:'auto' });
    const heading = active?.querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll:true }); }
    get('[data-cart-count]').textContent = state.cart.length + ' appointment' + (state.cart.length === 1 ? '' : 's') + ' selected';
  }
  function setStatus(node, message = '', kind = '') { if (node) { node.textContent = message; node.dataset.state = kind; } }
  function localDateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-ZA', { timeZone:'Africa/Johannesburg', weekday:'short', day:'numeric', month:'short', year:'numeric' }).format(date);
  }
  async function json(url, options = {}) {
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options, headers:{ Accept:'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error || 'That step could not be completed.'); error.code = body.code; throw error; }
    return body;
  }
  const post = (url, body) => json(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'x-shiloh-csrf-token':root.dataset.csrf }, body:JSON.stringify(body) });
  function busy(value) {
    state.busy = value;
    root.querySelectorAll('button').forEach(button => { button.disabled = value; });
    get('[data-add-booking]').disabled = value || selected().length >= 10;
  }
  function renderCart(list) {
    const host = get('[data-cart-items]');
    host.replaceChildren();
    list.forEach((item, index) => {
      const row = document.createElement('div'); row.className = 'cart-item';
      const name = document.createElement('strong'); name.textContent = (index + 1) + '. ' + item.service.name;
      const detail = document.createElement('small');
      detail.textContent = item.practitioner.name + ' · ' + localDateLabel(item.slot.startsAt) + ' · ' + item.slot.time + '–' + item.slot.endTime;
      const price = document.createElement('small');
      price.textContent = state.quote?.treatments[index] ? rand(state.quote.treatments[index].price) : item.service.price;
      row.append(name,detail,price);
      for (const action of ['Change','Remove']) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button button--soft';
        button.textContent = action; button.setAttribute('aria-label', action + ' appointment ' + (index + 1));
        button.addEventListener('click', () => {
          if (state.busy) return;
          state.cart = list; clearCurrent(); invalidate();
          if (action === 'Remove') { state.cart.splice(index,1); state.cart.length ? review() : step(1); }
          else {
            state.editing = index; state.service = item.service; state.practitioner = item.practitioner;
            dateInput.value = item.slot.date;
            get('[data-selected-practitioner]').textContent = item.service.name + ' · ' + item.practitioner.name;
            slotsHost.replaceChildren(); setStatus(slotStatus,'Choose a new date or time for this appointment.'); step(3);
          }
        });
        row.append(button);
      }
      host.append(row);
    });
  }
  async function review() {
    const list = selected();
    if (!list.length) { step(1); return; }
    step(4); state.quote = null; submit.disabled = true;
    setStatus(cartStatus,''); retryReview.hidden = true;
    get('[data-current-review]').hidden = list.length > 1;
    get('[data-cart-items]').hidden = list.length < 2;
    get('[data-cart-totals]').hidden = list.length < 2;
    get('[data-change-time]').hidden = list.length > 1;
    get('[data-add-booking]').hidden = !multiple;
    get('[data-add-booking]').disabled = list.length >= 10;
    policyAccepted.checked = false;
    submit.textContent = list.length > 1 ? 'Send booking requests' : 'Send booking request';
    if (list.length === 1) {
      const item = list[0];
      get('[data-review-service]').textContent = [item.service.name,item.service.price].filter(Boolean).join(' · ');
      get('[data-review-practitioner]').textContent = item.practitioner.name;
      get('[data-review-date]').textContent = localDateLabel(item.slot.startsAt);
      get('[data-review-time]').textContent = item.slot.time + '–' + item.slot.endTime;
      get('[data-review-deposit]').textContent = prepaidPackage ? 'Paid package · no further payment due' : item.practitioner.depositExempt ? 'No deposit required' : rate + '% after approval';
      setStatus(confirmStatus,''); submit.disabled = false; return;
    }
    renderCart(list);
    get('[data-cart-total]').textContent = get('[data-cart-deposit]').textContent = 'Checking…';
    setStatus(confirmStatus,'');
    setStatus(cartStatus,'Checking your appointments and combined total…');
    busy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      state.quote = await json('/my-shiloh/api/booking/multiple/review', {
        method:'POST', signal:controller.signal,
        headers:{ 'Content-Type':'application/json', 'x-shiloh-csrf-token':root.dataset.csrf },
        body:JSON.stringify({ treatments:payload(list) }),
      });
      get('[data-cart-total]').textContent = rand(state.quote.total);
      get('[data-cart-deposit]').textContent = rand(state.quote.deposit);
      get('[data-review-deposit]').textContent = 'One deposit payment after every appointment is approved';
      renderCart(list); setStatus(cartStatus,'');
    } catch (error) {
      state.quote = null;
      get('[data-cart-total]').textContent = get('[data-cart-deposit]').textContent = 'Not available yet';
      const message = error.name === 'AbortError'
        ? 'The check took too long. Try checking your appointments again.'
        : error.code === 'BOOKING_CART_OVERLAP'
          ? 'These appointments are for you and their times overlap. Change or remove an appointment so you can attend each treatment. For bookings for more than one person, contact Reception.'
          : error.message;
      setStatus(cartStatus,message,'error'); retryReview.hidden = false;
    } finally { clearTimeout(timeout); busy(false); submit.disabled = !state.quote; }
  }
  retryReview.addEventListener('click', () => { if (!state.busy) review(); });
  function practitionerButton(row) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'option';
    button.dataset.practitionerId = String(row.id);
    const name = document.createElement('strong'); name.textContent = row.name;
    const detail = document.createElement('small'); detail.textContent = prepaidPackage ? 'Covered by your prepaid package.' : row.depositExempt ? 'This booking does not require a deposit.' : rate + '% booking deposit applies after approval.';
    button.append(name,detail);
    if (row.depositExempt) {
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'No deposit required'; button.append(badge);
    }
    button.addEventListener('click', () => {
      state.practitioner = row; state.slot = null; invalidate();
      get('[data-selected-practitioner]').textContent = state.service.name + ' · ' + row.name;
      slotsHost.replaceChildren(); setStatus(slotStatus,''); step(3);
    });
    return button;
  }
  async function chooseService(button) {
    const generation = ++state.generation;
    state.service = { id:Number(button.dataset.serviceId), name:button.dataset.serviceName, duration:button.dataset.serviceDuration, price:button.dataset.servicePrice };
    state.practitioner = state.slot = null; invalidate();
    get('[data-selected-service]').textContent = [state.service.name,state.service.duration,state.service.price].filter(Boolean).join(' · ');
    practitionersHost.replaceChildren(); setStatus(status,'Checking eligible practitioners…'); step(2);
    try {
      const data = await json('/my-shiloh/api/booking/practitioners?serviceId=' + encodeURIComponent(state.service.id));
      if (generation !== state.generation) return;
      if (!data.practitioners?.length) throw new Error('No practitioner is currently available for this treatment.');
      data.practitioners.forEach(row => practitionersHost.appendChild(practitionerButton(row))); setStatus(status,'');
    } catch (error) { if (generation === state.generation) setStatus(status,error.message,'error'); }
  }
  root.querySelectorAll('[data-book-service]').forEach(button => button.addEventListener('click', () => chooseService(button)));
  const selectedServiceId = String(root.dataset.selectedServiceId || '');
  if (selectedServiceId) {
    const chosen = get('[data-book-service][data-service-id="' + CSS.escape(selectedServiceId) + '"]');
    if (chosen) chooseService(chosen);
  }
  root.querySelectorAll('[data-back-step]').forEach(button => button.addEventListener('click', () => {
    if (!state.busy) { ++state.generation; step(Number(button.dataset.backStep)); }
  }));
  get('[data-change-time]').addEventListener('click', () => {
    if (!current() && state.cart.length === 1) {
      const item = state.cart[0]; state.editing = 0; state.service = item.service; state.practitioner = item.practitioner; state.slot = item.slot;
      get('[data-selected-practitioner]').textContent = item.service.name + ' · ' + item.practitioner.name;
      dateInput.value = item.slot.date;
    }
    step(3);
  });
  get('[data-add-booking]').addEventListener('click', () => {
    if (!multiple || state.busy || selected().length >= 10) return;
    state.cart = selected(); clearCurrent(); invalidate(); ++state.generation; step(1);
  });
  get('[data-review-cart]').addEventListener('click', () => {
    if (state.busy) return;
    ++state.generation; clearCurrent(); invalidate(); review();
  });
  root.querySelectorAll('[data-special-occasion]').forEach(option => option.addEventListener('change', () => {
    occasionDetails.hidden = option.value !== 'yes'; if (option.value === 'no') occasionNote.value = ''; state.requestId = null; setStatus(confirmStatus,'');
  }));
  occasionNote?.addEventListener('input', () => { state.requestId = null; setStatus(confirmStatus,''); });
  get('[data-find-slots]')?.addEventListener('click', async () => {
    if (!state.service || !state.practitioner) return;
    const date = String(dateInput.value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setStatus(slotStatus,'Choose a date first.','error'); return; }
    const generation = ++state.generation;
    const service = state.service, practitioner = state.practitioner;
    slotsHost.replaceChildren(); setStatus(slotStatus,'Checking Shiloh’s live availability…');
    try {
      const data = await json('/my-shiloh/api/booking/availability?serviceId=' + service.id + '&staffId=' + practitioner.id + '&date=' + encodeURIComponent(date));
      if (generation !== state.generation) return;
      if (!data.slots?.length) { setStatus(slotStatus,'There are no available times on that date. Choose another date.','error'); return; }
      setStatus(slotStatus,'Choose one available time below.');
      data.slots.forEach(row => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'slot';
        const time = document.createElement('strong'); time.textContent = row.time + '–' + row.endTime;
        const detail = document.createElement('small'); detail.textContent = practitioner.name + ' · Available'; button.append(time,detail);
        button.addEventListener('click', () => { state.slot = row; invalidate(); review(); }); slotsHost.append(button);
      });
    } catch (error) { if (generation === state.generation) setStatus(slotStatus,error.message,'error'); }
  });
  submit?.addEventListener('click', async () => {
    if (state.busy) return;
    const list = selected(); if (!list.length) return;
    const occasionChoice = get('[data-special-occasion]:checked')?.value;
    if (!occasionChoice) { setStatus(confirmStatus,'Please choose Yes or No for a special occasion.','error'); return; }
    if (occasionChoice === 'yes' && !occasionNote.value.trim()) { setStatus(confirmStatus,'Please tell Reception what the occasion is.','error'); occasionNote.focus(); return; }
    if (!policyAccepted.checked) { setStatus(confirmStatus,'Please accept Shiloh’s Booking Policy & Terms first.','error'); return; }
    const common = { policyAccepted:true, specialOccasion:occasionChoice === 'yes', occasionNote:occasionChoice === 'yes' ? occasionNote.value : '' };
    if (list.length > 1 && !state.quote) { await review(); return; }
    busy(true); setStatus(confirmStatus,'Sending your booking request…');
    try {
      let data;
      if (list.length > 1) {
        state.requestId ||= crypto.randomUUID();
        data = await post('/my-shiloh/api/booking/multiple/confirm', { ...common, treatments:payload(list), quoteHash:state.quote.quoteHash, requestId:state.requestId });
      } else data = await post('/my-shiloh/api/booking/confirm', { ...common, ...payload(list)[0] });
      get('[data-success-message]').textContent = data.message || 'Your selected time is being held while Shiloh confirms it.'; step(5);
    } catch (error) {
      if (error.code === 'BOOKING_CART_QUOTE_CHANGED') { invalidate(); busy(false); await review(); setStatus(confirmStatus,error.message,'error'); return; }
      setStatus(confirmStatus,error.code ? error.message : 'We could not verify the response. Check your bookings, or retry this same request safely.','error');
      busy(false);
    }
  });
})();
