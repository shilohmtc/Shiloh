'use strict';
const crypto = require('node:crypto');
const { isDerivedGlobalCoordinator } = require('./workspaceBookingRequestRouting');
const { groupGuestStorageReady } = require('./groupGuestStorageReadiness');
const { createGroupBookingOrganiserService } = require('./groupBookingOrganiser');
function fail(code, message, httpStatus = 409) { throw Object.assign(new Error(message), { code, httpStatus }); }
function requestId(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    fail('GROUP_REQUEST_INVALID', 'Open a current group enquiry from Dashboard.', 400);
  return Number(value);
}
function createGroupPlanningBookingContext({ organiserService = createGroupBookingOrganiserService() } = {}) {
  async function resolve(q, { principal, id, revision, organiserClientId, lock = false }) {
    if (!isDerivedGlobalCoordinator(principal) || principal.permissions?.['client:lookup'] !== true)
      fail('GROUP_REQUEST_FORBIDDEN', 'Reception planning and client lookup access are required.', 403);
    const selectedId = requestId(id);
    if (!(await groupGuestStorageReady(q))) fail('GROUP_REQUEST_UNAVAILABLE', 'Group enquiry booking is not currently available. Return to Dashboard.');
    const row = (await q.query(`SELECT r.*,r.preferred_date::text AS preferred_date FROM client_planning_requests r WHERE r.id=$1${lock ? ' FOR UPDATE OF r' : ''}`, [selectedId])).rows[0];
    if (!row || row.request_kind !== 'group' || !['requested', 'planning'].includes(row.status))
      fail('GROUP_REQUEST_UNAVAILABLE', 'This group enquiry is no longer available. Refresh Dashboard.');
    const organiser = await organiserService.review(q, { adminId: principal.id || principal.calendarAuthority?.operatorAdminId, organiserClientId: row.crm_v2_client_id });
    const currentRevision = crypto.createHash('sha256').update(JSON.stringify([row, organiser])).digest('hex');
    if (revision !== undefined && revision !== currentRevision) fail('GROUP_REQUEST_CHANGED', 'The enquiry or organiser changed. Open it from Dashboard and review again.');
    if (organiserClientId !== undefined && String(organiserClientId) !== organiser.clientId)
      fail('GROUP_REQUEST_ORGANISER_MISMATCH', 'Keep the enquiry contact as organiser; choose treatment guests separately.');
    return { requestId: selectedId, revision: currentRevision, organiser, preferredDate: row.preferred_date,
      serviceDetail: row.service_detail, guestCount: row.guest_count, preferredDaypart: row.preferred_daypart,
      occasionNote: row.occasion_note, clientNote: row.client_note, returnTo: `/calendar/workspace#planning-request-${selectedId}` };
  }
  return { resolve };
}
module.exports = { createGroupPlanningBookingContext };
