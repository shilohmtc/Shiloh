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
  const redeemForm = document.querySelector('[data-redeem-form]');
  const selectionStatus = document.querySelector('[data-voucher-selection-status]');
  document.querySelector('[data-issued-vouchers]')?.addEventListener('click', (event) => {
    const selection = event.target.closest('[data-voucher-select]');
    if (!selection || !redeemForm) return;
    document.querySelectorAll('[data-voucher-select]').forEach((control) => control.setAttribute('aria-pressed', String(control === selection)));
    const code = selection.dataset.voucherCode || '';
    const codeInput = redeemForm.elements.voucherCode;
    const amountInput = redeemForm.elements.amount;
    codeInput.value = code;
    amountInput.max = selection.dataset.voucherBalance || '';
    amountInput.value = '';
    amountInput.placeholder = selection.dataset.voucherBalance ? `Up to R ${selection.dataset.voucherBalance}` : '';
    if (selectionStatus) selectionStatus.textContent = `${code} selected. Enter the amount to redeem below.`;
    redeemForm.scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start' });
    amountInput.focus({ preventScroll:true });
  });
  redeemForm?.addEventListener('submit', function(event) { event.preventDefault(); submit(this, '/calendar/vouchers/redeem', '[data-redeem-status]', (data) => ({ ...data, operationId:crypto.randomUUID() })); });
})();
