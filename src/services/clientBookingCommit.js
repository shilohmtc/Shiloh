const { pool } = require('../db/pool');
const { getIntent, verifyService } = require('./bookingIntent');
const {
  normalizePhone,
  resolveWhatsAppBookingIdentity,
  bookingProfileComplete,
  resolveFinalBookingIdentity,
  appointmentIdentityColumns,
} = require('./whatsappBookingIdentity');
const { identityAuditMetadata } = require('./whatsappCrmV2IdentityCompat');
const { getDefaultActiveLocation } = require('./clinicHours');
const { checkAssistantBookingHours: checkClinicHours } = require('./assistantBookingHours');
const { checkAvailability, checkAuthoritativeSchedule, getConflicts } = require('./adminAvailability');
const logger = require('../lib/logger');

const BOOKING_SOURCE = 'shiloh_client_whatsapp';

function clean(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function exactTime(value = '') {
  const match = clean(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

function adminAvailabilityDateTime(isoDate, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
  const clock = exactTime(time);
  if (!clock) return null;
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year} ${clock}`;
}

function formatLocalDateTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

async function resetAcceptedIntentForNewSlot(phone, db = pool) {
  await db.query(`
    UPDATE booking_intents
       SET preferred_time = NULL,
           status = 'collecting',
           policy_version = NULL,
           policy_accepted_at = NULL,
           policy_channel = NULL,
           updated_at = NOW()
     WHERE phone = $1
       AND status = 'policy_accepted'
  `, [phone]);
}

function chooseAnotherTimeReply(reason) {
  return [
    reason,
    '',
    'Nothing has been booked. I’ve kept your service, date and practitioner preference, but cleared the unavailable time. Choose another available time and I’ll recheck it before confirmation.',
  ].join('\n');
}

async function resolveCommitContext(phone, intent) {
  const identity = await resolveWhatsAppBookingIdentity(phone);
  if (identity.status !== 'unique' || !bookingProfileComplete(identity.clientIdentity, identity.client)) {
    return {
      status: 'identity_not_ready',
      reply: 'I can’t safely create this appointment because the WhatsApp number no longer resolves to one complete Shiloh client profile. Nothing has been booked.',
    };
  }

  const serviceVerification = await verifyService(intent.service_text);
  if (!serviceVerification.verified || !serviceVerification.canonicalName) {
    return {
      status: 'service_changed',
      reply: 'The selected service can no longer be verified against Shiloh’s active CRM catalogue. Nothing has been booked.',
    };
  }

  const therapist = clean(intent.therapist_text);
  if (!therapist || therapist.toLowerCase() === 'any available therapist') {
    return {
      status: 'practitioner_unresolved',
      reply: 'I can’t safely create this appointment because the final slot no longer identifies one exact practitioner. Nothing has been booked.',
    };
  }

  const localDateTime = adminAvailabilityDateTime(intent.preferred_date, intent.preferred_time);
  if (!localDateTime) {
    return {
      status: 'time_unresolved',
      reply: 'I can’t safely create this appointment because the final selected time is no longer an exact clock time. Nothing has been booked.',
    };
  }

  const location = await getDefaultActiveLocation();
  if (!location) {
    return {
      status: 'location_unresolved',
      reply: 'I can’t safely create this appointment because Shiloh does not currently resolve to exactly one active clinic location. Nothing has been booked.',
    };
  }

  const availability = await checkAvailability({
    staffName: therapist,
    serviceName: serviceVerification.canonicalName,
    localDateTime,
    locationId: location.id,
  });
  if (availability.status !== 'available') {
    return {
      status: availability.status,
      retryTime: true,
      reply: chooseAnotherTimeReply('That slot is no longer available after the final canonical appointment, schedule and block recheck.'),
    };
  }

  if (new Date(availability.startsAt).getTime() <= Date.now()) {
    return {
      status: 'past_time',
      retryTime: true,
      reply: chooseAnotherTimeReply('That selected time has already passed.'),
    };
  }

  return {
    status: 'ready',
    clientIdentity: identity.clientIdentity,
    client: identity.client,
    location,
    availability,
  };
}

async function commitAcceptedClientBooking(phone) {
  const normalizedPhone = normalizePhone(phone);
  const initialIntent = await getIntent(normalizedPhone);
  if (!initialIntent || initialIntent.status !== 'policy_accepted') {
    return { handled: false, status: 'no_accepted_intent' };
  }

  const context = await resolveCommitContext(normalizedPhone, initialIntent);
  if (context.status !== 'ready') {
    if (context.retryTime) await resetAcceptedIntentForNewSlot(normalizedPhone);
    return { handled: true, ...context };
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const lockedIntentResult = await db.query(`
      SELECT phone, service_text, preferred_date, preferred_time, therapist_text,
             service_verified, status, policy_version, policy_accepted_at, policy_channel
        FROM booking_intents
       WHERE phone = $1
         AND status = 'policy_accepted'
       FOR UPDATE
    `, [normalizedPhone]);
    const lockedIntent = lockedIntentResult.rows[0] || null;
    if (!lockedIntent) {
      await db.query('ROLLBACK');
      return { handled: true, status: 'already_consumed', reply: 'This accepted booking request has already been processed or cleared.' };
    }

    if (
      clean(lockedIntent.service_text) !== clean(initialIntent.service_text)
      || clean(lockedIntent.preferred_date) !== clean(initialIntent.preferred_date)
      || clean(lockedIntent.preferred_time) !== clean(initialIntent.preferred_time)
      || clean(lockedIntent.therapist_text) !== clean(initialIntent.therapist_text)
    ) {
      await db.query('ROLLBACK');
      return { handled: true, status: 'intent_changed', reply: 'The booking details changed while I was confirming them, so nothing was booked. Please review the current booking details again.' };
    }

    await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [context.availability.staff.id]);

    const finalIdentity = await resolveFinalBookingIdentity({
      db,
      phone: normalizedPhone,
      identity: context.clientIdentity,
    });
    if (finalIdentity.status !== 'ready') {
      await db.query('ROLLBACK');
      return {
        handled: true,
        status: finalIdentity.status,
        reply: 'The exact canonical client identity changed before final appointment creation, so nothing was booked. Please contact the clinic team so the identity can be verified safely.',
      };
    }
    const appointmentIdentity = appointmentIdentityColumns(finalIdentity.identity, finalIdentity.client);

    const canonicalResult = await db.query(`
      SELECT st.id AS staff_id, st.display_name AS staff_name, st.status AS staff_status,
             st.client_bookable,
             s.id AS service_id, s.name AS service_name, s.status AS service_status,
             s.duration_minutes, s.processing_time_minutes, s.extra_time_minutes,
             s.price, s.variable_price,
             l.id AS location_id, l.name AS location_name, l.status AS location_status
        FROM staff st
        CROSS JOIN services s
        CROSS JOIN locations l
       WHERE st.id = $1
         AND s.id = $2
         AND l.id = $3
    `, [context.availability.staff.id, context.availability.service.id, context.location.id]);
    const canonicalResources = canonicalResult.rows[0] || null;
    const canonical = canonicalResources ? {
      ...canonicalResources,
      client_id: appointmentIdentity.clientId,
      crm_v2_client_id: appointmentIdentity.crmV2ClientId,
      client_name: appointmentIdentity.sourceClientName,
    } : null;
    if (
      !canonical
      || canonical.staff_status !== 'active'
      || canonical.service_status !== 'active'
      || canonical.location_status !== 'active'
      || canonical.client_bookable !== true
    ) {
      await db.query('ROLLBACK');
      return { handled: true, status: 'canonical_state_changed', reply: 'A canonical CRM record changed before booking creation, so nothing was booked. Please start the booking check again.' };
    }

    const eligibility = await db.query(
      'SELECT 1 FROM staff_services WHERE staff_id = $1 AND service_id = $2 LIMIT 1',
      [canonical.staff_id, canonical.service_id]
    );
    if (!eligibility.rowCount) {
      await resetAcceptedIntentForNewSlot(normalizedPhone, db);
      await db.query('COMMIT');
      return { handled: true, status: 'eligibility_changed', reply: chooseAnotherTimeReply('The selected practitioner is no longer mapped to that service in the canonical CRM.') };
    }

    const startsAt = context.availability.startsAt;
    const endsAt = context.availability.endsAt;
    if (new Date(startsAt).getTime() <= Date.now()) {
      await resetAcceptedIntentForNewSlot(normalizedPhone, db);
      await db.query('COMMIT');
      return { handled: true, status: 'past_time', reply: chooseAnotherTimeReply('The selected time has already passed.') };
    }

    const clinic = await checkClinicHours({ db, locationId: canonical.location_id, startsAt, endsAt });
    if (!clinic.covered) {
      await resetAcceptedIntentForNewSlot(normalizedPhone, db);
      await db.query('COMMIT');
      return { handled: true, status: 'clinic_hours_changed', reply: chooseAnotherTimeReply('Shiloh’s authoritative clinic hours no longer permit that time.') };
    }

    const schedule = await checkAuthoritativeSchedule({
      db,
      staffId: canonical.staff_id,
      locationId: canonical.location_id,
      startsAt,
      endsAt,
    });
    if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
      await resetAcceptedIntentForNewSlot(normalizedPhone, db);
      await db.query('COMMIT');
      return { handled: true, status: 'schedule_changed', reply: chooseAnotherTimeReply(`${canonical.staff_name}’s authoritative working schedule no longer permits that time.`) };
    }

    const conflicts = await getConflicts({ db, staffId: canonical.staff_id, startsAt, endsAt });
    if (conflicts.length) {
      await resetAcceptedIntentForNewSlot(normalizedPhone, db);
      await db.query('COMMIT');
      return { handled: true, status: 'conflict', reply: chooseAnotherTimeReply('Another appointment or staff calendar block now conflicts with that time.') };
    }

    const totalPrice = canonical.variable_price ? null : canonical.price;
    const appointment = await insertOrdinaryClientAppointment(
      db, appointmentIdentity, canonical.location_id, startsAt, endsAt, canonical.service_name, totalPrice
    );

    await db.query(`
      INSERT INTO appointment_services
        (appointment_id, service_id, position, service_name_snapshot, price_snapshot, duration_minutes_snapshot)
      VALUES ($1, $2, 1, $3, $4, $5)
    `, [appointment.id, canonical.service_id, canonical.service_name, canonical.price, canonical.duration_minutes]);

    await db.query(`
      INSERT INTO appointment_staff
        (appointment_id, staff_id, position, staff_name_snapshot)
      VALUES ($1, $2, 1, $3)
    `, [appointment.id, canonical.staff_id, canonical.staff_name]);

    await db.query(`
      INSERT INTO appointment_status_history
        (appointment_id, from_status, to_status, changed_by, reason)
      VALUES ($1, NULL, 'scheduled', $2, 'Client WhatsApp explicit policy acceptance and final booking confirmation')
    `, [appointment.id, `client:${normalizedPhone}`]);

    await db.query(`
      INSERT INTO crm_audit_events
        (action, entity_type, entity_id, metadata)
      VALUES ('client.booking_created', 'appointment', $1, $2::jsonb)
    `, [appointment.id, JSON.stringify({
      clientId: canonical.client_id,
      crmV2ClientId: canonical.crm_v2_client_id,
      clientNameSnapshot: canonical.client_name,
      identity: identityAuditMetadata(finalIdentity.identity, { resolution: finalIdentity.audit?.identityResolution || 'final_booking_authority' }),
      staffId: canonical.staff_id,
      serviceId: canonical.service_id,
      locationId: canonical.location_id,
      startsAt,
      endsAt,
      source: BOOKING_SOURCE,
      policyVersion: lockedIntent.policy_version,
      policyAcceptedAt: lockedIntent.policy_accepted_at,
      authoritativeClinicHoursChecked: true,
      authoritativeScheduleChecked: true,
      canonicalAppointmentConflictsChecked: true,
      schedulingAuthority: 'shiloh_canonical',
    })]);

    await db.query('DELETE FROM booking_intents WHERE phone = $1', [normalizedPhone]);
    await db.query('COMMIT');

    return {
      handled: true,
      status: 'created',
      appointmentId: appointment.id,
      clientIdentity: finalIdentity.identity,
      reply: [
        `Booking created successfully — appointment #${appointment.id}.`,
        `• Service: ${canonical.service_name}`,
        `• Practitioner: ${canonical.staff_name}`,
        `• Time: ${formatLocalDateTime(startsAt)}`,
        `• Location: ${canonical.location_name}`,
        '• Scheduling authority: Shiloh Calendar',
        '',
        'Your appointment is now confirmed after final Shiloh availability revalidation.',
      ].filter(Boolean).join('\n'),
    };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

async function insertOrdinaryClientAppointment(
  db, appointmentIdentity, locationId, startsAt, endsAt, serviceName, totalPrice
) {
  const result = await db.query(`
    INSERT INTO appointments
      (client_id, crm_v2_client_id, source_client_name, location_id, starts_at, ends_at, status, title, total_price, currency, source)
    VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, $8, 'ZAR', $9)
    RETURNING id, starts_at, ends_at, status
  `, [appointmentIdentity.clientId, appointmentIdentity.crmV2ClientId, appointmentIdentity.sourceClientName, locationId, startsAt, endsAt, serviceName, totalPrice, BOOKING_SOURCE]);
  return result.rows[0];
}

function isCommitRetry(text = '') {
  return /^(retry booking|retry|continue booking|complete booking|finish booking)$/i.test(clean(text));
}

function isCommitCancel(text = '') {
  return /^(cancel booking|cancel request|stop|never mind|nevermind)$/i.test(clean(text));
}

async function processAcceptedClientBookingMessage(phone, text) {
  const intent = await getIntent(normalizePhone(phone));
  if (!intent || intent.status !== 'policy_accepted') return { handled: false };

  if (isCommitCancel(text)) {
    await pool.query('DELETE FROM booking_intents WHERE phone = $1 AND status = $2', [normalizePhone(phone), 'policy_accepted']);
    return { handled: true, status: 'cancelled', reply: 'No problem — I cleared that accepted booking request. No appointment was created.' };
  }

  if (!isCommitRetry(text)) {
    return {
      handled: true,
      status: 'awaiting_retry',
      reply: 'Your booking terms were accepted, but the final appointment creation still needs to complete. Reply *RETRY BOOKING* to re-run the final availability checks, or *CANCEL BOOKING* to stop.',
    };
  }

  try {
    return await commitAcceptedClientBooking(phone);
  } catch (error) {
    logger.error({ err: error }, 'Retrying accepted client booking failed');
    return {
      handled: true,
      status: 'commit_failed',
      reply: 'I couldn’t safely complete the final booking write, so I have not claimed an appointment. Your accepted request is still pending. Reply *RETRY BOOKING* to try the final checks again, or *CANCEL BOOKING* to stop.',
    };
  }
}

module.exports = {
  BOOKING_SOURCE,
  adminAvailabilityDateTime,
  commitAcceptedClientBooking,
  exactTime,
  insertOrdinaryClientAppointment,
  processAcceptedClientBookingMessage,
  resetAcceptedIntentForNewSlot,
};
