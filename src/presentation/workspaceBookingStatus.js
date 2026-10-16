// Use the canonical approval state; presentation never changes booking authority.
function workspaceBookingStatus({ status, bookingRequestState, effectiveStatus } = {}) {
  const value = String(status || '').toLowerCase();
  if (['completed', 'cancelled', 'no_show', 'no_charge'].includes(value)) {
    return value.replace(/_/g, ' ');
  }
  const approval = effectiveStatus || bookingRequestState;
  if (approval === 'awaiting_client_confirmation') return 'Awaiting client response';
  if (approval === 'pending') return 'Awaiting confirmation';
  return value ? value.replace(/_/g, ' ') : 'Scheduled';
}
module.exports = { workspaceBookingStatus };
