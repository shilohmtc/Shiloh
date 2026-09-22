(() => {
  'use strict';
  const form = document.querySelector('[data-voucher-form]');
  if (!form) return;
  const status = form.querySelector('[data-voucher-status]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true; status.textContent = 'Preparing your secure payment…';
    const data = new FormData(form);
    try {
      const response = await fetch('/my-shiloh/api/gift-vouchers', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type':'application/json', 'X-Shiloh-CSRF-Token':form.dataset.csrf, Accept:'application/json' },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The voucher could not be prepared.');
      location.assign(result.paymentUrl);
    } catch (error) { status.textContent = error.message; submit.disabled = false; }
  });
})();
