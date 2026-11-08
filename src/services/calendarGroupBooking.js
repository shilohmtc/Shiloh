const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { createGroupPlanningBookingContext } = require('./groupPlanningBookingContext');
const { groupGuestStorageReady } = require('./groupGuestStorageReadiness');
const { createGroupBookingOrganiserService } = require('./groupBookingOrganiser');
const { createGuestGroupConfirmationService } = require('./guestGroupConfirmation');
const { resolveGuestWithoutMobile } = require('./groupGuestProfiles');
const { PostgresCrmV2ClientRepository } = require('../repositories/crmV2ClientRepository');
const { isOrganiserContactGuest } = require('./crmV2GuestProfile');
const { clientRevision } = require('./workspaceClientMutations');
const { defaultPushService } = require('./myShilohPush');
const { GUEST_BOOKINGS_ENABLED } = require('./groupGuestFeature');
const { createMorningWelcomeOfferService, pricingHash, MorningOfferError, applyCalendarOffer } = require('./morningWelcomeOffer');
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
const { priceLinkedBooking } = require('./calendarCouplesPricing');

const MIN_GROUP_GUESTS = 3;
const MAX_GROUP_GUESTS = 10;
const GROUP_DISCOUNT_CAPABILITY = 'appointment:group:discount';
const COUPLES_EXTERNAL_SOURCE = 'shiloh_special';
const COUPLES_EXTERNAL_ID = 'couples-massage-v1';

function groupError(code, message, httpStatus = 400) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeGuest(value = {}, options = {}) {
  const rawClientId = String(value.clientId || '').trim();
  const clientId = positiveId(value.clientId);
  if (rawClientId && !clientId) throw groupError('GROUP_INVALID_CLIENT', 'Select a valid client profile or clear the client selection.');
  const name = crmV2.normalizeName(value.name);
  const noMobile = value.noMobile === true || value.noMobile === 'on';
  if (noMobile && (options?.allowNoMobile !== true || String(value.mobile ?? '').trim())) throw groupError('GROUP_GUEST_CONTACT_REVIEW', 'Review the guest and organiser contact before continuing.');
  const mobile = noMobile ? null : crmV2.normalizeMobile(value.mobile);
  const dateOfBirth = crmV2.normalizeDateOfBirth(value.dateOfBirth);
  const gender = crmV2.normalizeGender(value.gender);
  if (!name) throw groupError('GROUP_INVALID_NAME', 'Enter the guest’s first name and surname.');
  if (!mobile && !noMobile) throw groupError('GROUP_INVALID_MOBILE', 'Enter a valid South African mobile number for each guest.');
  const firstVisitChoice = value.firstVisitChoice ?? 'unknown';
  if (noMobile && !['first_visit', 'returning', 'unknown'].includes(firstVisitChoice))
    throw groupError('GROUP_GUEST_VISIT_CHOICE', 'Review whether this guest has visited Shiloh before.');
  return { clientId, name, mobile, dateOfBirth, gender, ...(noMobile ? { noMobile: true, firstVisitChoice, ...(value.profileRevision ? { profileRevision: String(value.profileRevision) } : {}) } : {}) };
}

function ensureDistinctGroupGuests(guests) {
  if (guests.length < MIN_GROUP_GUESTS || guests.length > MAX_GROUP_GUESTS) {
    throw groupError('GROUP_GUEST_COUNT_INVALID', 'Add between 3 and 10 guests.');
  }
  if (guests.some(guest => !guest.mobile && guest.noMobile !== true)) throw groupError('GROUP_INVALID_MOBILE', 'Enter a valid mobile or explicitly review this guest without a mobile.');
  const mobiles = guests.map(guest => guest.mobile).filter(Boolean);
  if (new Set(mobiles).size !== mobiles.length) {
    throw groupError('GROUP_DUPLICATE_MOBILE', 'Every guest needs a different mobile number.');
  }
  const selectedIds = guests.map(guest => guest.clientId).filter(Boolean);
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw groupError('GROUP_DUPLICATE_CLIENT', 'Choose a different client profile for every guest.');
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
    throw groupError('GROUP_OUTSIDE_CLINIC_HOURS', 'The full group session does not fit within the clinic’s opening hours.', 409);
  }
  for (const staffId of staffIds) {
    const schedule = await checkAuthoritativeSchedule({ db, staffId, locationId, startsAt, endsAt });
    if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
      throw groupError('GROUP_PRACTITIONER_UNAVAILABLE', 'One of the selected practitioners is not working for the full session. Choose another pair or time.', 409);
    }
    const conflicts = await getConflicts({ db, staffId, startsAt, endsAt });
    if (conflicts.length) {
      throw groupError('GROUP_CONFLICT', 'One of the selected practitioners already has an appointment or blocked time then. Choose another pair or time.', 409);
    }
  }
}

function resolveAssignments(options, rawStaffIds, rawServiceIds) {
  const staffIds = Array.isArray(rawStaffIds) ? rawStaffIds.map(positiveId) : [];
  const serviceIds = Array.isArray(rawServiceIds) ? rawServiceIds.map(positiveId) : [];
  if (staffIds.length < MIN_GROUP_GUESTS || staffIds.length > MAX_GROUP_GUESTS || staffIds.some(id => !id)) {
    throw groupError('GROUP_PRACTITIONERS_REQUIRED', 'Choose an eligible practitioner for every guest.');
  }
  if (serviceIds.length !== staffIds.length || serviceIds.some(id => !id)) {
    throw groupError('GROUP_TREATMENTS_REQUIRED', 'Choose one treatment for every guest.');
  }
  return serviceIds.map((serviceId, index) => {
    const service = options.services.find(item => Number(item.id) === serviceId);
    const practitioner = options.staff.find(person => Number(person.id) === staffIds[index]);
    if (!service || !practitioner || !service.staffIds.map(Number).includes(staffIds[index])) {
      throw groupError(
        'GROUP_INELIGIBLE_SELECTION',
        `Choose a practitioner currently eligible for Guest ${index + 1}’s treatment.`,
        409
      );
    }
    return { guestPosition: index + 1, service, practitioner };
  });
}

function createCalendarGroupBookingService({
  db = pool,
  standardBooking = createCalendarCreateBookingService({ db }),
  morningOffer = db === pool ? createMorningWelcomeOfferService({ db }) : null,
  // Staged locally: enabling requires approved compatible storage and release checks.
  guestBookingsEnabled = GUEST_BOOKINGS_ENABLED,
  organiserService = createGroupBookingOrganiserService(),
  wakeOrganiser = id => defaultPushService.wakeClient(id),
} = {}) {
  const planningContext = createGroupPlanningBookingContext({ organiserService });
  async function requestContext(adminId, id) {
    return planningContext.resolve(db, { principal: await resolveOperator(adminId), id });
  }
  const organiserConfirmation = createGuestGroupConfirmationService({ organiser: organiserService });
  function guestAuthority(admin) {
    const a = admin?.calendarAuthority;
    return a?.calendarScope === 'all_business' && a.serviceScope === 'all_services'
      && hasCapability(a, 'appointment:create') && hasCapability(a, 'client:lookup');
  }
  async function guestAvailable(admin, queryable = db) {
    return guestBookingsEnabled === true && guestAuthority(admin) && await groupGuestStorageReady(queryable);
  }
  async function resolveOperator(adminId) {
    return standardBooking.resolveOperator(adminId);
  }

  async function listOptions(adminId) {
    const admin = await resolveOperator(adminId);
    const standard = await standardBooking.listBookableOptions(adminId);
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
      throw groupError(
        'GROUP_TREATMENTS_UNAVAILABLE',
        'No fixed-price canonical treatments are currently available for a linked Group booking.',
        409
      );
    }
    const eligibleStaffIds = new Set(services.flatMap(service => service.staffIds.map(Number)));
    return {
      services,
      ...(await guestAvailable(admin) ? { guestBooking: { available: true } } : {}),
      staff: standard.staff.filter(person => eligibleStaffIds.has(Number(person.id))),
      authority: {
        ...standard.authority,
        canApplyDiscount: hasCapability(admin.calendarAuthority, GROUP_DISCOUNT_CAPABILITY),
      },
    };
  }

  async function searchClients(adminId, query) {
    const result = await standardBooking.searchClients(adminId, query);
    const guestMode = await guestAvailable(await resolveOperator(adminId));
    if (guestMode) {
      const repository = new PostgresCrmV2ClientRepository(db);
      const clients = [];
      for (const summary of result.clients || []) {
        const row = await repository.getClientById(summary.id);
        const clinic = (await db.query("SELECT 1 FROM crm_v2_client_relationships WHERE client_id=$1 AND relationship_type='clinic' AND owner_staff_id IS NULL AND status='active'", [summary.id])).rows;
        if (!row || row.status !== 'active' || clinic.length !== 1) continue;
        const noMobile = isOrganiserContactGuest(row);
        if (!noMobile && !crmV2.normalizeMobile(row.normalized_mobile)) continue;
        clients.push({ ...summary, name: row.name, mobile: row.normalized_mobile ? `+${row.normalized_mobile}` : '',
          dateOfBirth: row.date_of_birth, gender: row.gender, noMobile,
          profileRevision: clientRevision(row), contactHint: noMobile ? 'No mobile · organiser contact' : summary.contactHint });
      }
      return { ...result, clients };
    }
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
    startTimes: rawStartTimes,
    discount,
    notes,
    useMorningOffer = true,
    organiserClientId,
    planningRequestId,
    planningRequestRevision,
  } = {}) {
    if (typeof useMorningOffer !== 'boolean') throw groupError('BOOKING_OFFER_INVALID', 'Review the promotional offer choice again.');
    const options = await listOptions(adminId);
    const hasRequest = planningRequestId !== undefined || planningRequestRevision !== undefined;
    const context = hasRequest ? await planningContext.resolve(db, { principal: await resolveOperator(adminId),
      id: planningRequestId, revision: planningRequestRevision ?? '', organiserClientId: organiserClientId ?? '' }) : null;
    const guests = (Array.isArray(rawGuests) ? rawGuests : []).map(value => normalizeGuest(value, { allowNoMobile: options.guestBooking?.available === true }));
    if (context && guests.some(guest => String(guest.clientId) === context.organiser.clientId
      && (guest.name !== context.organiser.name || guest.mobile !== context.organiser.mobile)))
      throw groupError('GROUP_REQUEST_ORGANISER_MISMATCH', 'Select the enquiry contact’s current profile if they are also receiving a treatment.', 409);
    let guestContact = null;
    if (guests.some(guest => guest.noMobile)) {
      const reviewedOrganiser = await organiserService.review(db, { adminId, organiserClientId });
      const repository = new PostgresCrmV2ClientRepository(db);
      for (const guest of guests.filter(item => item.noMobile && item.clientId)) {
        const current = await repository.getClientById(guest.clientId);
        const clinic = (await db.query("SELECT 1 FROM crm_v2_client_relationships WHERE client_id=$1 AND relationship_type='clinic' AND owner_staff_id IS NULL AND status='active'", [guest.clientId])).rows;
        if (!current || current.status !== 'active' || !isOrganiserContactGuest(current) || clinic.length !== 1)
          throw groupError('GROUP_GUEST_CHANGED', 'Select the current active guest profile again.', 409);
        guest.profileRevision = clientRevision(current);
      }
      guestContact = { reviewedOrganiser, reviewKey: crypto.randomBytes(24).toString('base64url') };
    }
    ensureDistinctGroupGuests(guests);
    const assignments = resolveAssignments(options, rawStaffIds, rawServiceIds);
    if (assignments.length !== guests.length) {
      throw groupError('GROUP_ASSIGNMENT_COUNT_INVALID', 'Choose one treatment and practitioner for every guest.');
    }
    let pricing = priceLinkedBooking({
      prices: assignments.map(item => item.service.price),
      discount,
      canDiscount: options.authority.canApplyDiscount,
      minGuests: MIN_GROUP_GUESTS,
      maxGuests: MAX_GROUP_GUESTS,
    });
    const startTimes = Array.isArray(rawStartTimes) ? rawStartTimes : [];
    const location = await getDefaultActiveLocation(db);
    if (!location?.id) throw groupError('GROUP_LOCATION_UNRESOLVED', 'The clinic location could not be confirmed.', 409);

    const resolved = [];
    for (let index = 0; index < assignments.length; index += 1) {
      const assignment = assignments[index];
      const localDateTime = canonicalLocalDateTimeFromInputs(date, startTimes[index] || time);
      const window = await resolveWindow(db, localDateTime, Number(assignment.service.durationMinutes));
      if (new Date(window.starts_at).getTime() <= Date.now()) {
        throw groupError('GROUP_PAST_TIME', 'Choose a future start time.');
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

    for (let left = 0; left < resolved.length; left += 1) {
      for (let right = left + 1; right < resolved.length; right += 1) {
        if (Number(resolved[left].practitioner.id) !== Number(resolved[right].practitioner.id)) continue;
        const overlaps = new Date(resolved[left].startsAt) < new Date(resolved[right].endsAt)
          && new Date(resolved[right].startsAt) < new Date(resolved[left].endsAt);
        if (overlaps) throw groupError('GROUP_INTERNAL_CONFLICT', 'A practitioner cannot treat two group guests at overlapping times.', 409);
      }
    }

    const startsAt = new Date(Math.min(...resolved.map(item => new Date(item.startsAt).getTime()))).toISOString();
    const endsAt = new Date(Math.max(...resolved.map(item => new Date(item.endsAt).getTime()))).toISOString();
    const offerPricing = morningOffer ? await morningOffer.calendarQuote(resolved, guests, { useOffer: useMorningOffer, otherPromotion: pricing.discountAmount > 0, allowNoMobile: Boolean(guestContact) }) : null;
    pricing = applyCalendarOffer(pricing, offerPricing);
    const payload = {
      ...(offerPricing ? { morningOffer: { hash: pricingHash(offerPricing), useOffer: useMorningOffer } } : {}),
      guests,
      ...(context ? { requestContext: context, requestReviewKey: crypto.randomBytes(24).toString('base64url') } : {}),
      ...(guestContact ? { guestContact } : {}),
      assignments: resolved.map(item => ({
        guestPosition: item.guestPosition,
        staffId: Number(item.practitioner.id),
        serviceId: Number(item.service.id),
        durationMinutes: Number(item.service.durationMinutes),
        unitPrice: Number(item.service.price),
        startsAt: new Date(item.startsAt).toISOString(),
        endsAt: new Date(item.endsAt).toISOString(),
      })),
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
      `INSERT INTO admin_group_booking_sessions(admin_id,payload,state)
       VALUES($1,$2::jsonb,'confirm')
       ON CONFLICT(admin_id) DO UPDATE SET payload=EXCLUDED.payload,state='confirm',updated_at=NOW()`,
      [Number(adminId), JSON.stringify(payload)]
    );
    return {
      status: 'pending_confirmation',
      review: {
        ...(context ? { requestContext: context, requestReviewKey: payload.requestReviewKey } : {}),
        ...(guestContact ? { guestContact: { organiser: guestContact.reviewedOrganiser, reviewKey: guestContact.reviewKey } } : {}),
        guests: guests.map(guest => ({ ...guest, clientId: guest.clientId ? String(guest.clientId) : null })),
        assignments: resolved.map(item => ({
          guestPosition: item.guestPosition,
          practitioner: item.practitioner,
          service: item.service,
          startsAt: new Date(item.startsAt).toISOString(),
          endsAt: new Date(item.endsAt).toISOString(),
        })),
        startsAt,
        endsAt,
        pricing,
        ...(offerPricing ? { offerPricing, quoteHash:pricingHash(offerPricing) } : {}),
        price: displayPrice(pricing.total),
      },
    };
  }

  async function discard({ adminId, planningRequestId, requestDraftKey } = {}) {
    await resolveOperator(adminId);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const payload = (await client.query('SELECT payload FROM admin_group_booking_sessions WHERE admin_id=$1 FOR UPDATE', [Number(adminId)])).rows[0]?.payload;
      if (!payload) { await client.query('COMMIT'); return { status: 'no_pending' }; }
      const scoped = planningRequestId !== undefined || requestDraftKey !== undefined;
      if (payload.requestContext || scoped) {
        if (!payload.requestContext || String(planningRequestId) !== String(payload.requestContext.requestId)
          || typeof requestDraftKey !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(requestDraftKey)
          || requestDraftKey !== payload.requestReviewKey)
          throw groupError('GROUP_REQUEST_REVIEW_CHANGED', 'A different or unchecked booking review is pending. Review this enquiry again before discarding it.', 409);
      }
      await client.query('DELETE FROM admin_group_booking_sessions WHERE admin_id=$1', [Number(adminId)]);
      await client.query('COMMIT');
      return { status: 'discarded' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function confirm({ adminId, quoteHash, reviewKey } = {}) {
    const admin = await resolveOperator(adminId);
    const currentOptions = await listOptions(adminId);
    const client = await db.connect();
    const appointmentIds = [];
    const obligations = [];
    let guestObligation = null;
    const directAppointmentIds = [];
    try {
      await client.query('BEGIN');
      const draftResult = await client.query(
        `SELECT payload FROM admin_group_booking_sessions WHERE admin_id=$1 AND state='confirm' FOR UPDATE`,
        [Number(adminId)]
      );
      const payload = draftResult.rows[0]?.payload;
      const pendingReviewKey = payload?.requestReviewKey || payload?.guestContact?.reviewKey;
      if (!payload || (reviewKey !== undefined && reviewKey !== pendingReviewKey)) {
        // Recover the exact committed review even if another tab has prepared a
        // newer draft. An old key must never consume that unrelated draft.
        if (guestAuthority(admin) && typeof reviewKey === 'string' && /^[A-Za-z0-9_-]{32}$/.test(reviewKey)) {
          const prior = (await client.query(`SELECT g.id,g.starts_at,e.metadata FROM crm_audit_events e
            JOIN appointment_groups g ON g.id::text=e.entity_id::text
            WHERE e.action='admin.group_booking_created' AND e.entity_type='appointment_group'
              AND e.actor_admin_id=$1 AND (e.metadata->>'requestReviewKey'=$2 OR ($3::boolean AND e.metadata->>'guestReviewKey'=$2))
              AND g.created_by_admin_id=$1 AND g.source='shiloh_calendar_group' LIMIT 2`, [Number(adminId), reviewKey, guestBookingsEnabled])).rows;
          if (prior.length === 1) {
            await client.query('COMMIT');
            return { status: 'created', replayed: true, ...(prior[0].metadata.planningRequestId ? { planningRequestId: Number(prior[0].metadata.planningRequestId) } : {}), groupId: Number(prior[0].id), startsAt: new Date(prior[0].starts_at).toISOString(), appointmentIds: prior[0].metadata.appointmentIds };
          }
        }
        if (payload) throw groupError(payload.requestContext ? 'GROUP_REQUEST_REVIEW_CHANGED' : payload.guestContact ? 'GROUP_GUEST_CONTACT_REVIEW' : 'GROUP_REVIEW_CHANGED', 'This booking review changed. Review the current group before confirming.', 409);
        throw groupError('GROUP_NO_PENDING', 'There is no Group booking review waiting to be confirmed.', 409);
      }
      const context = payload.requestContext ? await planningContext.resolve(client, {
        principal: await standardBooking.resolveOperator(adminId), id: payload.requestContext.requestId,
        revision: payload.requestContext.revision, organiserClientId: payload.requestContext.organiser.clientId, lock: true,
      }) : null;
      if (context && payload.requestReviewKey !== reviewKey)
        throw groupError('GROUP_REQUEST_REVIEW_CHANGED', 'Review the current enquiry booking before confirming.', 409);
      const guestMode = Boolean(payload.guestContact);
      if (guestMode && (!(await guestAvailable(admin, client)) || (context ? payload.requestReviewKey : payload.guestContact.reviewKey) !== reviewKey))
        throw groupError('GROUP_GUEST_CONTACT_REVIEW', 'Review the current guests and organiser before creating the booking.', 409);
      if(payload.morningOffer && payload.morningOffer.hash!==quoteHash) throw new MorningOfferError('This booking review changed. Review its current total before creating the appointments.');
      const guests = payload.guests.map(value => normalizeGuest(value, { allowNoMobile: guestMode }));
      if (guests.some(guest => guest.noMobile) !== guestMode)
        throw groupError('GROUP_GUEST_CONTACT_REVIEW', 'Review the guest contact choices again.', 409);
      ensureDistinctGroupGuests(guests);
      const payloadAssignments = Array.isArray(payload.assignments) ? payload.assignments : [];
      const assignments = resolveAssignments(
        currentOptions,
        payloadAssignments.map(item => item.staffId),
        payloadAssignments.map(item => item.serviceId)
      );
      if (assignments.length !== guests.length) {
        throw groupError('GROUP_ASSIGNMENT_COUNT_INVALID', 'The reviewed guest assignments changed. Nothing was created.');
      }
      const lockedStaffIds = assignments.map(item => Number(item.practitioner.id)).sort((a, b) => a - b);
      for (const staffId of lockedStaffIds) await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [staffId]);
      for (const mobile of guests.map(guest => guest.mobile).filter(Boolean).sort()) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`crm-v2-mobile:${mobile}`]);
      }

      const selections = [];
      for (let index = 0; index < assignments.length; index += 1) {
        const assignment = assignments[index];
        const selected = await client.query(
          `SELECT sv.id AS service_id,sv.name AS service_name,sv.status AS service_status,
                  sv.duration_minutes,sv.processing_time_minutes,sv.extra_time_minutes,sv.price,sv.variable_price,sc.name AS category_name,
                  st.id AS staff_id,st.display_name AS staff_name,st.status AS staff_status
             FROM services sv
             LEFT JOIN service_categories sc ON sc.id=sv.category_id
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
          throw groupError('GROUP_ELIGIBILITY_CHANGED', 'A treatment or practitioner is no longer eligible. Nothing was created; review the booking again.', 409);
        }
        if (
          durationMinutes(row) <= 0
          || row.variable_price
          || row.price == null
          || durationMinutes(row) !== Number(snapshot.durationMinutes)
          || Number(row.price) !== Number(snapshot.unitPrice)
        ) {
          throw groupError('GROUP_SERVICE_CHANGED', 'A selected treatment’s duration or price changed. Nothing was created; review the booking again.', 409);
        }
        selections.push(row);
      }

      let pricing = priceLinkedBooking({
        prices: selections.map(row => Number(row.price)),
        discount: payload.discount,
        canDiscount: currentOptions.authority.canApplyDiscount,
        minGuests: MIN_GROUP_GUESTS,
        maxGuests: MAX_GROUP_GUESTS,
      });
      const location = await client.query(`SELECT id FROM locations WHERE id=$1 AND status='active' FOR SHARE`, [payload.locationId]);
      if (location.rowCount !== 1) throw groupError('GROUP_LOCATION_CHANGED', 'The clinic location is no longer active. Nothing was created.', 409);
      const reviewedStarts = payloadAssignments.map(item => new Date(item.startsAt));
      if (reviewedStarts.some(value => !Number.isFinite(value.getTime()) || value.getTime() <= Date.now())) {
        throw groupError('GROUP_PAST_TIME', 'The reviewed start time has passed. Nothing was created.', 409);
      }
      const endsAt = selections.map((row, index) => new Date(reviewedStarts[index].getTime() + durationMinutes(row) * 60000).toISOString());
      for (let left = 0; left < selections.length; left += 1) {
        for (let right = left + 1; right < selections.length; right += 1) {
          if (Number(selections[left].staff_id) !== Number(selections[right].staff_id)) continue;
          const overlaps = reviewedStarts[left] < new Date(endsAt[right]) && reviewedStarts[right] < new Date(endsAt[left]);
          if (overlaps) throw groupError('GROUP_INTERNAL_CONFLICT', 'A practitioner cannot treat two group guests at overlapping times. Nothing was created.', 409);
        }
      }
      for (let index = 0; index < selections.length; index += 1) {
        await assertPairAvailable({
          db: client,
          staffIds: [Number(selections[index].staff_id)],
          locationId: payload.locationId,
          startsAt: reviewedStarts[index].toISOString(),
          endsAt: endsAt[index],
        });
      }

      const resolvedClients = [];
      for (const [index, guest] of guests.entries()) {
        if (guest.noMobile) {
          const resolved = await resolveGuestWithoutMobile(client, { guest, adminId: admin.id,
            reviewKey: payload.guestContact.reviewKey, guestPosition: index + 1 });
          resolvedClients.push(resolved.client);
          continue;
        }
        const exact = await client.query(
          `SELECT * FROM crm_v2_clients WHERE normalized_mobile=$1 AND status='active' ORDER BY id FOR UPDATE`,
          [guest.mobile]
        );
        let row;
        if (guest.clientId) {
          row = exact.rows.find(item => Number(item.id) === guest.clientId);
          if (!row || exact.rowCount !== 1) throw groupError('GROUP_CLIENT_CHANGED', 'A selected client or mobile changed. Nothing was created; select the client again.', 409);
          // The enquiry contact is the source identity, not editable guest input.
          if (context && String(row.id) === context.organiser.clientId) {
            resolvedClients.push(row);
            continue;
          }
          const updated = await client.query(
            `UPDATE crm_v2_clients SET name=$2,date_of_birth=COALESCE($3::date,date_of_birth),gender=COALESCE($4,gender),
                    profile_status=CASE WHEN COALESCE($3::date,date_of_birth) IS NOT NULL AND COALESCE($4,gender) IS NOT NULL THEN 'registered' ELSE 'minimal' END,updated_at=NOW(),
                    provenance=provenance || $5::jsonb WHERE id=$1 RETURNING *`,
            [row.id, guest.name, guest.dateOfBirth, guest.gender, JSON.stringify({ lastGroupBookingProfileReview: { actorAdminId: Number(admin.id) } })]
          );
          row = updated.rows[0];
        } else {
          if (exact.rowCount) throw groupError('GROUP_EXISTING_CLIENT', 'That mobile already belongs to a client. Nothing was created; find and select that client instead.', 409);
          const inserted = await client.query(
            `INSERT INTO crm_v2_clients(name,normalized_mobile,date_of_birth,gender,profile_status,mobile_verified_at,source,status,provenance)
             VALUES($1,$2,$3::date,$4::text,CASE WHEN $3::date IS NOT NULL AND $4::text IS NOT NULL THEN 'registered' ELSE 'minimal' END,NULL,'staff','active',$5::jsonb) RETURNING *`,
            [guest.name, guest.mobile, guest.dateOfBirth, guest.gender, JSON.stringify({ createdVia: 'calendar_group_booking', actorAdminId: Number(admin.id) })]
          );
          row = inserted.rows[0];
        }
        resolvedClients.push(row);
      }
      if (new Set(resolvedClients.map(row => Number(row.id))).size !== resolvedClients.length) {
        throw groupError('GROUP_DUPLICATE_CLIENT', 'Choose a different client profile for every guest.');
      }

      let offerPricing = null;
      if (morningOffer) {
        const quotedPeople = guests.map((guest, index) => guest.noMobile ? { ...guest,
          offerIdentityKey: guest.clientId ? `client:${guest.clientId}` : `guest-slot:${index + 1}`,
          clientId: resolvedClients[index].id } : guest);
        offerPricing = await morningOffer.calendarQuote(selections.map((row, index) => ({ ...row, startsAt: reviewedStarts[index].toISOString() })), quotedPeople,
          { queryable: client, lock: true, useOffer: payload.morningOffer?.useOffer ?? true, otherPromotion: pricing.discountAmount > 0, allowNoMobile: guestMode });
        morningOffer.assertReviewed(offerPricing, payload.morningOffer?.hash, { required: Boolean(payload.morningOffer) });
        pricing = applyCalendarOffer(pricing, offerPricing);
      }
      const groupEndsAt = new Date(Math.max(...endsAt.map(value => new Date(value).getTime()))).toISOString();
      const discountingPrincipalId = pricing.discountAmount > 0 ? Number(admin.id) : null;
      const groupResult = await client.query(
        `INSERT INTO appointment_groups(
           group_type,location_id,starts_at,ends_at,status,total_price,currency,source,created_by_admin_id,
           canonical_subtotal,discount_type,discount_value,discount_amount,discount_reason,final_total,discounted_by_admin_id
         ) VALUES(
           'group_booking',$1,$2,$3,'scheduled',$4,'ZAR','shiloh_calendar_group',$5,
           $6,$7,$8,$9,$10,$11,$12
         ) RETURNING id`,
        [
          payload.locationId,
          new Date(Math.min(...reviewedStarts.map(value => value.getTime()))).toISOString(),
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
      for (let index = 0; index < selections.length; index += 1) {
        const person = resolvedClients[index];
        const selection = selections[index];
        const appointmentResult = await client.query(
          `INSERT INTO appointments(client_id,crm_v2_client_id,source_client_name,location_id,starts_at,ends_at,status,title,notes,total_price,currency,source)
           VALUES(NULL,$1,$2,$3,$4,$5,'scheduled',$6,$7,$8,'ZAR','shiloh_calendar_group') RETURNING id`,
          [
            person.id,
            person.name,
            payload.locationId,
            reviewedStarts[index].toISOString(),
            endsAt[index],
            selection.service_name,
            payload.notes || null,
            pricing.allocations[index],
          ]
        );
        const appointmentId = appointmentResult.rows[0].id;
        if (offerPricing) await morningOffer.record(client, { appointmentId, clientId: person.id, price: offerPricing.items[index] });
        appointmentIds.push(Number(appointmentId));
        await client.query(
          `INSERT INTO appointment_services(appointment_id,service_id,position,service_name_snapshot,price_snapshot,duration_minutes_snapshot)
           VALUES($1,$2,1,$3,$4,$5)`,
          [appointmentId, selection.service_id, selection.service_name, pricing.allocations[index], durationMinutes(selection)]
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
           VALUES($1,NULL,'scheduled',$2,'Atomic Group booking creation')`,
          [appointmentId, `admin:${admin.id}:${admin.display_name}`]
        );
        if (guests[index].noMobile) continue;
        directAppointmentIds.push(Number(appointmentId));
        const obligation = await queueCustomerBookingConfirmation(appointmentId, { db: client });
        obligations.push(obligation);
        if (!obligation?.queued && obligation?.status !== 'sent') {
          throw groupError('GROUP_CONFIRMATION_QUEUE_FAILED', 'Client confirmations could not be secured, so nothing was created.', 503);
        }
      }
      if (context) await organiserService.bind(client, { groupId, adminId: admin.id, reviewedOrganiser: context.organiser });
      if (guestMode) {
        guestObligation = await organiserConfirmation.queue(client, { groupId, adminId: admin.id,
          reviewedOrganiser: payload.guestContact.reviewedOrganiser });
      }
      await client.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         VALUES($1,'admin.group_booking_created','appointment_group',$2,$3::jsonb)`,
        [
          Number(admin.id),
          groupId,
          JSON.stringify({
            appointmentIds,
            ...(context ? { planningRequestId: context.requestId, requestReviewKey: payload.requestReviewKey } : {}),
            ...(guestMode ? { guestReviewKey: payload.guestContact.reviewKey, organiserNotificationId: guestObligation.notificationId } : {}),
            staffIds: selections.map(row => Number(row.staff_id)),
            serviceIds: selections.map(row => Number(row.service_id)),
            clientIds: resolvedClients.map(row => Number(row.id)),
            ...(guestMode ? { guestOfferDeclarations: guests.flatMap((guest, index) => guest.noMobile ? [{
              clientId: Number(resolvedClients[index].id), firstVisitChoice: guest.firstVisitChoice,
              discount: offerPricing?.items[index]?.discount || '0.00',
            }] : []) } : {}),
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
      await client.query(`DELETE FROM admin_group_booking_sessions WHERE admin_id=$1`, [Number(admin.id)]);
      await client.query('COMMIT');
      const confirmations = await Promise.all(directAppointmentIds.map(async appointmentId => {
        try { return await sendCustomerBookingConfirmationForAppointment(appointmentId); }
        catch (_error) { return { sent: false, deliveryStatus: 'retry_pending', retryable: true }; }
      }));
      let organiserDelivery = null;
      if (guestObligation) {
        try { organiserDelivery = await wakeOrganiser(guestObligation.organiserClientId); }
        catch (_error) { organiserDelivery = { accepted: 0, retryable: true }; }
      }
      return {
        status: 'created',
        ...(context ? { planningRequestId: context.requestId } : {}),
        ...(guestObligation ? { guestObligation, organiserDelivery } : {}),
        groupId: Number(groupId),
        startsAt: payload.startsAt,
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

  return { resolveOperator, listOptions, requestContext, searchClients, prepare, discard, confirm };
}

module.exports = {
  MIN_GROUP_GUESTS,
  MAX_GROUP_GUESTS,
  GROUP_DISCOUNT_CAPABILITY,
  createCalendarGroupBookingService,
  normalizeGuest,
  ensureDistinctGroupGuests,
  groupError,
};
