'use strict';
const { escapeHtml: esc } = require('./workspaceShell');
const rand = (value) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(value || 0));
function renderPriorPaymentForm(model) {
  if (!model.authority.canRecordPrior || model.subject.final || !model.subject.crmV2ClientId)
    return '';
  const candidates = model.priorPayments?.candidates || [];
  return `<form class="payment-form" data-prior-payment="prior-payment" data-payment-panel="prior-payment" hidden><h3>Paid previously</h3><p class="hint">Check the history below and the client’s packages first. Payments already on this booking are included in its balance. Use a package visit for prepaid treatments.</p><label>Payment evidence<select name="sourceEntryId"><option value="">Payment predates Shiloh’s records</option>${candidates.map((e) => `<option value="${esc(e.id)}">Receipt #${esc(e.id)} · booking #${esc(e.appointment_id)} · ${esc(e.reference)} · up to ${esc(rand(Math.min(Number(e.amount), Number(e.available))))}</option>`).join('')}</select></label><p class="hint">Only unused receipt value from another booking for this same client can be linked. Money already covering a treatment cannot be used twice.</p><label>Amount paid previously (R)<input name="amount" type="number" min="0.01" max="${esc(model.payment.outstanding)}" step="0.01" required></label><div data-historical-evidence><label>Original payment date<input name="paymentDate" type="date" required></label><label>Original payment reference<input name="reference" maxlength="120" required></label></div><label>Evidence note<input name="reason" maxlength="240" required></label><label class="manual-confirm"><input name="reviewed" type="checkbox" required> I checked payments and packages. This amount has not already been used for this booking.</label><p class="hint">This keeps the treatment value and reduces the balance. New money received today: R0. It does not issue goodwill credit or new rewards. Any open payment links for this booking will be closed.</p><button data-workspace-action="primary" disabled>Record paid previously</button><p class="status" role="status" aria-live="polite" data-prior-status></p></form>`;
}
function renderPriorPaymentHistory(model) {
  const items = model.priorPayments?.entries || [];
  if (!items.length) return '';
  return `<section class="payment-card" data-prior-history><h2>Prior-payment evidence</h2><ul class="payment-list">${items
    .map((e) => {
      const outgoing = Number(e.source_payment_account_id) === Number(model.payment.accountId);
      const applied = e.entry_type === 'apply';
      const reverse = applied && !e.reversed && !outgoing && model.authority.canRecordPrior;
      return `<li><span><strong>${outgoing ? (applied ? 'Linked to another booking' : 'Receipt link reversed') : applied ? 'Paid previously' : 'Prior payment reversed'} · ${esc(rand(e.amount))}${e.reversed ? ' · Reversed' : ''}</strong><small>Entry #${esc(e.id)} · Original date ${esc(new Date(e.payment_date).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' }))} · ${esc(e.reference)}${e.source_payment_ledger_entry_id ? ' · Receipt #' + esc(e.source_payment_ledger_entry_id) : ' · Before Shiloh’s records'}</small><small>${esc(e.actor_name)} · ${esc(e.reason)}${e.correction_target_id ? ' · Corrects entry #' + esc(e.correction_target_id) : ''}</small></span>${reverse ? `<form class="payment-form" data-prior-payment="prior-payment-reverse"><input type="hidden" name="entryId" value="${esc(e.id)}"><label>Correction reason<input name="reason" maxlength="240" required></label><label class="manual-confirm"><input type="checkbox" name="reviewed" required> I reviewed this evidence and the booking balance.</label><button data-workspace-action="secondary" disabled>Reverse prior payment</button><p class="status" role="status" aria-live="polite" data-prior-status></p></form>` : ''}</li>`;
    })
    .join(
      '',
    )}</ul><p class="hint">Reversal corrects the booking balance. It does not record a cash refund.</p></section>`;
}
function initializePriorPayments() {
  const root = document.querySelector('[data-payment-page]');
  if (!root) return;
  const controller = root.shilohPaymentMethod;
  if (!controller) return;
  root.querySelectorAll('[data-prior-payment]').forEach((form) => {
    const action = form.dataset.priorPayment,
      key = 'shiloh-booking-noncash:' + root.dataset.appointmentId + ':' + action;
    const button = form.querySelector('button'),
      status = form.querySelector('[data-prior-status]'),
      source = form.elements.sourceEntryId;
    let pending = null,
      busy = false;
    try {
      pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch (_) {
      sessionStorage.removeItem(key);
    }
    if (
      pending &&
      (!form.elements.entryId ||
        String(form.elements.entryId.value) === String(pending.body.entryId))
    ) {
      for (const [name, value] of Object.entries(pending.body)) {
        const field = form.elements[name];
        if (field) {
          if (field.type === 'checkbox') field.checked = value === 'on' || value === true;
          else field.value = value;
        }
      }
    } else pending = null;
    function sync() {
      if (source) {
        const historical = !source.value;
        form.querySelector('[data-historical-evidence]').hidden = !historical;
        for (const name of ['paymentDate', 'reference']) {
          form.elements[name].required = historical;
          form.elements[name].disabled = !historical;
        }
      }
      for (const field of [...form.elements]) {
        if (field === button || field.type === 'hidden') continue;
        if (field.tagName === 'SELECT' || field.type === 'checkbox')
          field.disabled = busy || Boolean(pending);
        else field.readOnly = busy || Boolean(pending);
      }
      const active = ['prior-payment', 'no-charge'].includes(action)
        ? controller.active(form)
        : !controller.blocked() || Boolean(pending);
      button.disabled =
        busy || !active || (!pending && (!form.elements.reviewed.checked || !form.checkValidity()));
    }
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    root.addEventListener('payment-method-state', sync);
    sync();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      sync();
      if (button.disabled) return;
      const retrying = Boolean(pending);
      if (!pending) {
        const confirmed = await window.ShilohConfirm({
          title:
            action === 'no-charge'
              ? 'Mark this treatment no charge?'
              : action === 'prior-payment'
                ? 'Record paid previously?'
                : 'Reverse prior payment?',
          copy:
            action === 'no-charge'
              ? 'The client charge and practitioner earnings become R0. The original price and your reason remain recorded. This is a free treatment, not an earlier payment. Open payment links will close.'
              : action === 'prior-payment'
                ? 'Keep the treatment value and apply reviewed earlier payment evidence. No new money is recorded today. Open payment links will be closed.'
                : 'Remove this settlement from the booking balance while keeping its evidence. This is not a cash refund.',
          cancel: 'Go back',
          action:
            action === 'no-charge'
              ? 'Record no charge'
              : action === 'prior-payment'
                ? 'Record paid previously'
                : 'Reverse prior payment',
        });
        if (!confirmed) return;
        pending = {
          body: { ...Object.fromEntries(new FormData(form)), operationId: crypto.randomUUID() },
        };
        sessionStorage.setItem(key, JSON.stringify(pending));
        controller.setPending(action);
      }
      busy = true;
      controller.setBusy(true);
      sync();
      status.textContent =
        action === 'no-charge' ? 'Recording no charge…' : 'Saving prior-payment evidence…';
      try {
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
          throw new Error(result.error || 'Prior-payment evidence could not be saved.');
        }
        sessionStorage.removeItem(key);
        controller.completed = true;
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
function priorPaymentsClientScript() {
  return `(${initializePriorPayments.toString()})();`;
}
function renderNoChargeForm(model) {
  if (
    !model.authority.canRecordNoCharge ||
    model.subject.final ||
    model.subject.groupId ||
    model.subject.status !== 'completed'
  )
    return '';
  return `<form class="payment-form" data-prior-payment="no-charge" data-payment-panel="no-charge" hidden><h3>No charge</h3><p class="hint">Use this only when the treatment is deliberately free. Client charge and practitioner earnings become R0. The original price stays in the audit history. For earlier payment, choose Paid previously; for prepaid treatments, use the package visit.</p><input type="hidden" name="expectedRevision" value="${esc(model.subject.pricingRevision || '')}"><label>Reason for no charge<input name="reason" maxlength="240" required></label><label class="manual-confirm"><input type="checkbox" name="reviewed" required> I checked payments and packages. This treatment is free, not paid previously.</label><button disabled>Record no charge</button><p class="status" role="status" aria-live="polite" data-prior-status></p></form>`;
}
module.exports = {
  renderNoChargeForm,
  renderPriorPaymentForm,
  renderPriorPaymentHistory,
  priorPaymentsClientScript,
};
