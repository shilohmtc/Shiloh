'use strict';

const { pool } = require('../db/pool');
const { getPublicServiceCatalogue } = require('./publicServiceCatalogue');
const { ensureTable: ensureBookingIntentTable } = require('./bookingIntent');
const {
  authoritativeSlotsForIntent,
  resolveEligibleStaff,
  localDateKey,
  localTimeParts,
} = require('./clientBookingAvailability');
const {
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


function fixedCataloguePrice(service = {}) {
  const text = String(service.price || '').replace(/\s/g, '').replace(',', '.');
  const fixed = text.match(/^R(\d+(?:\.\d{1,2})?)$/i);
  if (fixed) return Number(fixed[1]);
  const range = text.match(/^R?(\d+(?:\.\d{1,2})?)[-–—]R?(\d+(?:\.\d{1,2})?)$/i);
  return range ? Number(range[1]) : null;
}

function createMyShilohBookingService({
  db = pool,
  catalogueProvider = getPublicServiceCatalogue,
  availability = authoritativeSlotsForIntent,
  eligibleStaff = resolveEligibleStaff,
  commitBooking = commitAcceptedClientBooking,
  stageApproval = stageCreatedBookingForApproval,
  ensureIntentTable = ensureBookingIntentTable,
  ensurePolicy = ensurePolicySchema,
  acceptPolicy = recordAcceptance,
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
    if (!phone || !String(client.name || '').trim()) {
      throw new MyShilohBookingError(
        'BOOKING_IDENTITY_CHANGED',
        'Your secure My Shiloh profile changed before this booking could start.',
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
          AND COALESCE(s.variable_price,FALSE)=FALSE
          AND s.price IS NOT NULL
          AND NOT (s.external_source='shiloh_special')
          AND NOT EXISTS (
            SELECT 1 FROM service_packages sp
             WHERE sp.session_service_id=s.id
               AND sp.status='active'
          )
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
    const blocked = await db.query(
      `SELECT s.id
         FROM services s
        WHERE s.external_source='shiloh_special'
           OR COALESCE(s.variable_price,FALSE)=TRUE
           OR s.price IS NULL
           OR EXISTS (
             SELECT 1 FROM service_packages sp
              WHERE sp.session_service_id=s.id
                AND sp.status='active'
           )`,
    );
    const blockedIds = new Set(blocked.rows.map(row => Number(row.id)));
    const ordinary = rows.filter(item => !blockedIds.has(Number(item.id)));
    if (!welcomeVoucherOnly) return ordinary;
    const allowed = Array.isArray(eligibleServiceIds) ? new Set(eligibleServiceIds.map(Number)) : null;
    const minimum = Number(minimumBookingValue || 450);
    return ordinary.filter(item => {
      const id = Number(item.id);
      const amount = fixedCataloguePrice(item);
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

    await ensureIntentTable();
    await ensurePolicy();
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
      const accepted = await acceptPolicy(phone, 'my_shiloh');
      if (!accepted) {
        throw new MyShilohBookingError('BOOKING_POLICY_NOT_RECORDED', 'Your booking terms could not be recorded safely. Nothing was booked.', 409);
      }
      const created = await commitBooking(phone, { crmV2ClientId:Number(client.id) });
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
      const policy = await depositPolicy.loadPolicy(db);
      const depositExempt = Number(practitioner.id) === Number(policy.exemptStaffId);
      return {
        status: staged.status,
        appointmentId: Number(created.appointmentId),
        service: service.name,
        practitioner: practitioner.display_name,
        startsAt: exact.startsAt,
        clientFirstName: String(client.name || '').trim().split(/\s+/)[0] || 'there',
        depositExempt,
        message: staged.status === 'pending_resolution'
          ? depositExempt
            ? 'Your booking request is in. Your selected time is being held while the Shiloh team confirms it. No booking deposit is required for Marietjie.'
            : 'Your booking request is in. Your selected time is being held while the Shiloh team confirms it. You’ll see the deposit step in My Shiloh after approval.'
          : 'Your booking request was created and is being reviewed by Shiloh.',
      };
    } catch (error) {
      await db.query(
        `DELETE FROM booking_intents WHERE phone=$1`,
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
  fixedCataloguePrice,
  createMyShilohBookingService,
  ...service,
};
