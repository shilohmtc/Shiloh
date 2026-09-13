const { pool } = require('../db/pool');
const crmV2ClientService = require('./crmV2ClientService');
const {
  prepareCalendarV2Booking,
  confirmCalendarV2Booking,
  cancelPendingBooking,
} = require('./adminBooking');
const {
  CALENDAR_CAPABILITIES,
  resolveCalendarAuthority,
  hasCapability,
  allowsBookingTarget,
} = require('./calendarAuthorization');
const { normalizeAppointmentNotes } = require('./appointmentNotes');

const BOOKING_TIME_INCREMENT_MINUTES = 5;

function bookingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clean(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function localDateTimeFromInputs(date, time) {
  const dateMatch = String(date || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) throw bookingError('CALENDAR_BOOKING_INVALID_SLOT', 'Choose a valid date and start time.');
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    throw bookingError('CALENDAR_BOOKING_INVALID_SLOT', 'Choose a valid date and start time.');
  }
  if (Number(timeMatch[2]) % BOOKING_TIME_INCREMENT_MINUTES !== 0) {
    throw bookingError(
      'CALENDAR_BOOKING_INVALID_TIME_INCREMENT',
      'Choose a start time in 5-minute increments, for example 09:00.'
    );
  }
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year} ${timeMatch[1]}:${timeMatch[2]}`;
}

function maskContact(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? `ending in ${digits.slice(-4)}` : null;
}

function displayMobile(value = '') {
  const normalized = String(value || '').trim();
  return /^27[678][0-9]{8}$/.test(normalized) ? `+${normalized}` : null;
}

function serializeClient(client) {
  return {
    id: String(client.id),
    displayName: client.name || 'Unnamed client',
    status: client.status || 'unknown',
    profileStatus: client.profileStatus || null,
    contactHint: maskContact(client.normalizedMobile),
  };
}

function normalizeNewClientInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = String(value.name || value.fullName || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const mobile = String(value.mobile || value.mobileNumber || '').trim().slice(0, 40);
  if (!name && !mobile) return null;
  return { name, mobile };
}

function crmV2OutcomeError(outcome) {
  if (outcome?.status === 'conflict') {
    return bookingError(
      'CALENDAR_BOOKING_CRM_V2_CONFLICT',
      'CRM V2 could not establish one active owner for that exact mobile. No booking was prepared.'
    );
  }
  if (!outcome?.client?.id || !['created', 'existing'].includes(outcome.status)) {
    return bookingError('CALENDAR_BOOKING_CRM_V2_UNAVAILABLE', 'Shiloh could not safely resolve this CRM V2 client.');
  }
  return null;
}

function createCalendarCreateBookingService({
  db = pool,
  env = process.env,
  crmV2Service = crmV2ClientService,
  prepareBooking = prepareCalendarV2Booking,
  confirmBooking = confirmCalendarV2Booking,
  cancelBooking = cancelPendingBooking,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Calendar Create Booking db is required');
  if (!crmV2Service || typeof crmV2Service.searchClients !== 'function' || typeof crmV2Service.getClientById !== 'function' || typeof crmV2Service.createClient !== 'function') {
    throw new Error('Calendar Create Booking CRM V2 service is required');
  }

  async function resolveOperator(adminId) {
    const id = positiveId(adminId);
    if (!id) throw bookingError('CALENDAR_BOOKING_FORBIDDEN', 'This browser session cannot create Calendar bookings.');
    const admin = await resolveCalendarAuthority(db, id);
    if (
      !admin
      || !hasCapability(admin.calendarAuthority, CALENDAR_CAPABILITIES.BOOKING_CREATE)
      || !hasCapability(admin.calendarAuthority, CALENDAR_CAPABILITIES.CLIENT_LOOKUP)
    ) {
      throw bookingError('CALENDAR_BOOKING_FORBIDDEN', 'Current canonical staff authority does not permit Calendar booking.');
    }
    return {
      ...admin,
      bookingScope: {
        key: `${admin.calendarAuthority.calendarScope}:${admin.calendarAuthority.serviceScope}`,
        calendarScope: admin.calendarAuthority.calendarScope,
        serviceScope: admin.calendarAuthority.serviceScope,
      },
    };
  }

  async function listBookableOptions(adminId) {
    const admin = await resolveOperator(adminId);
    const result = await db.query(
      `SELECT st.id AS staff_id, st.display_name AS staff_name,
              sv.id AS service_id, sv.name AS service_name,
              sv.external_source, sv.external_id, sc.name AS category_name,
              sv.duration_minutes, sv.processing_time_minutes, sv.extra_time_minutes,
              sv.price, sv.variable_price,
              visibility.owner_staff_id AS private_owner_staff_id
         FROM staff st
         JOIN staff_services ss ON ss.staff_id = st.id
         JOIN services sv ON sv.id = ss.service_id
         LEFT JOIN service_categories sc ON sc.id = sv.category_id
         LEFT JOIN service_visibility_policies visibility
           ON visibility.service_id = sv.id
          AND visibility.visibility_scope = 'tenant_private'
        WHERE st.status = 'active'
          AND sv.status = 'active'
          AND NOT EXISTS (
                SELECT 1
                  FROM service_packages sp
                 WHERE sp.session_service_id = sv.id
                   AND sp.status = 'active'
              )
        ORDER BY sv.name, st.display_name, sv.id, st.id`,
      []
    );
    const staffById = new Map();
    const servicesById = new Map();
    for (const row of result.rows) {
      const staffId = Number(row.staff_id);
      const serviceId = Number(row.service_id);
      if (!allowsBookingTarget(admin.calendarAuthority, {
        staffId,
        serviceId,
        privateOwnerStaffId: row.private_owner_staff_id,
      })) continue;
      if (!staffById.has(staffId)) staffById.set(staffId, { id: staffId, displayName: row.staff_name, serviceIds: [] });
      staffById.get(staffId).serviceIds.push(serviceId);
      if (!servicesById.has(serviceId)) {
        servicesById.set(serviceId, {
          id: serviceId,
          name: row.service_name,
          categoryName: row.category_name || null,
          externalSource: row.external_source || null,
          externalId: row.external_id || null,
          durationMinutes: Number(row.duration_minutes || 0) + Number(row.processing_time_minutes || 0) + Number(row.extra_time_minutes || 0),
          price: row.price == null ? null : Number(row.price),
          variablePrice: row.variable_price === true,
          staffIds: [],
        });
      }
      servicesById.get(serviceId).staffIds.push(staffId);
    }
    return {
      staff: [...staffById.values()],
      services: [...servicesById.values()],
      authority: {
        operatorAdminId: Number(admin.id),
        serviceScope: admin.bookingScope.key,
        bookingFlow: admin.calendarAuthority.businessRole === 'booking_operator'
          ? 'practitioner_first'
          : 'treatment_first',
      },
    };
  }

  async function searchClients(adminId, query) {
    await resolveOperator(adminId);
    const cleaned = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (cleaned.length < 2) return { clients: [], requiresExplicitSelection: true };
    const found = await crmV2Service.searchClients({ query: cleaned, status: 'active', limit: 10 });
    return {
      clients: found.map(serializeClient),
      requiresExplicitSelection: true,
      ambiguous: found.length > 1,
      identityModel: 'crm_v2_operator_search_only',
    };
  }

  async function resolveEligibleSelection(admin, staffId, serviceId) {
    const staff = positiveId(staffId);
    const service = positiveId(serviceId);
    if (!staff || !service) throw bookingError('CALENDAR_BOOKING_INVALID_SELECTION', 'Choose an eligible treatment and practitioner.');
    const result = await db.query(
      `SELECT st.id AS staff_id, st.display_name AS staff_name,
              sv.id AS service_id, sv.name AS service_name,
              sv.external_source, sv.external_id, sc.name AS category_name,
              sv.duration_minutes, sv.processing_time_minutes, sv.extra_time_minutes,
              sv.price, sv.variable_price,
              visibility.owner_staff_id AS private_owner_staff_id
         FROM staff st
         JOIN staff_services ss ON ss.staff_id = st.id
         JOIN services sv ON sv.id = ss.service_id
         LEFT JOIN service_categories sc ON sc.id = sv.category_id
         LEFT JOIN service_visibility_policies visibility
           ON visibility.service_id = sv.id
          AND visibility.visibility_scope = 'tenant_private'
        WHERE st.id = $1
          AND sv.id = $2
          AND st.status = 'active'
          AND sv.status = 'active'
          AND NOT EXISTS (
                SELECT 1
                  FROM service_packages sp
                 WHERE sp.session_service_id = sv.id
                   AND sp.status = 'active'
              )
        LIMIT 1`,
      [staff, service]
    );
    const row = result.rows[0];
    if (!row || !allowsBookingTarget(admin.calendarAuthority, {
      staffId: staff,
      serviceId: service,
      privateOwnerStaffId: row.private_owner_staff_id,
    })) {
      throw bookingError(
        'CALENDAR_BOOKING_INELIGIBLE_SELECTION',
        'That treatment/practitioner selection is outside the authenticated operator’s current service authority or is not bookable.'
      );
    }
    return row;
  }

  async function pendingBooking(adminId) {
    const result = await db.query(
      `SELECT abs.crm_v2_client_id, abs.source_client_name, abs.client_mobile_snapshot,
              abs.staff_id, abs.service_id, abs.location_id,
              abs.starts_at, abs.ends_at, abs.state,
              client.name AS current_client_name,
              client.normalized_mobile AS current_client_mobile,
              client.status AS current_client_status
         FROM admin_booking_sessions abs
         JOIN crm_v2_clients client ON client.id = abs.crm_v2_client_id
        WHERE abs.admin_id = $1
          AND abs.client_id IS NULL
        LIMIT 1`,
      [adminId]
    );
    return result.rows[0] || null;
  }

  function validateClientChoice(clientId, newClient) {
    const rawClientId = String(clientId || '').trim();
    const clientIdProvided = rawClientId.length > 0;
    const validClientId = /^\d+$/.test(rawClientId) && Number(rawClientId) > 0;
    const newClientInput = normalizeNewClientInput(newClient);
    if (clientIdProvided && !validClientId) throw bookingError('CALENDAR_BOOKING_CLIENT_REQUIRED', 'Select exactly one CRM V2 client.');
    if (clientIdProvided && newClientInput) throw bookingError('CALENDAR_BOOKING_INVALID_CLIENT_SELECTION', 'Choose either one CRM V2 client or one new client, not both.');
    if (!validClientId && !newClientInput) throw bookingError('CALENDAR_BOOKING_CLIENT_REQUIRED', 'Select one CRM V2 client or enter one new client.');
    return { rawClientId, newClientInput };
  }

  async function resolvePreparedClient({ validatedChoice, actorAdminId }) {
    const { rawClientId, newClientInput } = validatedChoice;
    let client;
    let resolution = 'selected';
    if (newClientInput) {
      const outcome = await crmV2Service.createClient({
        name: newClientInput.name,
        mobile: newClientInput.mobile,
        actorReference: `calendar_admin:${actorAdminId}`,
      });
      const outcomeError = crmV2OutcomeError(outcome);
      if (outcomeError) throw outcomeError;
      resolution = outcome.status === 'created' ? 'created' : 'existing_exact_mobile';
      client = await crmV2Service.getClientById(outcome.client.id);
      const expectedMobile = crmV2ClientService.normalizeMobile(newClientInput.mobile);
      if (!expectedMobile || client.normalizedMobile !== expectedMobile) {
        throw bookingError('CALENDAR_BOOKING_CRM_V2_CONFLICT', 'The exact mobile no longer resolves to the expected CRM V2 client.');
      }
    } else {
      client = await crmV2Service.getClientById(rawClientId);
    }
    if (!client || client.status !== 'active' || !/^27[678][0-9]{8}$/.test(String(client.normalizedMobile || ''))) {
      throw bookingError('CALENDAR_BOOKING_CRM_V2_CLIENT_INACTIVE', 'The selected CRM V2 client is not active or has no valid mobile.');
    }
    return { client, resolution };
  }

  async function prepare({ adminId, clientId, newClient, staffId, serviceId, date, time } = {}) {
    const admin = await resolveOperator(adminId);
    const validatedChoice = validateClientChoice(clientId, newClient);
    const selected = await resolveEligibleSelection(admin, staffId, serviceId);
    const localDateTime = localDateTimeFromInputs(date, time);
    const resolved = await resolvePreparedClient({ validatedChoice, actorAdminId: Number(admin.id) });
    const result = await prepareBooking({
      adminId: Number(admin.id),
      crmV2Client: resolved.client,
      staffName: selected.staff_name,
      serviceName: selected.service_name,
      localDateTime,
    });
    if (result.status !== 'pending_confirmation') return result;

    const durationMinutes = Math.max(0, Math.round((new Date(result.endsAt).getTime() - new Date(result.startsAt).getTime()) / 60000));
    const price = result.service.variable_price
      ? (result.service.price == null ? 'Variable' : `From R${Number(result.service.price).toFixed(2)}`)
      : (result.service.price == null ? 'Not set' : `R${Number(result.service.price).toFixed(2)}`);
    return {
      status: result.status,
      review: {
        client: {
          id: String(result.client.id),
          displayName: result.client.name,
          created: resolved.resolution === 'created',
          matchedExisting: resolved.resolution === 'existing_exact_mobile',
          profileStatus: result.client.profileStatus,
          contactHint: maskContact(result.client.normalizedMobile),
          mobile: displayMobile(result.client.normalizedMobile),
        },
        service: {
          id: Number(result.service.id),
          name: result.service.name,
          categoryName: selected.category_name || null,
          externalSource: selected.external_source || null,
          externalId: selected.external_id || null,
        },
        practitioner: { id: Number(result.staff.id), displayName: result.staff.display_name },
        startsAt: result.startsAt,
        endsAt: result.endsAt,
        durationMinutes,
        price,
      },
    };
  }

  async function discard({ adminId } = {}) {
    const admin = await resolveOperator(adminId);
    const cancelled = await cancelBooking(Number(admin.id));
    return { status: cancelled ? 'discarded' : 'no_pending', crmV2ClientRemoved: false };
  }

  async function confirm({ adminId, notes } = {}) {
    const normalizedNotes = normalizeAppointmentNotes(notes);
    const admin = await resolveOperator(adminId);
    const pending = await pendingBooking(Number(admin.id));
    if (!pending) throw bookingError('CALENDAR_BOOKING_NO_PENDING', 'There is no pending CRM V2 Calendar booking to confirm.');
    await resolveEligibleSelection(admin, pending.staff_id, pending.service_id);
    if (
      pending.state !== 'confirm'
      || pending.current_client_status !== 'active'
      || !/^27[678][0-9]{8}$/.test(String(pending.current_client_mobile || ''))
      || pending.current_client_mobile !== pending.client_mobile_snapshot
    ) {
      throw bookingError('CALENDAR_BOOKING_CLIENT_MOBILE_CHANGED', 'The current canonical CRM V2 client/mobile changed. Prepare the booking again.');
    }
    return confirmBooking(admin, { source: 'shiloh_calendar', notes: normalizedNotes });
  }

  return {
    resolveOperator,
    listBookableOptions,
    searchClients,
    prepare,
    discard,
    confirm,
  };
}

module.exports = {
  BOOKING_TIME_INCREMENT_MINUTES,
  createCalendarCreateBookingService,
  localDateTimeFromInputs,
  serializeClient,
  normalizeNewClientInput,
  crmV2OutcomeError,
  bookingError,
};
