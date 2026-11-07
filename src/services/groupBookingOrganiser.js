'use strict';
const crypto = require('node:crypto');
const { resolveCalendarAuthority, hasCapability, CALENDAR_CAPABILITIES } = require('./calendarAuthorization');
const { normalizeMobile } = require('./crmV2ClientService');
function fail(code, message, httpStatus = 409) { throw Object.assign(new Error(message), { code, httpStatus }); }
function id(value) { if (!['string','number'].includes(typeof value) || !/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('GROUP_CONTACT_INVALID', 'Select a valid organiser.', 400); return Number(value); }
function revision(row) { return crypto.createHash('sha256').update(JSON.stringify([String(row.id), row.normalized_mobile, row.status, new Date(row.updated_at).toISOString()])).digest('hex'); }
// The caller owns the transaction. This service never commits, dispatches or grants a client session.
function createGroupBookingOrganiserService({ authorityResolver = resolveCalendarAuthority } = {}) {
  async function operator(q, adminId) {
    const principal = await authorityResolver(q, id(adminId));
    const a = principal?.calendarAuthority;
    if (!a || a.calendarScope !== 'all_business' || a.serviceScope !== 'all_services'
      || !hasCapability(a, CALENDAR_CAPABILITIES.BOOKING_CREATE) || !hasCapability(a, CALENDAR_CAPABILITIES.CLIENT_LOOKUP))
      fail('GROUP_CONTACT_FORBIDDEN', 'Current staff access does not permit this group organiser action.', 403);
    return principal;
  }
  async function contact(q, clientId, lock = false) {
    const result = await q.query(`SELECT c.* FROM crm_v2_clients c WHERE c.id=$1 AND c.status='active'
      AND EXISTS(SELECT 1 FROM crm_v2_client_relationships r WHERE r.client_id=c.id AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL AND r.status='active')${lock ? ' FOR SHARE OF c' : ''}`, [id(clientId)]);
    const row = result.rows[0];
    if (!row || !normalizeMobile(row.normalized_mobile) || normalizeMobile(row.normalized_mobile) !== row.normalized_mobile || (row.contact_mode != null && row.contact_mode !== 'direct')) fail('GROUP_CONTACT_UNAVAILABLE', 'Choose an active organiser with their own mobile number.');
    return row;
  }
  async function review(q, { adminId, organiserClientId }) {
    await operator(q, adminId);
    const row = await contact(q, organiserClientId);
    return { clientId: String(row.id), name: row.name, mobile: row.normalized_mobile, revision: revision(row) };
  }
  async function bind(q, { adminId, groupId, reviewedOrganiser }) {
    const staff = await q.query('SELECT id FROM staff_admin_accounts WHERE id=$1 AND active=TRUE FOR SHARE', [id(adminId)]);
    if (staff.rows.length !== 1) fail('GROUP_CONTACT_FORBIDDEN', 'Current staff access does not permit this group organiser action.', 403);
    await operator(q, adminId);
    const group = (await q.query('SELECT id,source,created_by_admin_id FROM appointment_groups WHERE id=$1 FOR UPDATE', [id(groupId)])).rows[0];
    if (!group || group.source !== 'shiloh_calendar_group' || Number(group.created_by_admin_id) !== id(adminId)) fail('GROUP_CONTACT_BOOKING_FORBIDDEN', 'Review the original group booking before setting its organiser.', 403);
    const row = await contact(q, reviewedOrganiser?.clientId, true);
    if (reviewedOrganiser?.revision !== revision(row)) fail('GROUP_CONTACT_CHANGED', 'The organiser contact changed. Review it again before creating the booking.');
    const existing = (await q.query('SELECT organiser_crm_v2_client_id,created_by_admin_id FROM appointment_group_booking_contacts WHERE appointment_group_id=$1 FOR UPDATE', [id(groupId)])).rows[0];
    if (existing) {
      if (Number(existing.organiser_crm_v2_client_id) !== Number(row.id) || Number(existing.created_by_admin_id) !== id(adminId)) fail('GROUP_CONTACT_RETRY_MISMATCH', 'This booking already has a different organiser decision.');
      return { status: 'unchanged', clientId: String(row.id) };
    }
    await q.query('INSERT INTO appointment_group_booking_contacts(appointment_group_id,organiser_crm_v2_client_id,created_by_admin_id) VALUES($1,$2,$3)', [id(groupId), row.id, id(adminId)]);
    await q.query("INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'booking.group_organiser_bound','appointment_group',$2,$3::jsonb)", [id(adminId), id(groupId), JSON.stringify({ organiserClientId: String(row.id), contactRevision: reviewedOrganiser.revision })]);
    return { status: 'bound', clientId: String(row.id) };
  }
  return { review, bind };
}
module.exports = { createGroupBookingOrganiserService };
