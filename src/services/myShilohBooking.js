'use strict';

const { pool } = require('../db/pool');
const { getPublicServiceCatalogue } = require('./publicServiceCatalogue');
const {
  authoritativeSlotsForIntent,
  resolveEligibleStaff,
  localDateKey,
  localTimeParts,
} = require('./clientBookingAvailability');
const {
  resolveWhatsAppBookingIdentity,
  normalizePhone,
} = require('./whatsappBookingIdentity');
const {
  POLICY_VERSION,
  ensurePolicySchema,
  recordAcceptance,
  stageCreatedBookingForApproval,
} = require('./bookingPolicy');
const { commitAcceptedClientBooking } = require('./clientBookingCommit');
const { createBookingDepositPolicyService } = require('./bookingDepositPolicy');

class MyShilohBookingError extends Error {
  constructor(code, message, httpStatus = 400, resolution = []) {
    super(message);
    this.name = 'MyShilohBookingError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.resolution = resolution;
  }
}

function positiveId(value, code = 'BOOKING_INVALID_ID') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new MyShilohBookingError(code, 'Please reload My Shiloh and choose again.', 422);
  }
  return id;
}

function exactDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new MyShilohBookingError('BOOKING_INVALID_DATE', 'Choose a valid appointment date.', 422);
  }
  return date;
}

function exactStart(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new MyShilohBookingError('BOOKING_INVALID_SLOT', 'Choose an available appointment time.', 422);
  }
  return date;
}

function localDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function localTime(value) {
  return localTimeParts(value).text;
}

function slotDto(slot) {
  const startsAt = new Date(slot.starts_at).toISOString();
  const endsAt = new Date(slot.ends_at).toISOString();
  return {
    startsAt,
    endsAt,
    date: localDate(startsAt),
    time: localTime(startsAt),
    endTime: localTime(endsAt),
    practitionerId: Number(slot.staff_id),
    practitionerName: String(slot.staff_name || ''),
  };
}

function createMyShilohBookingService({
  db = pool,
  catalogueProvider = getPublicServiceCatalogue,
  availability = authoritativeSlotsForIntent,
  eligibleStaff = resolveEligibleStaff,
  identityResolver = resolveWhatsAppBookingIdentity,
  commitBooking = commitAcceptedClientBooking,
  stageApproval = stageCreatedBookingForApproval,
  depositPolicy = createBookingDepositPolicyService({ db }),
  now = () => new Date(),
} = {}) {
  async function clientIdentity(crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId, 'BOOKING_CLIENT_INVALID');
    const result = await db.query(
      `SELECT id,name,normalized_mobile,status,profile_status,date_of_birth,gender
         FROM crm_v2_clients
        WHERE id=$1 AND status='active'
        LIMIT 1`,
      [clientId],
    );
    const client = result.rows[0];
    if (!client || !client.normalized_mobile) {
      throw new MyShilohBookingError(
        'BOOKING_CLIENT_NOT_READY',
        'Your My Shiloh profile needs a verified mobile number before you can book.',
        409,
        ['Open Profile in My Shiloh.', 'Ask Shiloh for help if your mobile number needs updating.'],
      );
    }
    const phone = normalizePhone(client.normalized_mobile);
    const resolved = await identityResolver(phone);
    if (
      resolved.status !== 'unique'
      || resolved.clientIdentity?.identityModel !== 'crm_v2'
      || Number(resolved.clientIdentity.crmV2ClientId) !== clientId
      || resolved.bookingReady !== true
    ) {
      throw new MyShilohBookingError(
        'BOOKING_IDENTITY_CHANGED',
        'Your secure booking identity needs to be checked before a new appointment can be made.',
        409,
        ['Return to My Shiloh.', 'Ask Shiloh for help with your profile.'],
      );
    }
    return { client, phone };
  }

  async function canonicalService(serviceId) {
    const id = positiveId(serviceId, 'BOOKING_SERVICE_INVALID');
    const result = await db.query(
      `SELECT s.id,s.name,s.status,s.price,s.variable_price,s.duration_minutes,
              s.processing_time_minutes,s.extra_time_minutes,
              sc.name AS category_name
         FROM services s
         LEFT JOIN service_categories sc ON sc.id=s.category_id
        WHERE s.id=$1
        LIMIT 1`,
      [id],
    );
    const service = result.rows[0];
    if (!service || service.status !== 'active') {
      throw new MyShilohBookingError('BOOKING_SERVICE_CHANGED', 'That treatment is no longer available to book.', 409);
    }
    const staff = await eligibleStaff(id, 'any available therapist');
    if (!staff.length) {
      throw new MyShilohBookingError('BOOKING_SERVICE_NOT_BOOKABLE', 'That treatment is not currently available for online booking.', 409);
    }
    return { ...service, staff };
  }

  async function practitioners({ serviceId }) {
    const service = await canonicalService(serviceId);
    const policy = await depositPolicy.loadPolicy(db);
    return {
      service: {
        id: Number(service.id),
        name: service.name,
        category: service.category_name || 'Services',
        durationMinutes: Number(service.duration_minutes || 0),
        price: service.variable_price ? null : Number(service.price),
        variablePrice: service.variable_price === true,
      },
      practitioners: service.staff.map(row => ({
        id: Number(row.id),
        name: row.display_name,
        depositExempt: Number(row.id) === Number(policy.exemptStaffId),
      })),
      deposit: {
        ratePercent: Number(policy.rateBasisPoints) / 100,
        exemptStaffId: Number(policy.exemptStaffId),
      },
    };
  }

  async function slots({ serviceId, staffId, date }) {
    const service = await canonicalService(serviceId);
    const practitionerId = positiveId(staffId, 'BOOKING_PRACTITIONER_INVALID');
    const practitioner = service.staff.find(row => Number(row.id) === practitionerId);
    if (!practitioner) {
      throw new MyShilohBookingError('BOOKING_PRACTITIONER_CHANGED', 'That practitioner is no longer available for this treatment.', 409);
    }
    const preferredDate = exactDate(date);
    const result = await availability({
      service_text: service.name,
      preferred_date: preferredDate,
      therapist_text: practitioner.display_name,
      service_verified: true,
    }, { now: now() });
    const matching = (result.slots || []).filter(slot => Number(slot.staff_id) === practitionerId);
    return {
      status: matching.length ? 'available' : 'no_slots',
      service: { id: Number(service.id), name: service.name },
      practitioner: { id: practitionerId, name: practitioner.display_name },
      date: preferredDate,
      slots: matching.map(slotDto),
    };
  }

  async function catalogue({ welcomeVoucherOnly = false, minimumBookingValue = 450, eligibleServiceIds = null } = {}) {
    const catalogue = await catalogueProvider();
    const rows = Array.isArray(catalogue) ? catalogue : [];
    if (!welcomeVoucherOnly) return rows;
    const allowed = Array.isArray(eligibleServiceIds) ? new Set(eligibleServiceIds.map(Number)) : null;
    const minimum = Number(minimumBookingValue || 450);
    return rows.filter(item => {
      const id = Number(item.id);
      const amount = Number(item.amount);
      if (allowed && !allowed.has(id)) return false;
      return Number.isFinite(amount) && amount >= minimum;
    });
  }

  async function createRequest({
    crmV2ClientId,
    serviceId,
    staffId,
    startsAt,
    policyAccepted,
  } = {}) {
    if (policyAccepted !== true) {
      throw new MyShilohBookingError(
        'BOOKING_POLICY_REQUIRED',
        'Please accept Shiloh’s Booking Policy & Terms before sending this booking request.',
        422,
      );
    }
    const { client, phone } = await clientIdentity(crmV2ClientId);
    const service = await canonicalService(serviceId);
    const practitionerId = positiveId(staffId, 'BOOKING_PRACTITIONER_INVALID');
    const practitioner = service.staff.find(row => Number(row.id) === practitionerId);
    if (!practitioner) {
      throw new MyShilohBookingError('BOOKING_PRACTITIONER_CHANGED', 'That practitioner is no longer available for this treatment.', 409);
    }

    const requestedStart = exactStart(startsAt);
    if (requestedStart.getTime() <= now().getTime()) {
      throw new MyShilohBookingError('BOOKING_SLOT_PASSED', 'That appointment time has already passed. Choose another available time.', 409);
    }
    const date = localDate(requestedStart);
    const availabilityResult = await slots({ serviceId: service.id, staffId: practitionerId, date });
    const exact = availabilityResult.slots.find(slot => new Date(slot.startsAt).getTime() === requestedStart.getTime());
    if (!exact) {
      throw new MyShilohBookingError(
        'BOOKING_SLOT_UNAVAILABLE',
        'That time is no longer available. Nothing was booked; choose another available time.',
        409,
      );
    }

    await ensurePolicySchema();
    const existing = await db.query(
      `SELECT phone,status,policy_channel
         FROM booking_intents
        WHERE phone=$1
        LIMIT 1`,
      [phone],
    );
    if (existing.rowCount) {
      throw new MyShilohBookingError(
        'BOOKING_ALREADY_IN_PROGRESS',
        'You already have a booking request in progress. Finish or cancel that request before starting another one.',
        409,
        ['Open Shiloh in My Shiloh if you need help with the existing request.'],
      );
    }

    const inserted = await db.query(
      `INSERT INTO booking_intents(
         phone,service_text,preferred_date,preferred_time,therapist_text,
         service_verified,status,policy_version,policy_accepted_at,policy_channel,updated_at
       )
       VALUES($1,$2,$3,$4,$5,TRUE,'awaiting_policy_acceptance',$6,NULL,NULL,NOW())
       ON CONFLICT (phone) DO NOTHING
       RETURNING phone`,
      [phone, service.name, date, localTime(requestedStart), practitioner.display_name, POLICY_VERSION],
    );
    if (inserted.rowCount !== 1) {
      throw new MyShilohBookingError('BOOKING_ALREADY_IN_PROGRESS', 'Another booking request started at the same time. Please reload My Shiloh.', 409);
    }

    try {
      const accepted = await recordAcceptance(phone, 'my_shiloh');
      if (!accepted) {
        throw new MyShilohBookingError('BOOKING_POLICY_NOT_RECORDED', 'Your booking terms could not be recorded safely. Nothing was booked.', 409);
      }
      const created = await commitBooking(phone, { source:'shiloh_client_my_shiloh' });
      if (!created?.handled || created.status !== 'created' || !created.appointmentId) {
        await db.query(
          `DELETE FROM booking_intents WHERE phone=$1 AND policy_channel='my_shiloh'`,
          [phone],
        );
        throw new MyShilohBookingError(
          'BOOKING_FINAL_CHECK_FAILED',
          created?.reply || 'That appointment could not be created after the final availability check. Nothing was booked.',
          409,
        );
      }
      const staged = await stageApproval(created);
      return {
        status: staged.status,
        appointmentId: Number(created.appointmentId),
        service: service.name,
        practitioner: practitioner.display_name,
        startsAt: exact.startsAt,
        clientFirstName: String(client.name || '').trim().split(/\s+/)[0] || 'there',
        message: staged.status === 'pending_resolution'
          ? 'Your booking request is in. Your selected time is being held while the Shiloh team confirms it. You’ll see the deposit step in My Shiloh after approval.'
          : 'Your booking request was created and is being reviewed by Shiloh.',
      };
    } catch (error) {
      await db.query(
        `DELETE FROM booking_intents
          WHERE phone=$1
            AND (policy_channel='my_shiloh' OR status='awaiting_policy_acceptance')`,
        [phone],
      ).catch(() => {});
      throw error;
    }
  }

  async function policy() { return depositPolicy.loadPolicy(db); }

  return { catalogue, practitioners, slots, createRequest, policy };
}

const service = createMyShilohBookingService();

module.exports = {
  MyShilohBookingError,
  positiveId,
  exactDate,
  exactStart,
  localDate,
  localTime,
  slotDto,
  createMyShilohBookingService,
  ...service,
};
