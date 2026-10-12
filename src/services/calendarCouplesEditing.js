const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { createWorkspaceAppointmentNotesService } = require('./workspaceAppointmentNotes');
const { createCalendarOperationalMutationService } = require('./calendarOperationalMutations');

function fail(code, message, httpStatus = 409) {
  return Object.assign(new Error(message), { code: `CALENDAR_COUPLES_EDIT_${code}`, httpStatus });
}
function id(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw fail('INVALID_ID', 'Choose a valid appointment.', 400);
  return number;
}
function revision(value) { return new Date(value).toISOString(); }

function createCalendarCouplesEditingService({ db = pool, now = () => new Date(), clinicHours, authoritativeSchedule } = {}) {
  async function context(queryable, adminId, appointmentId, lock = false) {
    const parent = await queryable.query(`SELECT g.* FROM appointment_groups g
      JOIN appointment_group_members m ON m.group_id=g.id
      WHERE m.appointment_id=$1 AND g.group_type='couples_massage' ${lock ? 'FOR UPDATE OF g' : ''}`, [id(appointmentId)]);
    if (parent.rows.length !== 1) throw fail('NOT_FOUND', 'This appointment has no linked couples booking.', 404);
    const group = parent.rows[0];
    const result = await queryable.query(`SELECT a.*,m.guest_position FROM appointments a
      JOIN appointment_group_members m ON m.appointment_id=a.id
      WHERE m.group_id=$1 ORDER BY a.id ${lock ? 'FOR UPDATE OF a,m' : ''}`, [group.id]);
    const members = result.rows;
    if (members.length !== 2 || new Set(members.map(row => Number(row.guest_position))).size !== 2
      || members.some(row => !['scheduled','confirmed','completed'].includes(row.status))) {
      throw fail('FINAL', 'This pair needs Reception review before editing. Nothing has changed.');
    }
    // Reuse the current notes authority for EACH guest before returning any pair data.
    const scopedDb = { query: queryable.query.bind(queryable), connect: db.connect.bind(db) };
    const notes = createWorkspaceAppointmentNotesService({ db: scopedDb });
    for (const member of members) await notes.get({ adminId, appointmentId: member.id });
    const operations = createCalendarOperationalMutationService({ db: scopedDb, now, clinicHours, authoritativeSchedule });
    const operator = await operations.resolveOperator(adminId, queryable);
    const approvals = await queryable.query(`SELECT status FROM appointment_booking_approvals
      WHERE appointment_id=ANY($1::bigint[])`, [members.map(row => row.id)]);
    const canMove = ['scheduled','confirmed'].includes(group.status)
      && members.every(row => ['scheduled','confirmed'].includes(row.status)
        && revision(row.starts_at) === revision(group.starts_at))
      && new Date(group.starts_at) > now()
      && !approvals.rows.some(row => ['pending','awaiting_client_confirmation'].includes(row.status))
      && operator.mutationCapability.operations.includes('appointment:reschedule');
    return { group, members, canMove };
  }
  function view({ group, members, canMove }) {
    return { groupId: Number(group.id), revision: revision(group.updated_at), startsAt: revision(group.starts_at), canMove,
      explanation: canMove ? 'Move both visits together without changing their durations. Each guest keeps separate booking notes.'
        : 'You can update booking notes. Date, time, treatments, prices and completion records stay protected.',
      members: [...members].sort((a,b) => a.guest_position-b.guest_position).map(row => ({
        appointmentId: Number(row.id), name: row.source_client_name || `Guest ${row.guest_position}`,
        treatment: row.title || 'Treatment', status: row.status, startsAt: revision(row.starts_at), endsAt: revision(row.ends_at),
        notes: row.notes || '', revision: revision(row.updated_at),
      })) };
  }
  async function get({ adminId, appointmentId }) { return view(await context(db, adminId, appointmentId)); }
  async function update({ adminId, appointmentId, input = {} }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['requestId','expectedGroupRevision','members','startsAt'].includes(key))
      || !/^[A-Za-z0-9_-]{8,80}$/.test(String(input.requestId || '')) || !Array.isArray(input.members) || input.members.length !== 2
      || input.members.some(row => !row || Object.keys(row).some(key => !['appointmentId','expectedRevision','notes'].includes(key)))) {
      throw fail('INVALID_INPUT', 'Reload the pair and use the supported booking fields.', 400);
    }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ appointmentId: id(appointmentId), input })).digest('hex');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`couples-edit:${adminId}:${input.requestId}`]);
      const current = await context(client, adminId, appointmentId, true);
      const { group, members } = current;
      const requestedIds = input.members.map(row => id(row.appointmentId));
      if (new Set(requestedIds).size !== 2 || members.some(row => !requestedIds.includes(Number(row.id)))) {
        throw fail('MEMBERS_CHANGED', 'The linked pair changed. Reload Calendar.');
      }
      const replay = await client.query(`SELECT metadata FROM crm_audit_events WHERE actor_admin_id=$1
        AND action='calendar.couples_booking_edited' AND metadata->>'requestId'=$2 ORDER BY id LIMIT 1`, [adminId,input.requestId]);
      if (replay.rows.length) {
        if (replay.rows[0].metadata.requestFingerprint !== fingerprint) throw fail('IDEMPOTENCY_MISMATCH', 'Use a new request for different edits.');
        await client.query('COMMIT');
        return { status: 'idempotent_replay', appointmentIds: members.map(row => Number(row.id)), moved: false };
      }
      if (input.expectedGroupRevision !== revision(group.updated_at) || members.some(row =>
        input.members.find(item => Number(item.appointmentId) === Number(row.id)).expectedRevision !== revision(row.updated_at))) {
        throw fail('STALE', 'One of the appointments changed. Reload the pair before saving.');
      }
      const moved = input.startsAt != null && input.startsAt !== revision(group.starts_at);
      if (moved && !current.canMove) throw fail('FINAL', 'This pair supports booking notes only. Its time cannot be changed here.');
      const scopedDb = { query: client.query.bind(client), connect: db.connect.bind(db) };
      const notes = createWorkspaceAppointmentNotesService({ db: scopedDb, transaction: client });
      const operations = createCalendarOperationalMutationService({ db: scopedDb, transaction: client, now, clinicHours, authoritativeSchedule });
      if (moved) {
        // Lock the whole staff set in the same order as the canonical operation.
        const staff = await client.query(`SELECT DISTINCT staff_id FROM appointment_staff
          WHERE appointment_id=ANY($1::bigint[]) ORDER BY staff_id`, [members.map(row => row.id)]);
        for (const row of staff.rows) await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [row.staff_id]);
      }
      for (const member of members) {
        const requested = input.members.find(row => Number(row.appointmentId) === Number(member.id));
        let expectedRevision = requested.expectedRevision;
        if (moved) {
          const result = await operations.reschedule({ adminId, appointmentId: member.id, expectedRevision,
            startsAt: input.startsAt, requestId: `${input.requestId}_move_${member.guest_position}` });
          expectedRevision = result.revision;
        }
        await notes.update({ adminId, appointmentId: member.id, expectedRevision, notes: requested.notes,
          requestId: `${input.requestId}_notes_${member.guest_position}` });
      }
      if (moved) await client.query(`UPDATE appointment_groups SET starts_at=$2,
        ends_at=(SELECT MAX(a.ends_at) FROM appointments a JOIN appointment_group_members m ON m.appointment_id=a.id WHERE m.group_id=$1),
        updated_at=NOW() WHERE id=$1`, [group.id, input.startsAt]);
      await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
        VALUES($1,'calendar.couples_booking_edited','appointment_group',$2,$3::jsonb)`, [adminId, group.id,
        JSON.stringify({ requestId: input.requestId, requestFingerprint: fingerprint, appointmentIds: members.map(row => Number(row.id)), moved })]);
      await client.query('COMMIT');
      return { status: 'updated', appointmentIds: members.map(row => Number(row.id)), moved };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }
  return { get, update };
}
module.exports = { createCalendarCouplesEditingService };
