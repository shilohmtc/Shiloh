'use strict';
// Read-only availability, not migration execution or permission authority.
// New guest creation must still recheck current staff, client and booking rules.
const READINESS_SQL = `SELECT
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.crm_v2_clients') AND attname='normalized_mobile' AND NOT attnotnull AND NOT attisdropped)
  AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.crm_v2_clients') AND attname='contact_mode' AND attnotnull AND NOT attisdropped)
  AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.crm_v2_clients') AND conname='crm_v2_contact_identity_valid' AND convalidated)
  AND (SELECT COUNT(*) FROM pg_attribute WHERE attrelid=to_regclass('public.appointment_group_booking_contacts') AND attname IN ('appointment_group_id','organiser_crm_v2_client_id','created_by_admin_id','revision') AND NOT attisdropped)=4
  AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.appointment_group_booking_contacts') AND contype='f' AND confrelid=to_regclass('public.crm_v2_clients'))
  AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.appointment_group_booking_contacts') AND contype='f' AND confrelid=to_regclass('public.appointment_groups'))
  AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.appointment_group_booking_contacts') AND contype='f' AND confrelid=to_regclass('public.staff_admin_accounts'))
  AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.appointment_lifecycle') AND attname='phone' AND NOT attnotnull AND NOT attisdropped)
  AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.appointment_lifecycle') AND attname='delivery_recipient_role' AND attnotnull AND NOT attisdropped)
  AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.appointment_lifecycle') AND attname='organiser_group_id' AND NOT attisdropped)
  AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.appointment_lifecycle') AND conname='appointment_lifecycle_recipient_valid' AND convalidated)
  AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.appointment_lifecycle') AND contype='f' AND confrelid=to_regclass('public.appointment_group_booking_contacts')) AS ready`;
async function groupGuestStorageReady(db) {
  try { return (await db.query(READINESS_SQL)).rows[0]?.ready === true; }
  catch (_) { return false; }
}
module.exports = { groupGuestStorageReady, READINESS_SQL };
