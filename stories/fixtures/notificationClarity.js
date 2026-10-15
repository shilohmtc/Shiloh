'use strict';
const explanation = 'We can’t confirm the client was notified. Contact them if it’s urgent.';
function messagesFixture() {
  return {
    authority: { displayName: 'Synthetic Reception' }, selectedView: 'attention', notificationAuthority: {},
    attention: [{ client: { id: 901, name: 'Synthetic Client', normalizedMobile: '27820000001' },
      appointment: { id: 701, startsAt: '2026-10-20T08:00:00Z', serviceName: 'Synthetic treatment' },
      canRecover: false, confirmation: { status: 'unavailable', statusLabel: 'Booking confirmation not confirmed',
        deliveryExplanation: `${explanation} The booking remains available in Bookings.` } }],
    changeAttention: [
      ['waiting', 'Booking change not confirmed', 'Appointment update'],
      ['failed', 'Send attempt failed', 'Appointment update'],
      ['uncertain', 'Send status uncertain', 'Appointment update'],
      ['waiting', 'Cancellation not confirmed', 'Cancellation update'],
    ].map(([status, statusLabel, label], index) => ({ id: 801 + index, appointmentId: 701, clientId: 901,
      clientName: 'Synthetic Client', normalizedMobile: '27820000001', startsAt: '2026-10-20T08:00:00Z',
      updatedAt: '2026-10-15T09:30:00Z', status, statusLabel, label,
      nextAction: status === 'uncertain' ? 'The phone-alert outcome is uncertain.' : status === 'failed' ? 'The send attempt failed.' : explanation })),
  };
}
function profileFixture(usage = 'Not yet confirmed', phoneAlerts = 'Unknown') {
  return { authority: { displayName: 'Synthetic Reception' }, client: { id: 901, name: 'Synthetic Client',
    normalized_mobile: '27820000001', status: 'active', profile_status: 'registered' },
    appointments: [], historyOffset: 0, pageSize: 20, appStatus: { usage, phoneAlerts } };
}
module.exports = { messagesFixture, profileFixture };
