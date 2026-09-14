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
const { hasCapability } = require('./calendarAuthorization');
const {
  COUPLES_DISCOUNT_CAPABILITY,
  priceCouplesBooking,
} = require('./calendarCouplesPricing');

const COUPLES_EXTERNAL_SOURCE = 'shiloh_special';
const COUPLES_EXTERNAL_ID = 'couples-massage-v1';

function couplesError(code, message, httpStatus = 400) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeGuest(value = {}) {
  const rawClientId = String(value.clientId || '').trim();
  const clientId = positiveId(value.clientId);
  if (rawClientId && !clientId) throw couplesError('COUPLES_INVALID_CLIENT', 'Select a valid client profile or clear the client selection.');
  const name = crmV2.normalizeName(value.name);
  const mobile = crmV2.normalizeMobile(value.mobile);
  const dateOfBirth = crmV2.normalizeDateOfBirth(value.dateOfBirth);
  const gender = crmV2.normalizeGender(value.gender);
  if (!name) throw couplesError('COUPLES_INVALID_NAME', 'Enter the guest’s first name and surname.');
  if (!mobile) throw couplesError('COUPLES_INVALID_MOBILE', 'Enter a valid South African mobile number for each guest.');
  return { clientId, name, mobile, dateOfBirth, gender };
}

function ensureDistinctGuests(guests) {
  if (guests.length !== 2) throw couplesError('COUPLES_TWO_GUESTS_REQUIRED', 'Add exactly two guests.');
  if (guests[0].mobile === guests[1].mobile) {
    throw couplesError('COUPLES_DUPLICATE_MOBILE', 'Guest 1 and Guest 2 need different mobile numbers.');
  }
  if (guests[0].clientId && guests[0].clientId === guests[1].clientId) {
    throw couplesError('COUPLES_DUPLICATE_CLIENT', 'Choose two different client profiles.');
  }
}

function durationMinutes(service) {
  return Number(service.duration_minutes || 0)
    + Number(service.processing_time_minutes || 0)
    + Number(service.extra_time_minutes || 0);
}

function displayPrice(value) {
  return value == null ? 'Not set' : `R${Number(value).toFixed(2)}`;
}

async function resolveWindow(db, localDateTime, minutes) {
  const result = await db.query(
    `SELECT ($1::timestamp AT TIME ZONE 'Africa/Johannesburg') AS starts_at,
            (($1::timestamp + ($2::text || ' minutes')::interval) AT TIME ZONE 'Africa/Johannesburg') AS ends_at`,
    [localDateTime, minutes]
  );
  return result.rows[0];
}

async function assertPairAvailable({ db, staffIds, locationId, startsAt, endsAt }) {
  const clinic = await checkClinicHours({ db, locationId, startsAt, endsAt });
  if (!clinic.covered) {
    throw couplesError('COUPLES_OUTSIDE_CLINIC_HOURS', 'The full couples session does not fit within the clinic’s opening hours.', 409);
  }
  for (const staffId of staffIds) {
    const schedule = await checkAuthoritativeSchedule({ db, staffId, locationId, startsAt, endsAt });
    if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
      throw couplesError('COUPLES_PRACTITIONER_UNAVAILABLE', 'One of the selected practitioners is not working for the full session. Choose another pair or time.', 409);
    }
    const conflicts = await getConflicts({ db, staffId, startsAt, endsAt });
    if (conflicts.length) {
      throw couplesError('COUPLES_CONFLICT', 'One of the selected practitioners already has an appointment or blocked time then. Choose another pair or time.', 409);
    }
  }
}

function resolveAssignments(options, rawStaffIds, rawServiceIds) {
  const staffIds = Array.isArray(rawStaffIds) ? rawStaffIds.map(positiveId) : [];
  const serviceIds = Array.isArray(rawServiceIds) ? rawServiceIds.map(positiveId) : [];
  if (staffIds.length !== 2 || staffIds.some(id => !id) || new Set(staffIds).size !== 2) {
    throw couplesError('COUPLES_TWO_PRACTITIONERS_REQUIRED', 'Choose two different practitioners.');
  }
  if (serviceIds.length !== 2 || serviceIds.some(id => !id)) {
    throw couplesError('COUPLES_TWO_TREATMENTS_REQUIRED', 'Choose one treatment for each guest.');
  }
  return serviceIds.map((serviceId, index) => {
    const service = options.services.find(item => Number(item.id) === serviceId);
    const practitioner = options.staff.find(person => Number(person.id) === staffIds[index]);
    if (!service || !practitioner || !service.staffIds.map(Number).includes(staffIds[index])) {
      throw couplesError(
        'COUPLES_INELIGIBLE_SELECTION',
        `Choose a practitioner currently eligible for Guest ${index + 1}’s treatment.`,
        409
      );
    }
    return { guestPosition: index + 1, service, practitioner };
  });
}

function createCalendarCouplesBookingService({
  db = pool,
  standardBooking = createCalendarCreateBookingService({ db }),
} = {}) {
  async function resolveOperator(adminId) {
    return standardBooking.resolveOperator(adminId);
  }

  async function listOptions(adminId) {
    const admin = await resolveOperator(adminId);
    const standard = await standardBooking.listBookableOptions(adminId);
    const groupService = standard.services.find(
      item => item.externalSource === COUPLES_EXTERNAL_SOURCE && item.externalId === COUPLES_EXTERNAL_ID
    );
    if (!groupService) {
      throw couplesError('COUPLES_NOT_CONFIGURED', 'The linked Couples booking service is not configured.', 409);
    }
    const services = standard.services.filter(item =>
      !(item.externalSource === COUPLES_EXTERNAL_SOURCE && item.externalId === COUPLES_EXTERNAL_ID)
      && Number(item.durationMinutes) > 0
      && item.variablePrice !== true
      && item.price != null
      && Number(item.price) > 0
      && Array.isArray(item.staffIds)
      && item.staffIds.length > 0
    );
    if (!services.length) {
      throw couplesError(
        'COUPLES_TREATMENTS_UNAVAILABLE',
        'No fixed-price canonical treatments are currently available for a linked Couples booking.',
        409
      );
    }
    const eligibleStaffIds = new Set(services.flatMap(service => service.staffIds.map(Number)));
    return {
      groupService,
      services,
      staff: standard.staff.filter(person => eligibleStaffIds.has(Number(person.id))),
      authority: {
        ...standard.authority,
        canApplyDiscount: hasCapability(admin.calendarAuthority, COUPLES_DISCOUNT_CAPABILITY),
      },
    };
  }

  async function searchClients(adminId, query) {
    const result = await standardBooking.searchClients(adminId, query);
    const clients = await Promise.all((result.clients || []).map(async summary => {
      const client = await crmV2.getClientById(summary.id);
      return {
        ...summary,
        name: client.name,
        mobile: client.normalizedMobile ? `+${client.normalizedMobile}` : '',
        dateOfBirth: client.dateOfBirth,
        gender: client.gender,
      };
    }));
    return { ...result, clients };
  }

  async function prepare({
    adminId,
    guests: rawGuests,
    staffIds: rawStaffIds,
    serviceIds: rawServiceIds,
    date,
    time,
    discount,
    notes,
  } = {}) {
    const options = await listOptions(adminId);
    const guests = (Array.isArray(rawGuests) ? rawGuests : []).map(normalizeGuest);
    ensureDistinctGuests(guests);
    const assignments = resolveAssignments(options, rawStaffIds, rawServiceIds);
    const pricing = priceCouplesBooking({
      prices: assignments.map(item => item.service.price),
      discount,
      canDiscount: options.authority.canApplyDiscount,
    });
    const localDateTime = canonicalLocalDateTimeFromInputs(date, time);
    const location = await getDefaultActiveLocation(db);
    if (!location?.id) throw couplesError('COUPLES_LOCATION_UNRESOLVED', 'The clinic location could not be confirmed.', 409);

    const resolved = [];
    for (const assignment of assignments) {
      const window = await resolveWindow(db, localDateTime, Number(assignment.service.durationMinutes));
      if (new Date(window.starts_at).getTime() <= Date.now()) {
        throw couplesError('COUPLES_PAST_TIME', 'Choose a future start time.');
      }
      await assertPairAvailable({
        db,
        staffIds: [Number(assignment.practitioner.id)],
        locationId: location.id,
        startsAt: window.starts_at,
        endsAt: window.ends_at,
      });
      resolved.push({ ...assignment, startsAt: window.starts_at, endsAt: window.ends_at });
    }

    const startsAt = new Date(resolved[0].startsAt).toISOString();
    const endsAt = new Date(Math.max(...resolved.map(item => new Date(item.endsAt).getTime()))).toISOString();
    const payload = {
      guests,
      assignments: resolved.map(item => ({
        guestPosition: item.guestPosition,
        staffId: Number(item.practitioner.id),
        serviceId: Number(item.service.id),
        durationMinutes: Number(item.service.durationMinutes),
        unitPrice: Number(item.service.price),
        endsAt: new Date(item.endsAt).toISOString(),
      })),
      groupServiceId: Number(options.groupService.id),
      locationId: Number(location.id),
      startsAt,
      endsAt,
      notes: normalizeAppointmentNotes(notes),
      discount: {
        type: pricing.discountType || 'none',
        value: pricing.discountValue,
        reason: pricing.discountReason,
      },
    };
    await db.query(
      `INSERT INTO admin_couples_booking_sessions(admin_id,payload,state)
       VALUES($1,$2::jsonb,'confirm')
       ON CONFLICT(admin_id) DO UPDATE SET payload=EXCLUDED.payload,state='confirm',updated_at=NOW()`,
      [Number(adminId), JSON.stringify(payload)]
    );
    return {
      status: 'pending_confirmation',
      review: {
        guests: guests.map(guest => ({ ...guest, clientId: guest.clientId ? String(guest.clientId) : null })),
        assignments: resolved.map(item => ({
          guestPosition: item.guestPosition,
          practitioner: item.practitioner,
          service: item.service,
          endsAt: new Date(item.endsAt).toISOString(),
        })),
        startsAt,
        endsAt,
        pricing,
        price: displayPrice(pricing.total),
      },
    };
  }

  async function discard({ adminId } = {}) {
    await resolveOperator(adminId);
    const result = await db.query(`DELETE FROM admin_couples_booking_sessions WHERE admin_id=$1`, [Number(adminId)]);
    return { status: result.rowCount ? 'discarded' : 'no_pending' };
  }

  async function confirm({ adminId } = {}) {
    const admin = await resolveOperator(adminId);
    const currentOptions = await listOptions(adminId);
    const client = await db.connect();
    const appointmentIds = [];
    const obligations = [];
    try {
      await client.query('BEGIN');
      const draftResult = await client.query(
        `SELECT payload FROM admin_couples_booking_sessions WHERE admin_id=$1 AND state='confirm' FOR UPDATE`,
        [Number(adminId)]
      );
      const payload = draftResult.rows[0]?.payload;
      if (!payload) throw couplesError('COUPLES_NO_PENDING', 'There is no Couples booking review waiting to be confirmed.', 409);
      const guests = payload.guests.map(normalizeGuest);
      ensureDistinctGuests(guests);
      const payloadAssignments = Array.isArray(payload.assignments) ? payload.assignments : [];
      const assignments = resolveAssignments(
        currentOptions,
        payloadAssignments.map(item => item.staffId),
        payloadAssignments.map(item => item.serviceId)
      );
      if (Number(currentOptions.groupService.id) !== Number(payload.groupServiceId)) {
        throw couplesError('COUPLES_AUTHORITY_CHANGED', 'The linked Couples booking authority changed. Nothing was created.', 409);
      }

      const lockedStaffIds = assignments.map(item => Number(item.practitioner.id)).sort((a, b) => a - b);
      for (const staffId of lockedStaffIds) await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [staffId]);
      for (const mobile of guests.map(guest => guest.mobile).sort()) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`crm-v2-mobile:${mobile}`]);
      }

      const groupServiceResult = await client.query(
        `SELECT id FROM services
          WHERE id=$1 AND status='active' AND external_source=$2 AND external_id=$3
          FOR SHARE`,
        [payload.groupServiceId, COUPLES_EXTERNAL_SOURCE, COUPLES_EXTERNAL_ID]
      );
      if (groupServiceResult.rowCount !== 1) {
        throw couplesError('COUPLES_AUTHORITY_CHANGED', 'The linked Couples booking service is no longer active. Nothing was created.', 409);
      }

      const selections = [];
      for (let index = 0; index < assignments.length; index += 1) {
        const assignment = assignments[index];
        const selected = await client.query(
          `SELECT sv.id AS service_id,sv.name AS service_name,sv.status AS service_status,
                  sv.duration_minutes,sv.processing_time_minutes,sv.extra_time_minutes,sv.price,sv.variable_price,
                  st.id AS staff_id,st.display_name AS staff_name,st.status AS staff_status
             FROM services sv
             JOIN staff_services ss ON ss.service_id=sv.id
             JOIN staff st ON st.id=ss.staff_id
            WHERE sv.id=$1 AND st.id=$2
            LIMIT 1
            FOR SHARE OF sv,st`,
          [assignment.service.id, assignment.practitioner.id]
        );
        const row = selected.rows[0];
        const snapshot = payloadAssignments[index] || {};
        if (!row || row.service_status !== 'active' || row.staff_status !== 'active') {
          throw couplesError('COUPLES_ELIGIBILITY_CHANGED', 'A treatment or practitioner is no longer eligible. Nothing was created; review the booking again.', 409);
        }
        if (
          durationMinutes(row) <= 0
          || row.variable_price
          || row.price == null
          || durationMinutes(row) !== Number(snapshot.durationMinutes)
          || Number(row.price) !== Number(snapshot.unitPrice)
        ) {
          throw couplesError('COUPLES_SERVICE_CHANGED', 'A selected treatment’s duration or price changed. Nothing was created; review the booking again.', 409);
        }
        selections.push(row);
      }

      const pricing = priceCouplesBooking({
        prices: selections.map(row => Number(row.price)),
        discount: payload.discount,
        canDiscount: currentOptions.authority.canApplyDiscount,
      });
      const location = await client.query(`SELECT id FROM locations WHERE id=$1 AND status='active' FOR SHARE`, [payload.locationId]);
      if (location.rowCount !== 1) throw couplesError('COUPLES_LOCATION_CHANGED', 'The clinic location is no longer active. Nothing was created.', 409);
      const startsAt = new Date(payload.startsAt);
      if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
        throw couplesError('COUPLES_PAST_TIME', 'The reviewed start time has passed. Nothing was created.', 409);
      }
      const endsAt = selections.map(row => new Date(startsAt.getTime() + durationMinutes(row) * 60000).toISOString());
      for (let index = 0; index < selections.length; index += 1) {
        await assertPairAvailable({
          db: client,
          staffIds: [Number(selections[index].staff_id)],
          locationId: payload.locationId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt[index],
        });
      }

      const resolvedClients = [];
      for (const guest of guests) {
        const exact = await client.query(
          `SELECT * FROM crm_v2_clients WHERE normalized_mobile=$1 AND status='active' ORDER BY id FOR UPDATE`,
          [guest.mobile]
        );
        let row;
        if (guest.clientId) {
          row = exact.rows.find(item => Number(item.id) === guest.clientId);
          if (!row || exact.rowCount !== 1) throw couplesError('COUPLES_CLIENT_CHANGED', 'A selected client or mobile changed. Nothing was created; select the client again.', 409);
          const updated = await client.query(
            `UPDATE crm_v2_clients SET name=$2,date_of_birth=COALESCE($3::date,date_of_birth),gender=COALESCE($4,gender),
                    profile_status=CASE WHEN COALESCE($3::date,date_of_birth) IS NOT NULL AND COALESCE($4,gender) IS NOT NULL THEN 'registered' ELSE 'minimal' END,updated_at=NOW(),
                    provenance=provenance || $5::jsonb WHERE id=$1 RETURNING *`,
            [row.id, guest.name, guest.dateOfBirth, guest.gender, JSON.stringify({ lastCouplesBookingProfileReview: { actorAdminId: Number(admin.id) } })]
          );
          row = updated.rows[0];
        } else {
          if (exact.rowCount) throw couplesError('COUPLES_EXISTING_CLIENT', 'That mobile already belongs to a client. Nothing was created; find and select that client instead.', 409);
          const inserted = await client.query(
            `INSERT INTO crm_v2_clients(name,normalized_mobile,date_of_birth,gender,profile_status,mobile_verified_at,source,status,provenance)
             VALUES($1,$2,$3::date,$4,CASE WHEN $3::date IS NOT NULL AND $4 IS NOT NULL THEN 'registered' ELSE 'minimal' END,NULL,'staff','active',$5::jsonb) RETURNING *`,
            [guest.name, guest.mobile, guest.dateOfBirth, guest.gender, JSON.stringify({ createdVia: 'calendar_couples_booking', actorAdminId: Number(admin.id) })]
          );
          row = inserted.rows[0];
        }
        resolvedClients.push(row);
      }
      if (Number(resolvedClients[0].id) === Number(resolvedClients[1].id)) {
        throw couplesError('COUPLES_DUPLICATE_CLIENT', 'Choose two different client profiles.');
      }

      const groupEndsAt = new Date(Math.max(...endsAt.map(value => new Date(value).getTime()))).toISOString();
      const discountingPrincipalId = pricing.discountAmount > 0 ? Number(admin.id) : null;
      const groupResult = await client.query(
        `INSERT INTO appointment_groups(
           group_type,service_id,location_id,starts_at,ends_at,status,total_price,currency,source,created_by_admin_id,
           canonical_subtotal,discount_type,discount_value,discount_amount,discount_reason,final_total,discounted_by_admin_id
         ) VALUES(
           'couples_massage',$1,$2,$3,$4,'scheduled',$5,'ZAR','shiloh_calendar_couples',$6,
           $7,$8,$9,$10,$11,$12,$13
         ) RETURNING id`,
        [
          payload.groupServiceId,
          payload.locationId,
          startsAt.toISOString(),
          groupEndsAt,
          pricing.total,
          Number(admin.id),
          pricing.subtotal,
          pricing.discountType,
          pricing.discountValue,
          pricing.discountAmount,
          pricing.discountReason,
          pricing.total,
          discountingPrincipalId,
        ]
      );
      const groupId = groupResult.rows[0].id;
      for (let index = 0; index < 2; index += 1) {
        const person = resolvedClients[index];
        const selection = selections[index];
        const appointmentResult = await client.query(
          `INSERT INTO appointments(client_id,crm_v2_client_id,source_client_name,location_id,starts_at,ends_at,status,title,notes,total_price,currency,source)
           VALUES(NULL,$1,$2,$3,$4,$5,'scheduled',$6,$7,$8,'ZAR','shiloh_calendar_couples') RETURNING id`,
          [
            person.id,
            person.name,
            payload.locationId,
            startsAt.toISOString(),
            endsAt[index],
            selection.service_name,
            payload.notes || null,
            pricing.allocations[index],
          ]
        );
        const appointmentId = appointmentResult.rows[0].id;
        appointmentIds.push(Number(appointmentId));
        await client.query(
          `INSERT INTO appointment_services(appointment_id,service_id,position,service_name_snapshot,price_snapshot,duration_minutes_snapshot)
           VALUES($1,$2,1,$3,$4,$5)`,
          [appointmentId, selection.service_id, selection.service_name, Number(selection.price), durationMinutes(selection)]
        );
        await client.query(
          `INSERT INTO appointment_staff(appointment_id,staff_id,position,staff_name_snapshot) VALUES($1,$2,1,$3)`,
          [appointmentId, selection.staff_id, selection.staff_name]
        );
        await client.query(
          `INSERT INTO appointment_group_members(group_id,appointment_id,guest_position,allocated_price) VALUES($1,$2,$3,$4)`,
          [groupId, appointmentId, index + 1, pricing.allocations[index]]
        );
        await client.query(
          `INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason)
           VALUES($1,NULL,'scheduled',$2,'Atomic Couples booking creation')`,
          [appointmentId, `admin:${admin.id}:${admin.display_name}`]
        );
        obligations.push(await queueCustomerBookingConfirmation(appointmentId, { db: client }));
        if (!obligations[index]?.queued && obligations[index]?.status !== 'sent') {
          throw couplesError('COUPLES_CONFIRMATION_QUEUE_FAILED', 'Client confirmations could not be secured, so nothing was created.', 503);
        }
      }
      await client.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         VALUES($1,'admin.couples_booking_created','appointment_group',$2,$3::jsonb)`,
        [
          Number(admin.id),
          groupId,
          JSON.stringify({
            appointmentIds,
            staffIds: selections.map(row => Number(row.staff_id)),
            serviceIds: selections.map(row => Number(row.service_id)),
            clientIds: resolvedClients.map(row => Number(row.id)),
            pricing: {
              canonicalSubtotal: pricing.subtotal,
              discountType: pricing.discountType,
              discountValue: pricing.discountValue,
              discountAmount: pricing.discountAmount,
              discountReason: pricing.discountReason,
              finalTotal: pricing.total,
              discountedByAdminId: discountingPrincipalId,
              finalAllocations: pricing.allocations,
            },
            atomic: true,
          }),
        ]
      );
      await client.query(`DELETE FROM admin_couples_booking_sessions WHERE admin_id=$1`, [Number(admin.id)]);
      await client.query('COMMIT');
      const confirmations = await Promise.all(appointmentIds.map(async appointmentId => {
        try { return await sendCustomerBookingConfirmationForAppointment(appointmentId); }
        catch (_error) { return { sent: false, deliveryStatus: 'retry_pending', retryable: true }; }
      }));
      return {
        status: 'created',
        groupId: Number(groupId),
        appointmentIds,
        confirmations,
        obligations,
        pricing,
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  return { resolveOperator, listOptions, searchClients, prepare, discard, confirm };
}

module.exports = {
  COUPLES_EXTERNAL_SOURCE,
  COUPLES_EXTERNAL_ID,
  createCalendarCouplesBookingService,
  normalizeGuest,
  ensureDistinctGuests,
  couplesError,
};
