const { pool } = require('../db/pool');
const { checkAuthoritativeSchedule, getConflicts } = require('./adminAvailability');
const { checkClinicHours } = require('./clinicHours');
const {
  queueCustomerBookingConfirmation,
  sendCustomerBookingConfirmationForAppointment,
} = require('./customerBookingConfirmation');
const { normalizeAppointmentNotes } = require('./appointmentNotes');
const bookingPolicyAcceptance = require('./bookingPolicyAcceptance');

function isCanonicalMobile(value) {
  return /^27[678][0-9]{8}$/.test(String(value || ''));
}

async function confirmCalendarV2BookingDirect(admin, options = {}) {
  const bookingSource = options.source || 'shiloh_calendar';
  const appointmentNotes = normalizeAppointmentNotes(options.notes);
  const db = await pool.connect();
  let customerConfirmationObligation = null;
  let policyAcceptance = null;
  try {
    await db.query('BEGIN');
    const sessionResult = await db.query(
      `SELECT abs.admin_id, abs.client_id, abs.crm_v2_client_id,
              abs.source_client_name, abs.client_mobile_snapshot,
              abs.staff_id, abs.service_id, abs.location_id,
              abs.starts_at, abs.ends_at, abs.state,
              st.display_name AS staff_name, st.status AS staff_status,
              s.name AS service_name, s.status AS service_status,
              s.duration_minutes, s.processing_time_minutes, s.extra_time_minutes,
              s.price, s.variable_price, sc.name AS category_name,
              l.name AS location_name, l.status AS location_status
         FROM admin_booking_sessions abs
         JOIN staff st ON st.id = abs.staff_id
         JOIN services s ON s.id = abs.service_id
         LEFT JOIN service_categories sc ON sc.id = s.category_id
         JOIN locations l ON l.id = abs.location_id
        WHERE abs.admin_id = $1
          AND abs.client_id IS NULL
          AND abs.crm_v2_client_id IS NOT NULL
        FOR UPDATE OF abs`,
      [admin.id]
    );
    const session = sessionResult.rows[0] || null;
    if (!session) {
      await db.query('ROLLBACK');
      return { status: 'no_pending', reply: 'There is no pending CRM V2 Calendar booking to confirm.' };
    }

    await db.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [session.staff_id]);

    if (
      session.state !== 'confirm'
      || session.staff_status !== 'active'
      || session.service_status !== 'active'
      || session.location_status !== 'active'
    ) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'stale', reply: 'The pending booking is no longer valid. It was discarded; please start again.' };
    }

    if (new Date(session.starts_at).getTime() <= Date.now()) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'past_time', reply: 'The pending booking time has already passed, so it was discarded.' };
    }

    const eligibility = await db.query(
      `SELECT 1 FROM staff_services WHERE staff_id = $1 AND service_id = $2 LIMIT 1`,
      [session.staff_id, session.service_id]
    );
    if (!eligibility.rowCount) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'eligibility_changed', reply: 'The practitioner/service eligibility changed before creation, so the booking was not created.' };
    }

    const clinic = await checkClinicHours({ db, locationId: session.location_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (!clinic.covered) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'clinic_hours_changed', reply: "The clinic's authoritative opening hours no longer permit this time. Nothing was written." };
    }
    const schedule = await checkAuthoritativeSchedule({ db, staffId: session.staff_id, locationId: session.location_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'schedule_changed', reply: "The practitioner's authoritative working schedule no longer permits this time. Nothing was written." };
    }
    const conflicts = await getConflicts({ db, staffId: session.staff_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (conflicts.length) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'conflict', reply: 'A conflicting appointment or staff block appeared before creation. Nothing was written.' };
    }

    const finalClientResult = await db.query(
      `SELECT id, name, normalized_mobile, status
         FROM crm_v2_clients
        WHERE id = $1
        FOR UPDATE`,
      [session.crm_v2_client_id]
    );
    const finalClient = finalClientResult.rows[0] || null;
    if (
      !finalClient
      || finalClient.status !== 'active'
      || String(finalClient.id) !== String(session.crm_v2_client_id)
      || !String(finalClient.name || '').trim()
      || !isCanonicalMobile(finalClient.normalized_mobile)
      || finalClient.normalized_mobile !== session.client_mobile_snapshot
    ) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'client_mobile_changed', reply: 'The canonical CRM V2 client/mobile changed before creation. Nothing was written; prepare the booking again.' };
    }

    if (!String(session.category_name || '').trim()) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'catalogue_incomplete', reply: 'This treatment cannot be booked yet because it has no category in Shiloh’s canonical service catalogue. No appointment was created.' };
    }

    if (session.variable_price === true || session.price === null || session.price === undefined || !Number.isFinite(Number(session.price))) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query('COMMIT');
      return { status: 'pricing_unavailable', reply: 'This treatment cannot be booked yet because Shiloh has not confirmed a fixed price. No appointment was created.' };
    }

    const totalPrice = session.variable_price ? null : session.price;
    const appointmentResult = await db.query(
      `INSERT INTO appointments
         (client_id, crm_v2_client_id, source_client_name, location_id,
          starts_at, ends_at, status, title, notes, total_price, currency, source)
       VALUES (NULL, $1, $2, $3, $4, $5, 'scheduled', $6, $7, $8, 'ZAR', $9)
       RETURNING id, starts_at, ends_at, status`,
      [
        session.crm_v2_client_id,
        finalClient.name.trim(),
        session.location_id,
        session.starts_at,
        session.ends_at,
        session.service_name,
        appointmentNotes,
        totalPrice,
        bookingSource,
      ]
    );
    const appointment = appointmentResult.rows[0];

    await db.query(
      `INSERT INTO appointment_services
         (appointment_id, service_id, position, service_name_snapshot, price_snapshot, duration_minutes_snapshot)
       VALUES ($1, $2, 1, $3, $4, $5)`,
      [appointment.id, session.service_id, session.service_name, session.price, session.duration_minutes]
    );
    await db.query(
      `INSERT INTO appointment_staff
         (appointment_id, staff_id, position, staff_name_snapshot)
       VALUES ($1, $2, 1, $3)`,
      [appointment.id, session.staff_id, session.staff_name]
    );
    await db.query(
      `INSERT INTO appointment_status_history
         (appointment_id, from_status, to_status, changed_by, reason)
       VALUES ($1, NULL, 'scheduled', $2, 'Calendar CRM V2 direct booking creation')`,
      [appointment.id, `admin:${admin.id}:${admin.display_name}`]
    );
    await db.query(
      `INSERT INTO crm_audit_events
         (actor_admin_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.booking_created', 'appointment', $2, $3::jsonb)`,
      [admin.id, appointment.id, JSON.stringify({
        crmV2ClientId: Number(session.crm_v2_client_id),
        legacyClientId: null,
        staffId: Number(session.staff_id),
        serviceId: Number(session.service_id),
        locationId: Number(session.location_id),
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        source: bookingSource,
        notesPresent: Boolean(appointmentNotes),
        noteLength: appointmentNotes ? appointmentNotes.length : 0,
        finalCanonicalMobileRechecked: true,
        authoritativeClinicHoursChecked: true,
        authoritativeScheduleChecked: true,
        canonicalAppointmentConflictsChecked: true,
        schedulingAuthority: 'shiloh_canonical',
        identityModel: 'crm_v2_exact_mobile',
      })]
    );

    policyAcceptance = await bookingPolicyAcceptance.ensureForAppointment({
      queryable: db,
      appointmentId: appointment.id,
      crmV2ClientId: Number(session.crm_v2_client_id),
      phone: finalClient.normalized_mobile,
      adminId: Number(admin.id),
    });

    customerConfirmationObligation = await queueCustomerBookingConfirmation(appointment.id, { db });
    if (!customerConfirmationObligation?.queued && customerConfirmationObligation?.status !== 'sent') {
      throw new Error(`Initial CRM V2 booking confirmation obligation was not durably queued: ${customerConfirmationObligation?.reason || 'unknown'}`);
    }

    await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
    await db.query('COMMIT');

    let customerConfirmation;
    try {
      customerConfirmation = await sendCustomerBookingConfirmationForAppointment(appointment.id);
    } catch (error) {
      console.error('Initial CRM V2 booking confirmation attempt failed after durable queue', { appointmentId: appointment.id, error: error.message });
      customerConfirmation = { sent: false, deliveryStatus: 'retry_pending', reason: 'attempt_unavailable', retryable: true };
    }
    return {
      status: 'created',
      appointmentId: appointment.id,
      customerConfirmation,
      customerConfirmationObligation,
      policyAcceptance,
      reply: `Booking created successfully — appointment #${appointment.id}.`,
    };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

module.exports = {
  confirmCalendarV2BookingDirect,
  isCanonicalMobile,
};