// Classification only. This grants no client session, contact or booking authority.
function isOrganiserContactGuest(row) {
  return row?.contact_mode === 'organiser'
    && row.normalized_mobile == null
    && row.profile_status === 'minimal'
    && row.mobile_verified_at == null;
}
module.exports = { isOrganiserContactGuest };
