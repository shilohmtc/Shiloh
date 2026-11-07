'use strict';
const crypto = require('node:crypto');
const crm = require('./crmV2ClientService');
const { PostgresCrmV2ClientRepository, CLIENT_COLUMNS } = require('../repositories/crmV2ClientRepository');
const { clientRevision } = require('./workspaceClientMutations');
const { isOrganiserContactGuest } = require('./crmV2GuestProfile');
function fail(code, message) { throw Object.assign(new Error(message), { code, httpStatus: 409 }); }
function positiveId(value) { return ['string','number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }
// Internal component: caller owns the authorized, reviewed booking transaction.
// It does not commit, resolve people by name, create appointments or send notices.
async function resolveGuestWithoutMobile(q, { guest, adminId, reviewKey, guestPosition } = {}) {
  const actor = positiveId(adminId), position = positiveId(guestPosition);
  if (!actor || !position || position > 10 || typeof reviewKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(String(reviewKey || '')) || guest?.noMobile !== true || String(guest.mobile ?? '').trim())
    fail('GROUP_GUEST_REVIEW_REQUIRED', 'Review this guest without a mobile and the organiser before continuing.');
  const name = crm.normalizeName(guest.name), dateOfBirth = crm.normalizeDateOfBirth(guest.dateOfBirth), gender = crm.normalizeGender(guest.gender);
  if (!name) fail('GROUP_INVALID_NAME', 'Enter the guest’s first name and surname.');
  const hasSelection = guest.clientId != null && guest.clientId !== '';
  const selectedId = hasSelection ? positiveId(guest.clientId) : null;
  if (hasSelection && !selectedId) fail('GROUP_INVALID_CLIENT', 'Choose a valid guest profile.');
  const repository = new PostgresCrmV2ClientRepository(q);
  if (selectedId) {
    const current = await repository.getClientById(selectedId, { forUpdate: true });
    const relationship = (await q.query("SELECT 1 FROM crm_v2_client_relationships WHERE client_id=$1 AND relationship_type='clinic' AND owner_staff_id IS NULL AND status='active'", [selectedId])).rows;
    if (!current || current.status !== 'active' || !isOrganiserContactGuest(current) || relationship.length !== 1)
      fail('GROUP_GUEST_CHANGED', 'Choose the current active guest profile again.');
    if (guest.profileRevision !== clientRevision(current)) fail('GROUP_GUEST_CHANGED', 'The guest profile changed. Review it again before creating the booking.');
    const effectiveDob = dateOfBirth || current.date_of_birth, effectiveGender = gender || current.gender;
    if (current.name === name && (current.date_of_birth || null) === (effectiveDob || null) && (current.gender || null) === (effectiveGender || null)) return { client: current, status: 'selected' };
    await crm.createCrmV2ClientService({ repository }).updateClient({ clientId: selectedId, name, mobile: '', dateOfBirth: effectiveDob, gender: effectiveGender, actorReference: `workspace_admin:${actor}` });
    const fields = [];
    if (current.name !== name) fields.push('name');
    if ((current.date_of_birth || null) !== (effectiveDob || null)) fields.push('dateOfBirth');
    if ((current.gender || null) !== (effectiveGender || null)) fields.push('gender');
    await q.query("INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'booking.guest_profile_updated','crm_v2_client',$2,$3::jsonb)", [actor, selectedId, JSON.stringify({ reviewKey, guestPosition: position, fields })]);
    return { client: await repository.getClientById(selectedId), status: 'updated' };
  }
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ actor, reviewKey, position, name, dateOfBirth, gender })).digest('hex');
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`group-guest:${actor}:${reviewKey}:${position}`]);
  const prior = (await q.query(`SELECT ${CLIENT_COLUMNS} FROM crm_v2_clients WHERE provenance->'groupGuestCreation'->>'reviewKey'=$1
    AND provenance->'groupGuestCreation'->>'actorAdminId'=$2 AND provenance->'groupGuestCreation'->>'guestPosition'=$3 ORDER BY id LIMIT 2 FOR UPDATE`, [reviewKey, String(actor), String(position)])).rows;
  if (prior.length) {
    const row = prior[0];
    if (prior.length !== 1 || row.provenance?.groupGuestCreation?.fingerprint !== fingerprint || row.status !== 'active' || !isOrganiserContactGuest(row))
      fail('GROUP_GUEST_RETRY_MISMATCH', 'This reviewed guest creation has changed. Check the existing booking before another attempt.');
    return { client: row, status: 'replayed' };
  }
  const provenance = { createdVia: 'calendar_group_booking', groupGuestCreation: { actorAdminId: actor, reviewKey, guestPosition: position, fingerprint } };
  const row = (await q.query(`INSERT INTO crm_v2_clients(name,normalized_mobile,date_of_birth,gender,profile_status,mobile_verified_at,source,status,provenance,contact_mode)
    VALUES($1,NULL,$2::date,$3,'minimal',NULL,'staff','active',$4::jsonb,'organiser') RETURNING ${CLIENT_COLUMNS}`, [name, dateOfBirth, gender, JSON.stringify(provenance)])).rows[0];
  await q.query("INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'booking.guest_profile_created','crm_v2_client',$2,$3::jsonb)", [actor, row.id, JSON.stringify({ reviewKey, guestPosition: position, fingerprint, noMobile: true })]);
  return { client: row, status: 'created' };
}
module.exports = { resolveGuestWithoutMobile };
