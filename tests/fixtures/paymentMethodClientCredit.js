'use strict';
const { paymentFixture } = require('./bookingPaymentPresentation');
function paymentMethodFixture() {
  const model = paymentFixture({ paid: false });
  model.payment = { ...model.payment, amountDue: '800.00', netPaid: '0.00', outstanding: '800.00', state: 'unpaid', requests: [], entries: [] };
  model.deposit = { applicable: false };
  model.noncash.credit.balance = '500.00';
  return model;
}
const clientProfileFixture = {
  client: { id: 101, name: 'Synthetic Client', normalized_mobile: '27810000101', status: 'active', date_of_birth: '1990-01-01', mobile_verified_at: '2026-10-01T08:00:00Z' },
  authority: { displayName: 'Synthetic Reception' }, manageAllowed: false,
  appointments: [{ id: 779, starts_at: '2026-10-08T09:00:00Z', ends_at: '2026-10-08T10:00:00Z', status: 'completed', title: 'Completed treatment' }],
  policyAcceptances: [], communications: [], historyOffset: 0, pageSize: 20, hasMore: false,
};
module.exports = { paymentMethodFixture, clientProfileFixture };
