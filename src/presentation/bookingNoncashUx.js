'use strict';
const { escapeHtml: esc } = require('./workspaceShell');
const money = (value) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(value || 0));
function noncashMethodAvailability(model) {
  const common = model.subject.final
    ? 'Payment collection is closed.'
    : Number(model.payment.outstanding) <= 0
      ? 'No treatment balance outstanding.'
      : !model.subject.crmV2ClientId
        ? 'A linked client profile is required.'
        : model.deposit?.requirement?.state === 'awaiting'
          ? 'The booking deposit still needs payment.'
          : model.subject.status !== 'completed'
            ? 'Available after treatment is completed.'
            : !model.noncash?.eligible
              ? model.noncash?.message || 'Available after treatment is completed.'
              : model.payment.requests.some((item) =>
                    ['created', 'link_issued', 'pending'].includes(item.state),
                  )
                ? 'Review the active payment request first.'
                : '';
  return {
    credit:
      common ||
      (!model.noncash?.credit?.canApply
        ? 'Your access does not permit using client credit.'
        : Number(model.noncash.credit.balance) <= 0
          ? 'No client credit available.'
          : ''),
    gift:
      common ||
      (!model.noncash?.gift?.canApply
        ? 'Your access does not permit using vouchers.'
        : !model.noncash.gift.vouchers?.length
          ? 'No eligible linked vouchers available.'
          : ''),
  };
}
function renderBookingNoncash(model) {
  const availability = noncashMethodAvailability(model),
    outstanding = Number(model.payment.outstanding);
  const credit = model.noncash?.credit,
    gift = model.noncash?.gift;
  const form = (action, body, balance) =>
    `<form class="payment-form" data-booking-noncash="${action}" data-payment-panel="${action}" data-outstanding="${esc(outstanding)}" data-balance="${esc(balance)}" hidden>${body}<p class="hint">For completed treatments only. Linked treatments must all belong to this client and be completed. Deposits need payment.</p><label>Amount to use (R)<input name="amount" type="number" min="0.01" step="0.01" max="${esc(Math.min(balance, outstanding))}" required></label><p class="hint" data-noncash-preview>Remaining treatment balance: ${esc(money(outstanding))}</p><button disabled>${action === 'gift-voucher' ? 'Use voucher' : 'Use credit'}</button><p class="status" role="status" aria-live="polite" data-noncash-status></p></form>`;
  const creditForm = availability.credit
    ? ''
    : form(
        'client-credit',
        `<h3>Use client credit</h3><p class="hint">Available: <strong>${esc(money(credit.balance))}</strong></p><input type="hidden" name="clientId" value="${esc(model.subject.crmV2ClientId)}">`,
        credit.balance,
      );
  const giftForm = availability.gift
    ? ''
    : form(
        'gift-voucher',
        `<h3>Use voucher</h3><label>Available gift voucher<select name="voucherCode">${gift.vouchers.map((v) => `<option value="${esc(v.voucher_code)}" data-balance="${esc(v.balance)}" data-valid-until="${esc(String(v.valid_until || '').slice(0, 10))}">${esc(v.voucher_code)} · ${esc(money(v.balance))}${v.valid_until ? ` · valid until ${esc(String(v.valid_until).slice(0, 10))}` : ''}</option>`).join('')}</select></label><p class="hint" data-gift-identity>Code: ${esc(gift.vouchers[0].voucher_code)} · ${gift.vouchers[0].valid_until ? `Valid until ${esc(String(gift.vouchers[0].valid_until).slice(0, 10))}` : 'No expiry date recorded.'}</p><p class="hint" data-gift-available>Available: <strong>${esc(money(gift.vouchers[0].balance))}</strong></p><input type="hidden" name="clientId" value="${esc(model.subject.crmV2ClientId)}">`,
        gift?.vouchers[0]?.balance,
      );
  return giftForm + creditForm;
}
function initializeBookingNoncash() {
  'use strict';
  const root = document.querySelector('[data-payment-page]');
  if (!root) return;
  const controller = root.shilohPaymentMethod;
  const money = (value) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value);
  root.querySelectorAll('[data-booking-noncash]').forEach((form) => {
    const action = form.dataset.bookingNoncash,
      key = 'shiloh-booking-noncash:' + root.dataset.appointmentId + ':' + action;
    let pending = null,
      busy = false;
    try {
      pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch (_) {
      sessionStorage.removeItem(key);
    }
    const amount = form.elements.amount,
      choice = form.elements.voucherCode,
      status = form.querySelector('[data-noncash-status]'),
      button = form.querySelector('button'),
      preview = form.querySelector('[data-noncash-preview]');
    if (pending) {
      for (const [name, value] of Object.entries(pending.body)) {
        if (form.elements[name]) form.elements[name].value = value;
      }
      status.textContent = 'Retry this unchanged request, or review the history.';
    }
    const limit = () =>
      Math.min(
        Number(choice ? choice.selectedOptions[0]?.dataset.balance || 0 : form.dataset.balance),
        Number(form.dataset.outstanding),
      );
    const valid = () =>
      /^(?:\d+)(?:\.\d{1,2})?$/.test(amount.value.trim()) &&
      Number.isFinite(Number(amount.value)) &&
      Number(amount.value) > 0 &&
      (pending || Number(amount.value) <= limit()) &&
      form.checkValidity();
    const sync = () => {
      const selected = Number(amount.value || 0),
        balance = Number(
          choice ? choice.selectedOptions[0]?.dataset.balance || 0 : form.dataset.balance,
        );
      preview.textContent =
        'Remaining treatment balance: ' +
        money(
          Math.max(
            0,
            Number(form.dataset.outstanding) - (Number.isFinite(selected) ? selected : 0),
          ),
        );
      const available = form.querySelector('[data-gift-available] strong');
      if (available) available.textContent = money(balance);
      const identity = form.querySelector('[data-gift-identity]');
      if (identity)
        identity.textContent =
          'Code: ' +
          choice.value +
          ' · ' +
          (choice.selectedOptions[0]?.dataset.validUntil
            ? 'Valid until ' + choice.selectedOptions[0].dataset.validUntil
            : 'No expiry date recorded.');
      amount.max = String(pending ? Math.max(balance, Number(pending.body.amount)) : limit());
      amount.readOnly = busy || Boolean(pending);
      if (choice) choice.disabled = busy || Boolean(pending);
      button.disabled = busy || !controller.active(form) || !valid();
    };
    amount.addEventListener('input', sync);
    if (choice)
      choice.addEventListener('change', () => {
        amount.value = '';
        sync();
      });
    root.addEventListener('payment-method-state', sync);
    sync();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !controller.active(form) || !valid()) {
        sync();
        return;
      }
      const retrying = Boolean(pending),
        values = Object.fromEntries(new FormData(form));
      if (choice) values.voucherCode = choice.value;
      const canonical = (value) =>
        JSON.stringify(
          Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
        );
      const signature = canonical(values);
      if (pending && canonical(JSON.parse(pending.signature)) !== signature) {
        status.textContent =
          'An earlier request needs review. Check the history before changing it.';
        return;
      }
      busy = true;
      controller.setBusy(true);
      sync();
      try {
        if (!pending) {
          if (
            !(await window.ShilohConfirm({
              title: action === 'gift-voucher' ? 'Use gift voucher?' : 'Use client credit?',
              copy:
                'Use ' +
                money(Number(values.amount)) +
                ' of noncash value. Remaining treatment balance: ' +
                money(Math.max(0, Number(form.dataset.outstanding) - Number(values.amount))) +
                '. Actual cash, card or EFT received is recorded separately.',
              cancel: 'Go back',
              action: 'Confirm use',
              danger: false,
            }))
          )
            return;
          pending = { signature, body: { ...values, operationId: crypto.randomUUID() } };
          sessionStorage.setItem(key, JSON.stringify(pending));
          controller.setPending(action);
        }
        status.textContent = 'Applying noncash value…';
        const response = await fetch(
          '/calendar/payments/appointments/' + root.dataset.appointmentId + '/' + action,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-Shiloh-CSRF-Token': root.dataset.csrf,
            },
            body: JSON.stringify(pending.body),
          },
        );
        const result = await response.json();
        if (!response.ok) {
          if (response.status < 500 && !retrying) {
            pending = null;
            sessionStorage.removeItem(key);
            controller.setPending('');
          }
          throw new Error(result.error || 'Value could not be applied.');
        }
        sessionStorage.removeItem(key);
        controller.completed = true;
        status.textContent = 'Value applied. Refreshing…';
        location.reload();
      } catch (error) {
        status.textContent =
          error.message + (pending ? ' Retry this unchanged request, or review the history.' : '');
      } finally {
        if (!controller.completed) {
          busy = false;
          controller.setBusy(false);
        }
        sync();
      }
    });
  });
}
function bookingNoncashClientScript() {
  return `(${initializeBookingNoncash.toString()})();`;
}
module.exports = { noncashMethodAvailability, renderBookingNoncash, bookingNoncashClientScript };
