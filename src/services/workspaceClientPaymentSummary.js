'use strict';

// Client lookup is not financial authority. Canonical summaries enforce payment
// VIEW and appointment scope inside read-only transactions, including group totals.
async function clientHistoryPayments({ appointments, scope, adminId, paymentService }) {
  const result = appointments.map(appointment => ({ ...appointment }));
  const pending = result.filter(appointment => ['completed', 'no_charge'].includes(appointment.status));
  if (scope?.kind !== 'clinic') {
    pending.forEach(appointment => { appointment.paymentSummary = { available: false, restricted: true }; });
    return result;
  }
  // A history page is bounded upstream; limit simultaneous payment snapshots too.
  for (let index = 0; index < pending.length; index += 3) {
    await Promise.all(pending.slice(index, index + 3).map(async appointment => {
      try { appointment.paymentSummary = await paymentService.getSummary({ adminId, appointmentId: appointment.id }); }
      catch (error) { appointment.paymentSummary = { available: false, restricted: error.httpStatus === 403 }; }
    }));
  }
  return result;
}
module.exports = { clientHistoryPayments };
