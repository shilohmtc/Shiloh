'use strict';

const { createHash } = require('node:crypto');

const { pool } = require('../db/pool');
const { createWorkspacePackages } = require('./workspacePackages');
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

function cleanOccasionNote(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new MyShilohBookingError('BOOKING_OCCASION_INVALID', 'Please shorten your occasion note.', 422);
  const note = value.replace(/\s+/g, ' ').trim();
  if (note.length > 160) throw new MyShilohBookingError('BOOKING_OCCASION_TOO_LONG', 'Please keep your occasion note under 160 characters.', 422);
  return note || null;
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
  allowCouplesService = false,
  catalogueProvider = getPublicServiceCatalogue,
  availability = authoritativeSlotsForIntent,
  eligibleStaff = resolveEligibleStaff,
  commitBooking = commitAcceptedClientBooking,
  stageApproval = stageCreatedBookingForApproval,
  ensureIntentTable = ensureBookingIntentTable,
  ensurePolicy = ensurePolicySchema,
  acceptPolicy = recordAcceptance,
  depositPolicy = createBookingDepositPolicyService({ db }),
  packages = createWorkspacePackages({ db }),
  now = () => new Date(),
} = {}) {
  const discardableDraftStates = new Set(['collecting', 'awaiting_confirmation', 'awaiting_policy_acceptance', 'policy_accepted', 'ready_for_handoff']);
  function draftRevision(row) {
    return createHash('sha256').update(JSON.stringify(row)).digest('hex');
  }
  function draftDto(row) {
    if (!row) return null;
    const text = value => String(value || '').slice(0, 160);
    return { revision: draftRevision(row), canDiscard: discardableDraftStates.has(row.status),
      treatment: text(row.service_text), practitioner: text(row.therapist_text),
      date: text(row.preferred_date), time: text(row.preferred_time) };
  }
  async function unfinishedDraft({ crmV2ClientId } = {}) {
    const { phone } = await clientIdentity(crmV2ClientId);
    await ensureIntentTable();
    const result = await db.query('SELECT *,created_at::text AS created_at,updated_at::text AS updated_at FROM booking_intents WHERE phone=$1', [phone]);
    return { draft: draftDto(result.rows[0]) };
  }
  async function discardDraft({ crmV2ClientId, sessionId, revision } = {}) {
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
      throw new MyShilohBookingError('BOOKING_DRAFT_INVALID', 'Review the unfinished draft before discarding it.', 422);
    }
    const authorizingSessionId = positiveId(sessionId, 'BOOKING_DRAFT_SESSION_REQUIRED');
    const { client: owner, phone } = await clientIdentity(crmV2ClientId);
    await ensureIntentTable();
    const transaction = await db.connect();
    try {
      await transaction.query('BEGIN');
      const result = await transaction.query('SELECT *,created_at::text AS created_at,updated_at::text AS updated_at FROM booking_intents WHERE phone=$1 FOR UPDATE', [phone]);
      const row = result.rows[0];
      const session = await transaction.query(`SELECT id FROM client_browser_sessions
        WHERE id=$1 AND crm_v2_client_id=$2 AND revoked_at IS NULL
          AND issued_at<=clock_timestamp() AND expires_at>clock_timestamp() FOR SHARE`, [authorizingSessionId, owner.id]);
      if (session.rowCount !== 1) {
        throw new MyShilohBookingError('BOOKING_DRAFT_SESSION_EXPIRED', 'Your session has ended. Sign in again before changing this draft.', 401);
      }
      // Commit locks this same row and deletes it in the appointment transaction.
      // Never discard a replacement draft or interfere with a completed commit.
      const identity = await transaction.query("SELECT normalized_mobile FROM crm_v2_clients WHERE id=$1 AND status='active' FOR SHARE", [owner.id]);
      if (!row || draftRevision(row) !== revision || !discardableDraftStates.has(row.status)
          || normalizePhone(identity.rows[0]?.normalized_mobile || '') !== phone) {
        throw new MyShilohBookingError('BOOKING_DRAFT_CHANGED', 'The unfinished draft changed. Review it again, and check Bookings before sending another request.', 409);
      }
      const removed = await transaction.query(`DELETE FROM booking_intents WHERE phone=$1
        AND EXISTS (SELECT 1 FROM client_browser_sessions WHERE id=$2 AND crm_v2_client_id=$3
          AND revoked_at IS NULL AND expires_at>clock_timestamp()) RETURNING phone`, [phone, authorizingSessionId, owner.id]);
      if (removed.rowCount !== 1) {
        throw new MyShilohBookingError('BOOKING_DRAFT_SESSION_EXPIRED', 'Your session has ended. Sign in again before changing this draft.', 401);
      }
      await transaction.query(`INSERT INTO client_auth_security_events(event_type,crm_v2_client_id,metadata)
        VALUES('booking_draft_discarded',$1,$2::jsonb)`, [owner.id, JSON.stringify({ status: row.status })]);
      await transaction.query('COMMIT');
      return { discarded: true };
    } catch (error) {
      await transaction.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { transaction.release(); }
  }
  async function clientIdentity(crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId, 'BOOKING_CLIENT_INVALID');
    const result = await db.query(
      `SELECT id,name,normalized_mobile,status,profile_status,date_of_birth,gender,provenance,
              EXISTS (SELECT 1 FROM appointments ap WHERE ap.crm_v2_client_id=c.id) AS has_appointment
         FROM crm_v2_clients c
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
    if (!client.date_of_birth && client.provenance?.actorReference==='my_shiloh_sms' && client.has_appointment===false) {
      throw new MyShilohBookingError('BOOKING_DATE_OF_BIRTH_REQUIRED','Add your date of birth in Profile before your first booking.',409,
        ['Open Profile in My Shiloh.', 'Save your personal details, then return to booking.']);
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

  async function clientAppEligibleStaff(serviceId, candidates = null) {
    const id = positiveId(serviceId, 'BOOKING_SERVICE_INVALID');
    const staff = Array.isArray(candidates) ? candidates : await eligibleStaff(id, 'any available therapist');
    const ids = staff.map(row => Number(row.id)).filter(Number.isSafeInteger);
    if (!ids.length) return [];
    const result = await db.query(
      `SELECT id
         FROM staff
        WHERE id = ANY($1::bigint[])
          AND status='active'
          AND resource_type='practitioner'
          AND client_bookable=TRUE
          AND COALESCE(business_role,'') <> 'tenant_practitioner'`,
      [ids],
    );
    const allowed = new Set(result.rows.map(row => Number(row.id)));
    return staff.filter(row => allowed.has(Number(row.id)));
  }

  async function canonicalService(serviceId, crmV2ClientId = null) {
    const id = positiveId(serviceId, 'BOOKING_SERVICE_INVALID');
    const result = await db.query(
      `SELECT s.id,s.name,s.status,s.price,s.variable_price,s.duration_minutes,
              s.processing_time_minutes,s.extra_time_minutes,
              sc.name AS category_name,
              (SELECT p.id FROM service_packages p WHERE p.session_service_id=s.id) AS package_id
         FROM services s
         LEFT JOIN service_categories sc ON sc.id=s.category_id
        WHERE s.id=$1
          AND COALESCE(s.variable_price,FALSE)=FALSE
          AND s.price IS NOT NULL
          AND (s.external_source IS DISTINCT FROM 'shiloh_special'
            OR ($2::boolean AND s.external_source='shiloh_special' AND s.external_id='couples-massage-v1'))

        LIMIT 1`,
      [id, allowCouplesService],
    );
    const service = result.rows[0];
    if (!service || service.status !== 'active') {
      throw new MyShilohBookingError('BOOKING_SERVICE_CHANGED', 'That treatment is no longer available to book.', 409);
    }
    let entitlement = null;
    if (service.package_id) {
      try { entitlement = await packages.available(crmV2ClientId, id); }
      catch (e) { throw new MyShilohBookingError(e.code, e.message, e.httpStatus || 409); }
    }
    const staff = await clientAppEligibleStaff(id);
    if (!staff.length) {
      throw new MyShilohBookingError('BOOKING_SERVICE_NOT_BOOKABLE', 'That treatment is not currently available for online booking.', 409);
    }
    return { ...service, staff, entitlement, price: entitlement ? 0 : service.price };
  }

  async function practitioners({ serviceId, crmV2ClientId }) {
    const service = await canonicalService(serviceId, crmV2ClientId);
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
        depositExempt: Boolean(service.entitlement) || Number(row.id) === Number(policy.exemptStaffId),
      })),
      deposit: {
        ratePercent: Number(policy.rateBasisPoints) / 100,
        exemptStaffId: Number(policy.exemptStaffId),
      },
    };
  }

  async function slots({ serviceId, staffId, date, crmV2ClientId }) {
    const service = await canonicalService(serviceId, crmV2ClientId);
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
    let matching = (result.slots || []).filter(slot => Number(slot.staff_id) === practitionerId);
    if (service.entitlement) {
      const allowed = await Promise.all(matching.map(slot => packages.permitsStart(service.entitlement.id, slot.starts_at)));
      matching = matching.filter((_slot, index) => allowed[index]);
    }
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
    let clientAppOrdinary = ordinary;
    if (ordinary.length) {
      const visible = await db.query(
        `SELECT DISTINCT ss.service_id
           FROM staff_services ss
           JOIN staff st ON st.id=ss.staff_id
          WHERE ss.service_id = ANY($1::bigint[])
            AND st.status='active'
            AND st.resource_type='practitioner'
            AND st.client_bookable=TRUE
            AND COALESCE(st.business_role,'') <> 'tenant_practitioner'`,
        [ordinary.map(item => Number(item.id)).filter(Number.isSafeInteger)],
      );
      const visibleIds = new Set(visible.rows.map(row => Number(row.service_id)));
      clientAppOrdinary = ordinary.filter(item => visibleIds.has(Number(item.id)));
    }
    if (!welcomeVoucherOnly) return clientAppOrdinary;
    const allowed = Array.isArray(eligibleServiceIds) ? new Set(eligibleServiceIds.map(Number)) : null;
    const minimum = Number(minimumBookingValue || 450);
    return clientAppOrdinary.filter(item => {
      const id = Number(item.id);
      const amount = fixedCataloguePrice(item);
      if (allowed && !allowed.has(id)) return false;
      return Number.isFinite(amount) && amount >= minimum;
    });
  }

  async function couplesCatalogue() {
    const ordinary = await catalogue();
    const named = await db.query(`SELECT s.id,s.name,s.price,s.duration_minutes,s.processing_time_minutes,s.extra_time_minutes
      FROM services s WHERE s.status='active' AND s.external_source='shiloh_special'
        AND s.external_id='couples-massage-v1' AND COALESCE(s.variable_price,FALSE)=FALSE AND s.price>0
        AND (SELECT COUNT(DISTINCT st.id) FROM staff_services ss JOIN staff st ON st.id=ss.staff_id
          WHERE ss.service_id=s.id AND st.status='active' AND st.resource_type='practitioner'
            AND st.client_bookable=TRUE AND COALESCE(st.business_role,'')<>'tenant_practitioner')>=2`);
    return [...ordinary, ...named.rows.map(row => ({ id:Number(row.id),name:row.name,
      duration:`${Number(row.duration_minutes)+Number(row.processing_time_minutes||0)+Number(row.extra_time_minutes||0)} min`,
      price:`R${Number(row.price).toFixed(2)} for two`, couplesService:true }))];
  }

  async function createRequest({
    crmV2ClientId,
    serviceId,
    staffId,
    startsAt,
    policyAccepted,
    specialOccasion,
    occasionNote,
  } = {}) {
    if (policyAccepted !== true) {
      throw new MyShilohBookingError(
        'BOOKING_POLICY_REQUIRED',
        'Please accept Shiloh’s Booking Policy & Terms before sending this booking request.',
        422,
      );
    }
    const note = cleanOccasionNote(occasionNote);
    if (typeof specialOccasion !== 'boolean') {
      throw new MyShilohBookingError('BOOKING_OCCASION_CHOICE_REQUIRED', 'Please choose Yes or No for a special occasion.', 422);
    }
    if (specialOccasion && !note) {
      throw new MyShilohBookingError('BOOKING_OCCASION_REQUIRED', 'Please tell Reception what the occasion is.', 422);
    }
    if (!specialOccasion && note) {
      throw new MyShilohBookingError('BOOKING_OCCASION_CONFLICT', 'Please check your special occasion answer.', 422);
    }
    const { client, phone } = await clientIdentity(crmV2ClientId);
    const service = await canonicalService(serviceId, crmV2ClientId);
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
    const availabilityResult = await slots({ serviceId: service.id, staffId: practitionerId, date, crmV2ClientId });
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
        'An unfinished booking draft is blocking this request. Review or discard the draft before sending a new request. Reload this page if the draft is not shown.',
        409,
        ['Review the unfinished draft. Discarding a draft does not cancel an appointment.'],
      );
    }

    const inserted = await db.query(
      `INSERT INTO booking_intents(
         phone,service_text,preferred_date,preferred_time,therapist_text,
         service_verified,status,policy_version,policy_accepted_at,policy_channel,updated_at
       )
       VALUES($1,$2,$3,$4,$5,TRUE,'awaiting_policy_acceptance',$6,NULL,NULL,NOW())
       ON CONFLICT (phone) DO NOTHING
       RETURNING phone,created_at::text AS created_at`,
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
          `DELETE FROM booking_intents WHERE phone=$1 AND created_at=$2 AND policy_channel='my_shiloh'`,
          [phone, inserted.rows[0].created_at],
        );
        throw new MyShilohBookingError(
          'BOOKING_FINAL_CHECK_FAILED',
          created?.reply || 'That appointment could not be created after the final availability check. Nothing was booked.',
          409,
        );
      }
      const staged = await stageApproval(created, { occasionNote: note, specialOccasion });
      const policy = await depositPolicy.loadPolicy(db);
      const depositExempt = Boolean(service.entitlement) || Number(practitioner.id) === Number(policy.exemptStaffId);
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
            ? service.entitlement ? 'Your booking request is in. One prepaid treatment is reserved while Shiloh confirms your visit. No further payment is due.' : 'Your booking request is in. Your selected time is being held while the Shiloh team confirms it. No booking deposit is required for this appointment.'
            : 'Your booking request is in. Your selected time is being held while the Shiloh team confirms it. You’ll see the deposit step in My Shiloh after approval.'
          : 'Your booking request was created and is being reviewed by Shiloh.',
      };
    } catch (error) {
      await db.query(
        `DELETE FROM booking_intents WHERE phone=$1 AND created_at=$2`,
        [phone, inserted.rows[0].created_at],
      ).catch(() => {});
      throw error;
    }
  }

  async function packageCatalogue({ crmV2ClientId, serviceId }) {
    const service = await canonicalService(serviceId, crmV2ClientId);
    if (!service.entitlement) throw new MyShilohBookingError('PACKAGE_REQUIRED', 'Choose a paid package from My packages.', 409);
    return [{ id: String(service.id), name: service.entitlement.name, category: 'Prepaid treatments', duration: `${service.duration_minutes} min slot`, price: 'R0', description: 'One treatment from your paid package. No further payment due.' }];
  }

  async function policy() { return depositPolicy.loadPolicy(db); }

  return { catalogue, couplesCatalogue, packageCatalogue, practitioners, slots, createRequest, policy, clientAppEligibleStaff, unfinishedDraft, discardDraft };
}

const service = createMyShilohBookingService();

module.exports = {
  MyShilohBookingError,
  positiveId,
  exactDate,
  exactStart,
  cleanOccasionNote,
  localDate,
  localTime,
  slotDto,
  fixedCataloguePrice,
  createMyShilohBookingService,
  ...service,
};
