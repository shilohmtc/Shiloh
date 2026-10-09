'use strict';
const { escapeHtml: esc } = require('./workspaceShell');
const { noncashMethodAvailability } = require('./bookingNoncashUx');

function renderBookingPaymentMethod({ model, manualForm, noncashForms }) {
  const noncash = noncashMethodAvailability(model);
  const methods = [
    [
      'card_machine',
      'Card machine',
      model.authority.canCollect ? '' : 'Your access does not permit recording money received.',
    ],
    [
      'cash',
      'Cash',
      model.authority.canCollect ? '' : 'Your access does not permit recording money received.',
    ],
    [
      'manual_eft',
      'EFT',
      model.authority.canCollect ? '' : 'Your access does not permit recording money received.',
    ],
    ['gift-voucher', 'Voucher', noncash.gift],
    ['client-credit', 'Client credit', noncash.credit],
  ];
  const defaultMethod =
    Number(model.payment.outstanding) > 0 ? methods.find(([, , reason]) => !reason)?.[0] || '' : '';
  const expandCollection =
    Number(model.payment.outstanding) > 0 &&
    model.deposit?.requirement?.state !== 'awaiting' &&
    !model.payment.requests.some((item) =>
      ['created', 'link_issued', 'pending'].includes(item.state),
    );
  const options = methods
    .map(
      ([value, label, reason]) =>
        `<option value="${value}"${reason ? ' disabled' : ''}${value === defaultMethod ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
  const unavailable = methods
    .filter(([, , reason]) => reason)
    .map(([, label, reason]) => `<li><strong>${label}:</strong> ${esc(reason)}</li>`)
    .join('');
  return `<details class="payment-card manual-payment" data-payment-method-card${expandCollection ? ' open' : ''}><summary>Record payment</summary><div class="payment-method-label"><label for="booking-payment-method">Payment method</label><select id="booking-payment-method" data-payment-method aria-describedby="payment-method-help"><option value="">Choose a payment method</option>${options}</select></div><p class="hint" id="payment-method-help">Voucher and client credit reduce the treatment balance without recording new money received.</p>${unavailable ? `<ul class="payment-method-unavailable" aria-label="Unavailable payment methods">${unavailable}</ul>` : ''}${manualForm.replace('data-payment-panel="manual"', `data-payment-panel="manual"${['card_machine', 'cash', 'manual_eft'].includes(defaultMethod) ? '' : ' hidden'}`)}${noncashForms}</details>`;
}

function initializeBookingPaymentMethod() {
  'use strict';
  const root = document.querySelector('[data-payment-page]');
  if (!root) return;
  const selector = root.querySelector('[data-payment-method]');
  if (!selector) return;
  const forms = [...root.querySelectorAll('[data-payment-panel]')],
    manualKey = 'shiloh-booking-manual:' + root.dataset.appointmentId;
  let busy = false,
    pendingAction = '',
    manualPending = null,
    lastSelection = selector.value;
  try {
    manualPending = JSON.parse(sessionStorage.getItem(manualKey) || 'null');
    if (manualPending) pendingAction = 'manual';
  } catch (_) {
    sessionStorage.removeItem(manualKey);
  }
  for (const action of ['gift-voucher', 'client-credit']) {
    try {
      if (
        JSON.parse(
          sessionStorage.getItem(
            'shiloh-booking-noncash:' + root.dataset.appointmentId + ':' + action,
          ) || 'null',
        )
      )
        pendingAction = action;
    } catch (_) {}
  }
  const sync = () => {
    const selected = selector.value;
    for (const form of forms) {
      form.hidden =
        form.dataset.paymentPanel === 'manual'
          ? !['card_machine', 'cash', 'manual_eft'].includes(selected)
          : form.dataset.paymentPanel !== selected;
      if (form.dataset.paymentPanel === 'manual') form.elements.method.value = selected;
    }
    selector.disabled = busy || Boolean(pendingAction);
    const reward = root.querySelector('[data-rewards-form] button');
    if (reward)
      reward.disabled =
        busy ||
        Boolean(pendingAction) ||
        root.querySelector('[data-rewards-form] input[name="amount"]').disabled;
    root.dispatchEvent(new Event('payment-method-state'));
  };
  root.shilohPaymentMethod = {
    completed: false,
    active: (form) =>
      !busy &&
      (!pendingAction || pendingAction === (form.dataset.bookingNoncash || 'manual')) &&
      !form.hidden &&
      Boolean(selector.value),
    blocked: () => busy || Boolean(pendingAction),
    setBusy: (value) => {
      busy = value;
      sync();
    },
    setPending: (action) => {
      pendingAction = action;
      sync();
    },
    manualPending: () => manualPending,
    beginManual: (values) => {
      if (!manualPending) {
        manualPending = { ...values, operationId: crypto.randomUUID().replaceAll('-', '') };
        sessionStorage.setItem(manualKey, JSON.stringify(manualPending));
        pendingAction = 'manual';
      }
      sync();
      return manualPending;
    },
    clearManual: () => {
      manualPending = null;
      sessionStorage.removeItem(manualKey);
      pendingAction = '';
      sync();
    },
  };
  selector.addEventListener('change', () => {
    if (busy || pendingAction) {
      selector.value = lastSelection;
      sync();
      return;
    }
    lastSelection = selector.value;
    for (const form of forms) {
      form.elements.amount.value = '';
      const confirm = form.elements.receivedOutsideOzowConfirmed;
      if (confirm) confirm.checked = false;
      form.dispatchEvent(new Event('input', { bubbles: true }));
    }
    sync();
  });
  if (pendingAction === 'manual' && manualPending) {
    const form = root.querySelector('[data-manual-form]');
    if (form) {
      selector.value = manualPending.method;
      lastSelection = selector.value;
      for (const [name, value] of Object.entries(manualPending)) {
        const field = form.elements[name];
        if (field) {
          if (field.type === 'checkbox') field.checked = value === 'on' || value === true;
          else field.value = value;
        }
      }
      root.querySelector('[data-payment-method-card]').open = true;
      root.querySelector('[data-payment-status]').textContent =
        'An earlier receipt needs review. Retry this unchanged receipt, or check the history.';
    }
  }
  if (pendingAction && pendingAction !== 'manual') {
    const option = [...selector.options].find(
      (item) => item.value === pendingAction && !item.disabled,
    );
    const earlier = JSON.parse(
        sessionStorage.getItem(
          'shiloh-booking-noncash:' + root.dataset.appointmentId + ':' + pendingAction,
        ),
      ),
      panel = forms.find((form) => form.dataset.paymentPanel === pendingAction);
    if (
      option &&
      panel &&
      (!earlier.body.voucherCode ||
        [...panel.elements.voucherCode.options].some(
          (item) => item.value === earlier.body.voucherCode,
        ))
    ) {
      selector.value = pendingAction;
      lastSelection = pendingAction;
      root.querySelector('[data-payment-method-card]').open = true;
    } else {
      const status = root.querySelector('[data-payment-status]');
      status.textContent =
        'An earlier voucher or credit request needs review. Retry that exact request to resolve its result before another payment.';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry earlier request';
      status.append(document.createElement('br'), button);
      button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        sync();
        button.disabled = true;
        try {
          const key = 'shiloh-booking-noncash:' + root.dataset.appointmentId + ':' + pendingAction,
            pending = JSON.parse(sessionStorage.getItem(key));
          const response = await fetch(
            '/calendar/payments/appointments/' + root.dataset.appointmentId + '/' + pendingAction,
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
          if (!response.ok) throw new Error(result.error || 'The earlier request needs review.');
          sessionStorage.removeItem(key);
          root.shilohPaymentMethod.completed = true;
          location.reload();
        } catch (error) {
          status.firstChild.textContent =
            error.message + ' Review the history or retry this same request.';
          busy = false;
          button.disabled = false;
          sync();
        }
      });
    }
  }
  sync();
}
function bookingPaymentMethodClientScript() {
  return `(${initializeBookingPaymentMethod.toString()})();`;
}
module.exports = { renderBookingPaymentMethod, bookingPaymentMethodClientScript };
