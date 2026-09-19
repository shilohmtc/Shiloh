(() => {
  'use strict';
  async function submit(form, path, statusSelector, shape) {
    const status = form.querySelector(statusSelector); const button = form.querySelector('[type="submit"]');
    button.disabled = true; status.textContent = 'Saving…';
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const response = await fetch(path, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-Shiloh-CSRF-Token':form.dataset.csrf,Accept:'application/json'}, body:JSON.stringify(shape(data)) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to save.');
      location.reload();
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  }
  document.querySelector('[data-policy-form]')?.addEventListener('submit', function(event) { event.preventDefault(); submit(this, '/calendar/vouchers/policy', '[data-policy-status]', (data) => ({ mode:data.mode, months:data.months })); });
  document.querySelector('[data-redeem-form]')?.addEventListener('submit', function(event) { event.preventDefault(); submit(this, '/calendar/vouchers/redeem', '[data-redeem-status]', (data) => ({ ...data, operationId:crypto.randomUUID() })); });
})();
