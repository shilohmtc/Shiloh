const { pool } = require('../db/pool');
const crmV2 = require('./crmV2ClientService');
const { createCalendarCreateBookingService, canonicalLocalDateTimeFromInputs } = require('./calendarCreateBooking');
const { checkAuthoritativeSchedule, getConflicts } = require('./adminAvailability');
const { checkClinicHours, getDefaultActiveLocation } = require('./clinicHours');
const {
  queueCustomerBookingConfirmation,
  sendCustomerBookingConfirmationForAppointment,
} = require('./customerBookingConfirmation');
const { normalizeAppointmentNotes } = require('./appointmentNotes');

const MIN_TREATMENTS = 2;
const MAX_TREATMENTS = 10;

function multiServiceError(code, message, httpStatus = 400) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function durationMinutes(service) {
  return Number(service.duration_minutes || 0)
    + Number(service.processing_time_minutes || 0)
    + Number(service.extra_time_minutes || 0);
}

function resolveAssignments(options, rawTreatments) {
  const treatments = Array.isArray(rawTreatments) ? rawTreatments : [];
  if (treatments.length < MIN_TREATMENTS || treatments.length > MAX_TREATMENTS) {
    throw multiServiceError('MULTI_SERVICE_COUNT_INVALID', 'Add between 2 and 10 treatments for this client.');
  }
  return treatments.map((item, index) => {
    const serviceId = positiveId(item?.serviceId);
    const staffId = positiveId(item?.staffId);
    const service = options.services.find(candidate => Number(candidate.id) === serviceId);
    const practitioner = options.staff.find(candidate => Number(candidate.id) === staffId);
    if (!service || !practitioner || !service.staffIds.map(Number).includes(staffId)) {
      throw multiServiceError(
        'MULTI_SERVICE_INELIGIBLE_SELECTION',
        `Choose an eligible treatment and practitioner for Treatment ${index + 1}.`,
        409
      );
    }
    return { position: index + 1, service, practitioner, startTime: String(item?.startTime || '').trim() };
  });
}

async function resolveWindow(db, localDateTime, minutes) {
  const result = await db.query(
    `SELECT ($1::timestamp AT TIME ZONE 'Africa/Johannesburg') AS starts_at,
            (($1::timestamp + ($2::text || ' minutes')::interval) AT TIME ZONE 'Africa/Johannesburg') AS ends_at`,
    [localDateTime, minutes]
  );
  return result.rows[0];
}

async function assertAvailable({ db, staffId, locationId, startsAt, endsAt }) {
  const clinic = await checkClinicHours({ db, locationId, startsAt, endsAt });
  if (!clinic.covered) {
    throw multiServiceError('MULTI_SERVICE_OUTSIDE_CLINIC_HOURS', 'A treatment does not fit within the clinic’s booking hours.', 409);
  }
  const schedule = await checkAuthoritativeSchedule({ db, staffId, locationId, startsAt, endsAt });
  if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
    throw multiServiceError('MULTI_SERVICE_PRACTITIONER_UNAVAILABLE', 'A selected practitioner is not available for their full treatment.', 409);
  }
  if ((await getConflicts({ db, staffId, startsAt, endsAt })).length) {
    throw multiServiceError('MULTI_SERVICE_CONFLICT', 'A selected practitioner already has an appointment or blocked time then.', 409);
  }
}

function assertNoInternalConflicts(assignments) {
  for (let left = 0; left < assignments.length; left += 1) {
    for (let right = left + 1; right < assignments.length; right += 1) {
      if (Number(assignments[left].practitioner.id) !== Number(assignments[right].practitioner.id)) continue;
      const overlaps = new Date(assignments[left].startsAt) < new Date(assignments[right].endsAt)
        && new Date(assignments[right].startsAt) < new Date(assignments[left].endsAt);
      if (overlaps) {
        throw multiServiceError(
          'MULTI_SERVICE_INTERNAL_CONFLICT',
          'The same practitioner cannot provide two treatments at overlapping times.',
          409
        );
      }
    }
  }
}

function createCalendarMultiServiceBookingService({
  db = pool,
  standardBooking = createCalendarCreateBookingService({ db }),
  crmV2Service = crmV2,
  queueConfirmation = queueCustomerBookingConfirmation,
  sendConfirmation = sendCustomerBookingConfirmationForAppointment,
} = {}) {
  async function resolveOperator(adminId) {
    return standardBooking.resolveOperator(adminId);
  }

  async function listOptions(adminId) {
    const standard = await standardBooking.listBookableOptions(adminId);
    const services = standard.services.filter(item =>
      Number(item.durationMinutes) > 0
      && item.variablePrice !== true
      && item.price != null
      && Number(item.price) >= 0
      && Array.isArray(item.staffIds)
      && item.staffIds.length > 0
    );
    const eligibleStaffIds = new Set(services.flatMap(service => service.staffIds.map(Number)));
    return {
      services,
      staff: standard.staff.filter(person => eligibleStaffIds.has(Number(person.id))),
      authority: standard.authority,
    };
  }

  async function searchClients(adminId, query) {
    return standardBooking.searchClients(adminId, query);
  }

  async function prepare({ adminId, clientId, treatments: rawTreatments, date, notes } = {}) {
    const options = await listOptions(adminId);
    const canonicalClientId = positiveId(clientId);
    if (!canonicalClientId) throw multiServiceError('MULTI_SERVICE_CLIENT_REQUIRED', 'Find and select one client.');
    const client = await crmV2Service.getClientById(canonicalClientId);
    if (!client || client.status !== 'active' || !/^27[678][0-9]{8}$/.test(String(client.normalizedMobile || ''))) {
      throw multiServiceError('MULTI_SERVICE_CLIENT_UNAVAILABLE', 'The selected client is not active or has no valid mobile.', 409);
    }
    const assignments = resolveAssignments(options, rawTreatments);
    const location = await getDefaultActiveLocation(db);
    if (!location?.id) throw multiServiceError('MULTI_SERVICE_LOCATION_UNRESOLVED', 'The clinic location could not be confirmed.', 409);

    const resolved = [];
    for (const assignment of assignments) {
      const localDateTime = canonicalLocalDateTimeFromInputs(date, assignment.startTime);
      const window = await resolveWindow(db, localDateTime, Number(assignment.service.durationMinutes));
      if (new Date(window.starts_at).getTime() <= Date.now()) {
        throw multiServiceError('MULTI_SERVICE_PAST_TIME', 'Choose future start times for every treatment.', 409);
      }
      await assertAvailable({
        db,
        staffId: Number(assignment.practitioner.id),
        locationId: Number(location.id),
        startsAt: window.starts_at,
        endsAt: window.ends_at,
      });
      resolved.push({ ...assignment, startsAt: window.starts_at, endsAt: window.ends_at });
    }
    assertNoInternalConflicts(resolved);

    const payload = {
      clientId: canonicalClientId,
      clientMobile: client.normalizedMobile,
      assignments: resolved.map(item => ({
        position: item.position,
        staffId: Number(item.practitioner.id),
        serviceId: Number(item.service.id),
        durationMinutes: Number(item.service.durationMinutes),
        unitPrice: Number(item.service.price),
        startsAt: new Date(item.startsAt).toISOString(),
        endsAt: new Date(item.endsAt).toISOString(),
      })),
      locationId: Number(location.id),
      notes: normalizeAppointmentNotes(notes),
    };
    await db.query(
      `INSERT INTO admin_multi_service_booking_sessions(admin_id,payload,state)
       VALUES($1,$2::jsonb,'confirm')
       ON CONFLICT(admin_id) DO UPDATE SET payload=EXCLUDED.payload,state='confirm',updated_at=NOW()`,
      [Number(adminId), JSON.stringify(payload)]
    );
    const subtotal = resolved.reduce((sum, item) => sum + Number(item.service.price), 0);
    return {
      status: 'pending_confirmation',
      review: {
        client: {
          id: String(client.id),
          displayName: client.name,
          contactHint: `ending in ${String(client.normalizedMobile).slice(-4)}`,
        },
        assignments: resolved.map(item => ({
          position: item.position,
          service: item.service,
          practitioner: item.practitioner,
          startsAt: new Date(item.startsAt).toISOString(),
          endsAt: new Date(item.endsAt).toISOString(),
        })),
        startsAt: new Date(Math.min(...resolved.map(item => new Date(item.startsAt).getTime()))).toISOString(),
        endsAt: new Date(Math.max(...resolved.map(item => new Date(item.endsAt).getTime()))).toISOString(),
        subtotal,
      },
    };
  }

  async function discard({ adminId } = {}) {
    await resolveOperator(adminId);
    const result = await db.query(`DELETE FROM admin_multi_service_booking_sessions WHERE admin_id=$1`, [Number(adminId)]);
    return { status: result.rowCount ? 'discarded' : 'no_pending' };
  }

  async function confirm({ adminId } = {}) {
    const admin = await resolveOperator(adminId);
    const options = await listOptions(adminId);
    const connection = await db.connect();
    const appointmentIds = [];
    try {
      await connection.query('BEGIN');
      const draft = await connection.query(
        `SELECT payload FROM admin_multi_service_booking_sessions WHERE admin_id=$1 AND state='confirm' FOR UPDATE`,
        [Number(adminId)]
      );
      const payload = draft.rows[0]?.payload;
      if (!payload) throw multiServiceError('MULTI_SERVICE_NO_PENDING', 'There is no multiple-treatment review waiting to be confirmed.', 409);
      const assignments = resolveAssignments(options, (payload.assignments || []).map(item => ({
        serviceId: item.serviceId,
        staffId: item.staffId,
        startTime: '00:00',
      })));
      const snapshots = payload.assignments || [];
      const staffIds = [...new Set(assignments.map(item => Number(item.practitioner.id)))].sort((a, b) => a - b);
      for (const staffId of staffIds) await connection.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [staffId]);
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`crm-v2-client:${payload.clientId}`]);

      const clientResult = await connection.query(
        `SELECT id,name,normalized_mobile,status FROM crm_v2_clients WHERE id=$1 FOR UPDATE`,
        [payload.clientId]
      );
      const client = clientResult.rows[0];
      if (!client || client.status !== 'active' || client.normalized_mobile !== payload.clientMobile) {
        throw multiServiceError('MULTI_SERVICE_CLIENT_CHANGED', 'The selected client or mobile changed. Nothing was created; select the client again.', 409);
      }
      const location = await connection.query(`SELECT id FROM locations WHERE id=$1 AND status='active' FOR SHARE`, [payload.locationId]);
      if (location.rowCount !== 1) throw multiServiceError('MULTI_SERVICE_LOCATION_CHANGED', 'The clinic location is no longer active.', 409);

      const selections = [];
      for (let index = 0; index < assignments.length; index += 1) {
        const assignment = assignments[index];
        const selected = await connection.query(
          `SELECT sv.id AS service_id,sv.name AS service_name,sv.status AS service_status,
                  sv.duration_minutes,sv.processing_time_minutes,sv.extra_time_minutes,sv.price,sv.variable_price,
                  st.id AS staff_id,st.display_name AS staff_name,st.status AS staff_status
             FROM services sv
             JOIN staff_services ss ON ss.service_id=sv.id
             JOIN staff st ON st.id=ss.staff_id
            WHERE sv.id=$1 AND st.id=$2
            LIMIT 1 FOR SHARE OF sv,st`,
          [assignment.service.id, assignment.practitioner.id]
        );
        const row = selected.rows[0];
        const snapshot = snapshots[index] || {};
        if (!row || row.service_status !== 'active' || row.staff_status !== 'active'
          || row.variable_price || row.price == null
          || durationMinutes(row) !== Number(snapshot.durationMinutes)
          || Number(row.price) !== Number(snapshot.unitPrice)) {
          throw multiServiceError('MULTI_SERVICE_SELECTION_CHANGED', 'A treatment, practitioner, duration or price changed. Nothing was created; review again.', 409);
        }
        const startsAt = new Date(snapshot.startsAt);
        const endsAt = new Date(startsAt.getTime() + durationMinutes(row) * 60000);
        if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
          throw multiServiceError('MULTI_SERVICE_PAST_TIME', 'A reviewed start time has passed. Nothing was created.', 409);
        }
        selections.push({
          ...assignment,
          row,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        });
      }
      assertNoInternalConflicts(selections);
      for (const item of selections) {
        await assertAvailable({
          db: connection,
          staffId: Number(item.row.staff_id),
          locationId: Number(payload.locationId),
          startsAt: item.startsAt,
          endsAt: item.endsAt,
        });
      }

      const subtotal = selections.reduce((sum, item) => sum + Number(item.row.price), 0);
      const groupStartsAt = new Date(Math.min(...selections.map(item => new Date(item.startsAt).getTime()))).toISOString();
      const groupEndsAt = new Date(Math.max(...selections.map(item => new Date(item.endsAt).getTime()))).toISOString();
      const groupResult = await connection.query(
        `INSERT INTO appointment_groups(
           group_type,location_id,starts_at,ends_at,status,total_price,currency,source,created_by_admin_id,
           canonical_subtotal,discount_amount,final_total
         ) VALUES('multi_service_booking',$1,$2,$3,'scheduled',$4,'ZAR','shiloh_calendar_multi_service',$5,$4,0,$4)
         RETURNING id`,
        [payload.locationId, groupStartsAt, groupEndsAt, subtotal, Number(admin.id)]
      );
      const groupId = Number(groupResult.rows[0].id);
      for (let index = 0; index < selections.length; index += 1) {
        const item = selections[index];
        const appointment = await connection.query(
          `INSERT INTO appointments(client_id,crm_v2_client_id,source_client_name,location_id,starts_at,ends_at,status,title,notes,total_price,currency,source)
           VALUES(NULL,$1,$2,$3,$4,$5,'scheduled',$6,$7,$8,'ZAR','shiloh_calendar_multi_service') RETURNING id`,
          [client.id, client.name, payload.locationId, item.startsAt, item.endsAt, item.row.service_name, payload.notes || null, Number(item.row.price)]
        );
        const appointmentId = Number(appointment.rows[0].id);
        appointmentIds.push(appointmentId);
        await connection.query(
          `INSERT INTO appointment_services(appointment_id,service_id,position,service_name_snapshot,price_snapshot,duration_minutes_snapshot)
           VALUES($1,$2,1,$3,$4,$5)`,
          [appointmentId, item.row.service_id, item.row.service_name, Number(item.row.price), durationMinutes(item.row)]
        );
        await connection.query(
          `INSERT INTO appointment_staff(appointment_id,staff_id,position,staff_name_snapshot) VALUES($1,$2,1,$3)`,
          [appointmentId, item.row.staff_id, item.row.staff_name]
        );
        await connection.query(
          `INSERT INTO appointment_group_members(group_id,appointment_id,guest_position,allocated_price) VALUES($1,$2,$3,$4)`,
          [groupId, appointmentId, index + 1, Number(item.row.price)]
        );
        await connection.query(
          `INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason)
           VALUES($1,NULL,'scheduled',$2,'Atomic multiple-treatment client booking creation')`,
          [appointmentId, `admin:${admin.id}:${admin.display_name}`]
        );
      }
      const confirmation = await queueConfirmation(appointmentIds[0], { db: connection });
      if (!confirmation?.queued && confirmation?.status !== 'sent') {
        throw multiServiceError('MULTI_SERVICE_CONFIRMATION_QUEUE_FAILED', 'The client confirmation could not be secured, so nothing was created.', 503);
      }
      await connection.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         VALUES($1,'admin.multi_service_booking_created','appointment_group',$2,$3::jsonb)`,
        [Number(admin.id), groupId, JSON.stringify({
          clientId: Number(client.id),
          appointmentIds,
          staffIds: selections.map(item => Number(item.row.staff_id)),
          serviceIds: selections.map(item => Number(item.row.service_id)),
          canonicalSubtotal: subtotal,
          combinedClientConfirmationAppointmentId: appointmentIds[0],
          atomic: true,
        })]
      );
      await connection.query(`DELETE FROM admin_multi_service_booking_sessions WHERE admin_id=$1`, [Number(admin.id)]);
      await connection.query('COMMIT');

      let customerConfirmation;
      try { customerConfirmation = await sendConfirmation(appointmentIds[0]); }
      catch (_error) { customerConfirmation = { sent: false, deliveryStatus: 'retry_pending', retryable: true }; }
      return { status: 'created', groupId, appointmentIds, customerConfirmation, subtotal };
    } catch (error) {
      try { await connection.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      connection.release();
    }
  }

  return { resolveOperator, listOptions, searchClients, prepare, discard, confirm };
}

module.exports = {
  MIN_TREATMENTS,
  MAX_TREATMENTS,
  createCalendarMultiServiceBookingService,
  resolveAssignments,
  assertNoInternalConflicts,
  multiServiceError,
};
