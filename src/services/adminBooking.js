const { pool } = require("../db/pool");
const { checkAvailability, formatAvailabilityReply, checkAuthoritativeSchedule, getConflicts } = require("./adminAvailability");
const { checkClinicHours } = require("./clinicHours");
const {
  queueCustomerBookingConfirmation,
  sendCustomerBookingConfirmationForAppointment,
} = require("./customerBookingConfirmation");


function usableFixedBookingPrice(service) {
  return service
    && service.variable_price !== true
    && service.price !== null
    && service.price !== undefined
    && Number.isFinite(Number(service.price));
}

function formatLocalDateTime(value) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

async function getSingleActiveLocation() {
  const result = await pool.query(
    `SELECT id, name, timezone
       FROM locations
      WHERE status = 'active'
      ORDER BY id
      LIMIT 2`
  );
  if (result.rowCount !== 1) return null;
  return result.rows[0];
}

async function prepareAdminBooking({ adminId, clientId, staffName, serviceName, localDateTime }) {
  if (!/^\d+$/.test(String(clientId)) || Number(clientId) <= 0) {
    return { status: "invalid_client", reply: "Use the canonical CRM client number from Find client, for example: Book client 123 | Christel | Full Body Swedish | 10/08/2026 14:30" };
  }

  const clientResult = await pool.query(
    `SELECT id, display_name, date_of_birth, status
       FROM clients
      WHERE id = $1`,
    [clientId]
  );
  const client = clientResult.rows[0] || null;
  if (!client) return { status: "client_not_found", reply: `Canonical CRM client #${clientId} was not found.` };
  if (client.status !== "active") return { status: "client_inactive", reply: `CRM client #${clientId} (${client.display_name || "Unnamed client"}) is not active, so I won't create a booking.` };

  const location = await getSingleActiveLocation();
  if (!location) {
    return { status: "location_ambiguous", reply: "I can't safely create this booking because the CRM does not currently resolve to exactly one active clinic location." };
  }

  const availability = await checkAvailability({ staffName, serviceName, localDateTime, locationId: location.id });
  if (availability.status !== "available") {
    return { status: availability.status, reply: formatAvailabilityReply(availability), availability };
  }
  if (!usableFixedBookingPrice(availability.service)) {
    return {
      status: "pricing_unavailable",
      reply: "This treatment cannot be booked yet because Shiloh has not confirmed a fixed price. No appointment was created.",
      availability,
    };
  }

  if (new Date(availability.startsAt).getTime() <= Date.now()) {
    return { status: "past_time", reply: "I won't prepare a new booking in the past. Please choose a future date and time." };
  }

  await pool.query(
    `INSERT INTO admin_booking_sessions
       (admin_id, client_id, staff_id, service_id, location_id, starts_at, ends_at, state, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirm', NOW())
     ON CONFLICT (admin_id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       staff_id = EXCLUDED.staff_id,
       service_id = EXCLUDED.service_id,
       location_id = EXCLUDED.location_id,
       starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at,
       state = 'confirm',
       updated_at = NOW()`,
    [adminId, client.id, availability.staff.id, availability.service.id, location.id, availability.startsAt, availability.endsAt]
  );

  const price = availability.service.variable_price
    ? (availability.service.price == null ? "variable" : `from R${Number(availability.service.price).toFixed(2)} (variable)`)
    : (availability.service.price == null ? "not set" : `R${Number(availability.service.price).toFixed(2)}`);

  return {
    status: "pending_confirmation",
    client,
    staff: availability.staff,
    service: availability.service,
    location,
    startsAt: availability.startsAt,
    endsAt: availability.endsAt,
    reply: [
      "Booking ready for confirmation",
      `• Client: ${client.display_name || "Unnamed client"} — CRM #${client.id}`,
      `• Service: ${availability.service.name}`,
      `• Staff: ${availability.staff.display_name}`,
      `• Location: ${location.name}`,
      `• Time: ${formatLocalDateTime(availability.startsAt)} to ${new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(availability.endsAt))}`,
      `• Price: ${price}`,
      "",
      "No production appointment has been created yet.",
      "Shiloh's canonical clinic hours, practitioner schedule, appointments and blocks currently permit this slot.",
      "Reply exactly CONFIRM BOOKING to create it, or CANCEL BOOKING to discard it.",
    ].filter(Boolean).join("\n"),
  };
}

function validCrmV2Client(client) {
  return client
    && /^\d+$/.test(String(client.id || ""))
    && client.status === "active"
    && typeof client.name === "string"
    && client.name.trim().length >= 2
    && /^27[678][0-9]{8}$/.test(String(client.normalizedMobile || ""));
}

async function prepareCalendarV2Booking({ adminId, crmV2Client, staffName, serviceName, localDateTime }) {
  if (!validCrmV2Client(crmV2Client)) {
    return { status: "invalid_crm_v2_client", reply: "Select one active CRM V2 client before preparing this booking." };
  }

  const location = await getSingleActiveLocation();
  if (!location) {
    return { status: "location_ambiguous", reply: "I can't safely create this booking because the CRM does not currently resolve to exactly one active clinic location." };
  }

  const availability = await checkAvailability({ staffName, serviceName, localDateTime, locationId: location.id });
  if (availability.status !== "available") {
    return { status: availability.status, reply: formatAvailabilityReply(availability), availability };
  }
  if (!usableFixedBookingPrice(availability.service)) {
    return {
      status: "pricing_unavailable",
      reply: "This treatment cannot be booked yet because Shiloh has not confirmed a fixed price. No appointment was created.",
      availability,
    };
  }

  if (new Date(availability.startsAt).getTime() <= Date.now()) {
    return { status: "past_time", reply: "I won't prepare a new booking in the past. Please choose a future date and time." };
  }

  await pool.query(
    `INSERT INTO admin_booking_sessions
       (admin_id, client_id, crm_v2_client_id, source_client_name, client_mobile_snapshot,
        acknowledged_mobile, mobile_acknowledged_at,
        staff_id, service_id, location_id, starts_at, ends_at, state, updated_at)
     VALUES ($1, NULL, $2, $3, $4, NULL, NULL, $5, $6, $7, $8, $9, 'confirm', NOW())
     ON CONFLICT (admin_id) DO UPDATE SET
       client_id = NULL,
       crm_v2_client_id = EXCLUDED.crm_v2_client_id,
       source_client_name = EXCLUDED.source_client_name,
       client_mobile_snapshot = EXCLUDED.client_mobile_snapshot,
       acknowledged_mobile = NULL,
       mobile_acknowledged_at = NULL,
       staff_id = EXCLUDED.staff_id,
       service_id = EXCLUDED.service_id,
       location_id = EXCLUDED.location_id,
       starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at,
       state = 'confirm',
       updated_at = NOW()`,
    [
      adminId,
      crmV2Client.id,
      crmV2Client.name.trim(),
      crmV2Client.normalizedMobile,
      availability.staff.id,
      availability.service.id,
      location.id,
      availability.startsAt,
      availability.endsAt,
    ]
  );

  return {
    status: "pending_confirmation",
    client: {
      id: String(crmV2Client.id),
      name: crmV2Client.name.trim(),
      normalizedMobile: crmV2Client.normalizedMobile,
      profileStatus: crmV2Client.profileStatus || "minimal",
      status: crmV2Client.status,
    },
    staff: availability.staff,
    service: availability.service,
    location,
    startsAt: availability.startsAt,
    endsAt: availability.endsAt,
  };
}

async function cancelPendingBooking(adminId) {
  const result = await pool.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1 RETURNING admin_id`, [adminId]);
  return result.rowCount > 0;
}

async function acknowledgeCalendarV2Mobile(adminId) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query(
      `SELECT abs.crm_v2_client_id, abs.client_mobile_snapshot, abs.state,
              client.name AS client_name, client.normalized_mobile, client.status AS client_status
         FROM admin_booking_sessions abs
         JOIN crm_v2_clients client ON client.id = abs.crm_v2_client_id
        WHERE abs.admin_id = $1
          AND abs.client_id IS NULL
        FOR UPDATE OF abs, client`,
      [adminId]
    );
    const pending = result.rows[0] || null;
    if (!pending) {
      await db.query("ROLLBACK");
      return { status: "no_pending" };
    }
    if (
      pending.state !== "confirm"
      || pending.client_status !== "active"
      || !/^27[678][0-9]{8}$/.test(String(pending.normalized_mobile || ""))
      || pending.normalized_mobile !== pending.client_mobile_snapshot
    ) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [adminId]);
      await db.query("COMMIT");
      return { status: "client_mobile_changed" };
    }
    await db.query(
      `UPDATE admin_booking_sessions
          SET acknowledged_mobile = $2,
              mobile_acknowledged_at = NOW(),
              updated_at = NOW()
        WHERE admin_id = $1`,
      [adminId, pending.normalized_mobile]
    );
    await db.query("COMMIT");
    return {
      status: "acknowledged",
      client: {
        id: String(pending.crm_v2_client_id),
        name: pending.client_name,
        normalizedMobile: pending.normalized_mobile,
      },
    };
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

async function confirmAdminBooking(admin, options = {}) {
  const bookingSource = options.source || "shiloh_admin_whatsapp";
  const db = await pool.connect();
  let customerConfirmationObligation = null;
  try {
    await db.query("BEGIN");

    const sessionResult = await db.query(
      `SELECT abs.admin_id, abs.client_id, abs.staff_id, abs.service_id, abs.location_id,
              abs.starts_at, abs.ends_at, abs.state,
              c.display_name AS client_name, c.status AS client_status,
              (SELECT COALESCE(NULLIF(cc.value, ''), cc.normalized_value)
                 FROM client_contacts cc
                WHERE cc.client_id = c.id
                  AND LOWER(cc.contact_type) IN ('whatsapp', 'mobile', 'phone', 'telephone')
                ORDER BY cc.is_primary DESC, cc.verified_at DESC NULLS LAST, cc.id
                LIMIT 1) AS client_mobile,
              st.display_name AS staff_name, st.status AS staff_status,
              s.name AS service_name, s.status AS service_status,
              s.duration_minutes, s.processing_time_minutes, s.extra_time_minutes,
              s.price, s.variable_price,
              l.name AS location_name, l.status AS location_status
         FROM admin_booking_sessions abs
         JOIN clients c ON c.id = abs.client_id
         JOIN staff st ON st.id = abs.staff_id
         JOIN services s ON s.id = abs.service_id
         JOIN locations l ON l.id = abs.location_id
        WHERE abs.admin_id = $1
        FOR UPDATE OF abs`,
      [admin.id]
    );
    const session = sessionResult.rows[0] || null;
    if (!session) {
      await db.query("ROLLBACK");
      return { status: "no_pending", reply: "There is no pending admin booking to confirm. Start with: Book client CRM_ID | STAFF | SERVICE | DD/MM/YYYY HH:MM" };
    }

    await db.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [session.staff_id]);

    if (session.state !== "confirm" || session.client_status !== "active" || session.staff_status !== "active" || session.service_status !== "active" || session.location_status !== "active") {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "stale", reply: "The pending booking is no longer valid because one of its canonical CRM records changed. It was discarded; please start again." };
    }

    if (new Date(session.starts_at).getTime() <= Date.now()) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "past_time", reply: "The pending booking time has already passed, so it was discarded. Please start again with a future time." };
    }

    const eligibility = await db.query(`SELECT 1 FROM staff_services WHERE staff_id = $1 AND service_id = $2 LIMIT 1`, [session.staff_id, session.service_id]);
    if (!eligibility.rowCount) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "eligibility_changed", reply: "The staff/service eligibility changed before confirmation, so the booking was not created." };
    }

    const clinic = await checkClinicHours({ db, locationId: session.location_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (!clinic.covered) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "clinic_hours_changed", reply: "The clinic's authoritative opening hours no longer permit this time. Nothing was written. Please check holiday/business hours and run availability again." };
    }

    const schedule = await checkAuthoritativeSchedule({ db, staffId: session.staff_id, locationId: session.location_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "schedule_changed", reply: "The practitioner's authoritative working schedule no longer permits this time. Nothing was written. Please run availability again." };
    }

    const conflicts = await getConflicts({ db, staffId: session.staff_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (conflicts.length) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "conflict", reply: "A conflicting appointment or staff calendar block appeared before confirmation. Nothing was written. Please run availability again." };
    }

    const totalPrice = session.variable_price ? null : session.price;
    const appointmentResult = await db.query(
      `INSERT INTO appointments
         (client_id, location_id, starts_at, ends_at, status, title, total_price, currency, source)
       VALUES ($1, $2, $3, $4, 'scheduled', $5, $6, 'ZAR', $7)
       RETURNING id, starts_at, ends_at, status`,
      [session.client_id, session.location_id, session.starts_at, session.ends_at, session.service_name, totalPrice, bookingSource]
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
       VALUES ($1, NULL, 'scheduled', $2, 'WhatsApp Admin Assistant explicit booking confirmation')`,
      [appointment.id, `admin:${admin.id}:${admin.display_name}`]
    );

    await db.query(
      `INSERT INTO crm_audit_events
         (actor_admin_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.booking_created', 'appointment', $2, $3::jsonb)`,
      [admin.id, appointment.id, JSON.stringify({
        clientId: session.client_id,
        staffId: session.staff_id,
        serviceId: session.service_id,
        locationId: session.location_id,
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        source: bookingSource,
        authoritativeClinicHoursChecked: true,
        authoritativeScheduleChecked: true,
        canonicalAppointmentConflictsChecked: true,
        schedulingAuthority: "shiloh_canonical",
      })]
    );

    customerConfirmationObligation = await queueCustomerBookingConfirmation(appointment.id, { db });
    if (!customerConfirmationObligation?.queued && customerConfirmationObligation?.status !== "sent") {
      throw new Error(`Initial booking confirmation obligation was not durably queued: ${customerConfirmationObligation?.reason || "unknown"}`);
    }

    await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
    await db.query("COMMIT");

    let customerConfirmation;
    try {
      customerConfirmation = await sendCustomerBookingConfirmationForAppointment(appointment.id);
    } catch (error) {
      console.error("Initial booking confirmation attempt failed after durable queue", { appointmentId: appointment.id, error: error.message });
      customerConfirmation = { sent: false, deliveryStatus: "retry_pending", reason: "attempt_unavailable", retryable: true };
    }
    const customerConfirmationLine = customerConfirmation?.sent
      ? "• Client confirmation: sent"
      : customerConfirmation?.deliveryStatus === "uncertain"
        ? "• CLIENT CONFIRMATION DELIVERY STATUS UNCERTAIN — verify with the client before resending"
        : `• CLIENT CONFIRMATION NOT SENT — ${customerConfirmation?.deliveryStatus === "retry_pending" ? "automatic retry queued; " : ""}confirm manually now`;

    return {
      status: "created",
      appointmentId: appointment.id,
      customerConfirmation,
      customerConfirmationObligation,
      reply: [
        `Booking created successfully — appointment #${appointment.id}.`,
        `• Client: ${session.client_name} — CRM #${session.client_id}`,
        `• Service: ${session.service_name}`,
        `• Staff: ${session.staff_name}`,
        `• Time: ${formatLocalDateTime(session.starts_at)}`,
        `• Location: ${session.location_name}`,
        "• Scheduling authority: Shiloh Calendar",
        customerConfirmationLine,
        "",
        "The production write occurred only after explicit CONFIRM BOOKING plus final canonical clinic-hours, staff-schedule, appointment and block checks.",
      ].filter(Boolean).join("\n"),
    };
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

async function confirmCalendarV2Booking(admin, options = {}) {
  const bookingSource = options.source || "shiloh_calendar";
  const db = await pool.connect();
  let customerConfirmationObligation = null;
  try {
    await db.query("BEGIN");
    const sessionResult = await db.query(
      `SELECT abs.admin_id, abs.client_id, abs.crm_v2_client_id,
              abs.source_client_name, abs.client_mobile_snapshot,
              abs.acknowledged_mobile, abs.mobile_acknowledged_at,
              abs.staff_id, abs.service_id, abs.location_id,
              abs.starts_at, abs.ends_at, abs.state,
              st.display_name AS staff_name, st.status AS staff_status,
              s.name AS service_name, s.status AS service_status,
              s.duration_minutes, s.processing_time_minutes, s.extra_time_minutes,
              s.price, s.variable_price,
              l.name AS location_name, l.status AS location_status
         FROM admin_booking_sessions abs
         JOIN staff st ON st.id = abs.staff_id
         JOIN services s ON s.id = abs.service_id
         JOIN locations l ON l.id = abs.location_id
        WHERE abs.admin_id = $1
          AND abs.client_id IS NULL
          AND abs.crm_v2_client_id IS NOT NULL
        FOR UPDATE OF abs`,
      [admin.id]
    );
    const session = sessionResult.rows[0] || null;
    if (!session) {
      await db.query("ROLLBACK");
      return { status: "no_pending", reply: "There is no pending CRM V2 Calendar booking to confirm." };
    }

    await db.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [session.staff_id]);

    if (
      session.state !== "confirm"
      || session.staff_status !== "active"
      || session.service_status !== "active"
      || session.location_status !== "active"
    ) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "stale", reply: "The pending booking is no longer valid. It was discarded; please start again." };
    }
    if (
      !session.mobile_acknowledged_at
      || !session.acknowledged_mobile
      || session.acknowledged_mobile !== session.client_mobile_snapshot
    ) {
      await db.query("ROLLBACK");
      return { status: "mobile_acknowledgement_required", reply: "Acknowledge the current CRM V2 mobile before creating this booking." };
    }
    if (new Date(session.starts_at).getTime() <= Date.now()) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "past_time", reply: "The pending booking time has already passed, so it was discarded." };
    }

    const eligibility = await db.query(
      `SELECT 1 FROM staff_services WHERE staff_id = $1 AND service_id = $2 LIMIT 1`,
      [session.staff_id, session.service_id]
    );
    if (!eligibility.rowCount) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "eligibility_changed", reply: "The practitioner/service eligibility changed before confirmation, so the booking was not created." };
    }

    const clinic = await checkClinicHours({ db, locationId: session.location_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (!clinic.covered) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "clinic_hours_changed", reply: "The clinic's authoritative opening hours no longer permit this time. Nothing was written." };
    }
    const schedule = await checkAuthoritativeSchedule({ db, staffId: session.staff_id, locationId: session.location_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "schedule_changed", reply: "The practitioner's authoritative working schedule no longer permits this time. Nothing was written." };
    }
    const conflicts = await getConflicts({ db, staffId: session.staff_id, startsAt: session.starts_at, endsAt: session.ends_at });
    if (conflicts.length) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "conflict", reply: "A conflicting appointment or staff block appeared before confirmation. Nothing was written." };
    }

    // This is intentionally the last identity read before the appointment write.
    // The locked CRM V2 row must still be the active client/mobile that the
    // authenticated Calendar operator acknowledged in the pending session.
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
      || finalClient.status !== "active"
      || String(finalClient.id) !== String(session.crm_v2_client_id)
      || !String(finalClient.name || "").trim()
      || finalClient.normalized_mobile !== session.acknowledged_mobile
      || finalClient.normalized_mobile !== session.client_mobile_snapshot
    ) {
      await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
      await db.query("COMMIT");
      return { status: "client_mobile_changed", reply: "The CRM V2 client/mobile changed after acknowledgement. Nothing was written; prepare the booking again." };
    }

    const totalPrice = session.variable_price ? null : session.price;
    const appointmentResult = await db.query(
      `INSERT INTO appointments
         (client_id, crm_v2_client_id, source_client_name, location_id,
          starts_at, ends_at, status, title, total_price, currency, source)
       VALUES (NULL, $1, $2, $3, $4, $5, 'scheduled', $6, $7, 'ZAR', $8)
       RETURNING id, starts_at, ends_at, status`,
      [
        session.crm_v2_client_id,
        finalClient.name.trim(),
        session.location_id,
        session.starts_at,
        session.ends_at,
        session.service_name,
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
       VALUES ($1, NULL, 'scheduled', $2, 'Calendar CRM V2 explicit booking confirmation')`,
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
        finalMobileAcknowledged: true,
        authoritativeClinicHoursChecked: true,
        authoritativeScheduleChecked: true,
        canonicalAppointmentConflictsChecked: true,
        schedulingAuthority: "shiloh_canonical",
        identityModel: "crm_v2_exact_mobile",
      })]
    );

    customerConfirmationObligation = await queueCustomerBookingConfirmation(appointment.id, { db });
    if (!customerConfirmationObligation?.queued && customerConfirmationObligation?.status !== "sent") {
      throw new Error(`Initial CRM V2 booking confirmation obligation was not durably queued: ${customerConfirmationObligation?.reason || "unknown"}`);
    }

    await db.query(`DELETE FROM admin_booking_sessions WHERE admin_id = $1`, [admin.id]);
    await db.query("COMMIT");

    let customerConfirmation;
    try {
      customerConfirmation = await sendCustomerBookingConfirmationForAppointment(appointment.id);
    } catch (error) {
      console.error("Initial CRM V2 booking confirmation attempt failed after durable queue", { appointmentId: appointment.id, error: error.message });
      customerConfirmation = { sent: false, deliveryStatus: "retry_pending", reason: "attempt_unavailable", retryable: true };
    }
    return {
      status: "created",
      appointmentId: appointment.id,
      customerConfirmation,
      customerConfirmationObligation,
      reply: `Booking created successfully — appointment #${appointment.id}.`,
    };
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

module.exports = {
  prepareAdminBooking,
  confirmAdminBooking,
  cancelPendingBooking,
  prepareCalendarV2Booking,
  acknowledgeCalendarV2Mobile,
  confirmCalendarV2Booking,
  validCrmV2Client,
};
