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
  const walkInForm = document.querySelector('[data-walk-in-voucher-form]');
  walkInForm?.addEventListener('submit', async function(event) {
    event.preventDefault();
    const status = this.querySelector('[data-walk-in-status]');
    const button = this.querySelector('[type="submit"]');
    const resultPanel = document.querySelector('[data-walk-in-result]');
    button.disabled = true;
    status.textContent = 'Issuing voucher…';
    if (resultPanel) resultPanel.hidden = true;
    try {
      const data = Object.fromEntries(new FormData(this).entries());
      const operationId = this.dataset.operationId || crypto.randomUUID();
      this.dataset.operationId = operationId;
      const response = await fetch('/calendar/vouchers/walk-in', {
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json','X-Shiloh-CSRF-Token':this.dataset.csrf,Accept:'application/json'},
        body:JSON.stringify({ ...data, paymentConfirmed:data.paymentConfirmed === 'true', sendDigitalCopy:data.sendDigitalCopy === 'true', operationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to issue this voucher.');
      const code = String(result.voucher?.voucher_code || '');
      status.textContent = '';
      resultPanel.querySelector('[data-issued-code]').textContent = code;
      const view = resultPanel.querySelector('[data-view-issued-voucher]');
      view.href = result.voucherPath || '#';
      const delivery = resultPanel.querySelector('[data-issued-delivery]');
      delivery.textContent = result.whatsappDelivery?.sent
        ? 'The optional digital voucher was sent on WhatsApp.'
        : result.whatsappDelivery?.reason === 'not_requested'
          ? 'No WhatsApp copy was requested.'
          : 'The voucher is active, but the optional WhatsApp copy could not be sent.';
      delete this.dataset.operationId;
      this.reset();
      button.disabled = false;
      resultPanel.hidden = false;
      resultPanel.focus({ preventScroll:true });
      resultPanel.scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'center' });
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
  document.querySelector('[data-copy-issued-code]')?.addEventListener('click', async () => {
    const code = document.querySelector('[data-issued-code]')?.textContent || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      const delivery = document.querySelector('[data-issued-delivery]');
      if (delivery) delivery.textContent = `${code} copied. Write it on the physical voucher.`;
    } catch (_) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('[data-issued-code]'));
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
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
