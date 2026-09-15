const { pool } = require('../db/pool');
const { listAvailableSlots } = require('./availabilityService');
const { getDefaultActiveLocation } = require('./clinicHours');
const { checkAssistantBookingHours: checkClinicHours } = require('./assistantBookingHours');
const { getNextOpenClinicDates, shortDateTitle } = require('./clinicDateChoices');
const { checkAuthoritativeSchedule, getConflicts } = require('./adminAvailability');
const {
  normalizePhone,
  normalizeRegistrationMobile,
  resolveClientByWhatsApp,
  profileComplete,
} = require('./clientIdentityOnboarding');
const {
  resolveWhatsAppBookingIdentity,
  CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY,
} = require('./whatsappBookingIdentity');
const { IDENTITY_MODELS } = require('./whatsappCrmV2IdentityCompat');
const {
  POLICY_TEXT,
  POLICY_VERSION,
  ensurePolicySchema,
  isExplicitAcceptance,
  stageCreatedBookingForApproval,
} = require('./bookingPolicy');
const logger = require('../lib/logger');

const SERVICE_EXTERNAL_SOURCE = 'shiloh_special';
const SERVICE_EXTERNAL_ID = 'couples-massage-v1';
const SERVICE_NAME = 'Couples Massage';
const DURATION_MINUTES = 90;
const PRICE = 1080;
const STAFF_NAMES = Object.freeze(['Abigail', 'Christel']);
const BOOKING_SOURCE = 'shiloh_client_whatsapp';

const DATE_PREFIX = 'client_couples_date_';
const TIME_PREFIX = 'client_couples_time_';
const CONFIRM_ACTION = 'client_couples_confirm';
const BACK_ACTION = 'client_couples_back';
const CANCEL_ACTION = 'client_couples_cancel';

function clean(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function formatMoney(value) {
  const whole = Math.round(Number(value));
  return `R${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatDateTime(value) {
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

function validCompanionName(value = '') {
  const name = clean(value);
  if (name.length < 2 || name.length > 100) return null;
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(name)) return null;
  return name;
}

function patchValue(patch, key, currentValue, fallback = null) {
  return Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : (currentValue ?? fallback);
}

function intersectSlots(first = [], second = [], now = Date.now()) {
  const secondKeys = new Set(second.map((slot) => `${new Date(slot.starts_at).toISOString()}|${new Date(slot.ends_at).toISOString()}`));
  return first.filter((slot) => (
    new Date(slot.starts_at).getTime() > now
    && secondKeys.has(`${new Date(slot.starts_at).toISOString()}|${new Date(slot.ends_at).toISOString()}`)
  ));
}

async function getIntent(phone, db = pool) {
  const result = await db.query('SELECT * FROM couples_booking_intents WHERE phone=$1', [normalizePhone(phone)]);
  return result.rows[0] || null;
}

async function hasActiveIntent(phone) {
  return Boolean(await getIntent(phone));
}

async function clearIntent(phone, db = pool) {
  await db.query('DELETE FROM couples_booking_intents WHERE phone=$1', [normalizePhone(phone)]);
}

async function saveIntent(phone, patch = {}, db = pool) {
  const key = normalizePhone(phone);
  const current = (await getIntent(key, db)) || {};
  const result = await db.query(`
    INSERT INTO couples_booking_intents (
      phone, lead_client_id, state, selected_date, selected_starts_at, selected_ends_at,
      companion_name, companion_mobile, policy_version, policy_accepted_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    ON CONFLICT (phone) DO UPDATE SET
      lead_client_id=EXCLUDED.lead_client_id,
      state=EXCLUDED.state,
      selected_date=EXCLUDED.selected_date,
      selected_starts_at=EXCLUDED.selected_starts_at,
      selected_ends_at=EXCLUDED.selected_ends_at,
      companion_name=EXCLUDED.companion_name,
      companion_mobile=EXCLUDED.companion_mobile,
      policy_version=EXCLUDED.policy_version,
      policy_accepted_at=EXCLUDED.policy_accepted_at,
      updated_at=NOW()
    RETURNING *
  `, [
    key,
    patchValue(patch, 'leadClientId', current.lead_client_id),
    patchValue(patch, 'state', current.state, 'choose_date'),
    patchValue(patch, 'selectedDate', current.selected_date),
    patchValue(patch, 'selectedStartsAt', current.selected_starts_at),
    patchValue(patch, 'selectedEndsAt', current.selected_ends_at),
    patchValue(patch, 'companionName', current.companion_name),
    patchValue(patch, 'companionMobile', current.companion_mobile),
    patchValue(patch, 'policyVersion', current.policy_version),
    patchValue(patch, 'policyAcceptedAt', current.policy_accepted_at),
  ]);
  return result.rows[0];
}

async function resolveFoundation(db = pool) {
  const serviceResult = await db.query(`
    SELECT s.id, s.name, s.status, s.duration_minutes, s.processing_time_minutes,
           s.extra_time_minutes, s.variable_price, s.price, s.display_price,
           s.category_id, s.external_source, s.external_id
      FROM services s
     WHERE s.external_source=$1 AND s.external_id=$2
  `, [SERVICE_EXTERNAL_SOURCE, SERVICE_EXTERNAL_ID]);
  if (serviceResult.rows.length !== 1) throw new Error('Couples Massage canonical service is missing or ambiguous');
  const service = serviceResult.rows[0];
  if (
    service.name !== SERVICE_NAME
    || service.status !== 'active'
    || Number(service.duration_minutes) !== DURATION_MINUTES
    || Number(service.processing_time_minutes) !== 0
    || Number(service.extra_time_minutes) !== 0
    || service.variable_price === true
    || Number(service.price) !== PRICE
  ) throw new Error('Couples Massage canonical service contract drifted from 90 min / R1080');

  const staffResult = await db.query(`
    SELECT st.id, st.display_name, st.status, st.resource_type, st.client_bookable
      FROM staff_services ss
      JOIN staff st ON st.id=ss.staff_id
     WHERE ss.service_id=$1
     ORDER BY st.id
  `, [service.id]);
  const staff = staffResult.rows;
  const names = staff.map((row) => clean(row.display_name).toLowerCase()).sort();
  if (staff.length !== 2 || names[0] !== 'abigail' || names[1] !== 'christel') {
    throw new Error('Couples Massage must resolve to exactly Abigail + Christel');
  }
  for (const row of staff) {
    if (row.status !== 'active' || row.resource_type !== 'practitioner' || row.client_bookable !== true) {
      throw new Error(`${row.display_name} is not currently client-bookable for Couples Massage`);
    }
  }
  const byName = new Map(staff.map((row) => [clean(row.display_name).toLowerCase(), row]));
  return { service, staff: STAFF_NAMES.map((name) => byName.get(name.toLowerCase())) };
}

async function listJointSlots(date, locationId = null) {
  const foundation = await resolveFoundation();
  const results = [];
  for (const staff of foundation.staff) {
    results.push(await listAvailableSlots({
      staffId: Number(staff.id),
      serviceId: Number(foundation.service.id),
      date,
      locationId,
      intervalMinutes: 15,
    }));
  }
  if (results.some((result) => !['available', 'no_slots'].includes(result.status))) {
    return { status: 'unavailable', slots: [], foundation, results };
  }
  const slots = intersectSlots(results[0].slots, results[1].slots);
  return { status: slots.length ? 'available' : 'no_slots', slots, foundation, results };
}

async function datePickerInteractive() {
  const location = await getDefaultActiveLocation();
  if (!location) throw new Error('Couples Massage cannot resolve one active clinic location');
  const dates = await getNextOpenClinicDates({ locationId: location.id, count: 7, maxDays: 21 });
  return {
    type: 'list',
    body: [
      '*Couples Massage*',
      `${DURATION_MINUTES} min • ${formatMoney(PRICE)}`,
      `With ${STAFF_NAMES.join(' & ')}`,
      '',
      'Choose a date. We’ll only offer times when both therapists are available.',
    ].join('\n'),
    buttonText: 'Choose date',
    sectionTitle: 'Available dates',
    rows: [
      ...dates.map((entry) => ({ id: `${DATE_PREFIX}${entry.date}`, title: entry.title, description: entry.date })),
      { id: BACK_ACTION, title: 'Back', description: 'Back to Couples & Packages' },
    ],
  };
}

function timePickerInteractive(date, slots) {
  return {
    type: 'list',
    body: `*Couples Massage*\n${shortDateTitle(date)} • ${DURATION_MINUTES} min • ${formatMoney(PRICE)}\n\nThese times are currently clear for both Abigail & Christel:`,
    buttonText: 'Choose time',
    sectionTitle: 'Available times',
    rows: [
      ...slots.slice(0, 9).map((slot) => ({
        id: `${TIME_PREFIX}${new Date(slot.starts_at).getTime()}`,
        title: formatTime(slot.starts_at),
        description: `${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)} • both therapists`,
      })),
      { id: BACK_ACTION, title: 'Back', description: 'Choose another date' },
    ],
  };
}

function reviewInteractive(intent, leadClient) {
  return {
    type: 'button',
    body: [
      '*Review Couples Massage*',
      '',
      `• Service: ${SERVICE_NAME}`,
      `• Duration: ${DURATION_MINUTES} min`,
      `• Price: ${formatMoney(PRICE)}`,
      `• Therapists: ${STAFF_NAMES.join(' & ')}`,
      `• Time: ${formatDateTime(intent.selected_starts_at)}`,
      `• Lead client: ${leadClient.display_name}`,
      `• Companion: ${intent.companion_name}`,
      `• Companion mobile: +${intent.companion_mobile}`,
      '',
      'The companion number is a booking-only backup contact. It is not marketing consent and will only be used for this appointment if Shiloh cannot reach the lead client.',
      '',
      'Confirm these details to continue to Shiloh’s Booking Policy & Terms.',
    ].join('\n'),
    buttons: [
      { id: CONFIRM_ACTION, title: 'Confirm booking' },
      { id: CANCEL_ACTION, title: 'Cancel' },
    ],
  };
}

async function startCouplesMassage(phone) {
  const bookingIdentity = await resolveWhatsAppBookingIdentity(phone);
  if (bookingIdentity.clientIdentity?.identityModel === IDENTITY_MODELS.CRM_V2) {
    return { handled: true, status: 'crm_v2_couples_legacy_boundary', reply: CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY };
  }
  const identity = await resolveClientByWhatsApp(phone);
  if (identity.status !== 'unique' || !profileComplete(identity.client)) {
    return {
      handled: true,
      reply: 'Couples Massage self-service needs one complete registered Shiloh client profile for the person making the booking. Please complete registration first; no booking has been created.',
    };
  }
  await resolveFoundation();
  await saveIntent(phone, {
    leadClientId: identity.client.id,
    state: 'choose_date',
    selectedDate: null,
    selectedStartsAt: null,
    selectedEndsAt: null,
    companionName: null,
    companionMobile: null,
    policyVersion: null,
    policyAcceptedAt: null,
  });
  return { handled: true, interactive: await datePickerInteractive() };
}

async function assertFinalAvailability(db, foundation, location, startsAt, endsAt) {
  if (new Date(startsAt).getTime() <= Date.now()) return { ok: false, reason: 'The selected Couples Massage time has already passed.' };
  const clinic = await checkClinicHours({ db, locationId: location.id, startsAt, endsAt });
  if (!clinic.covered) return { ok: false, reason: 'Shiloh’s clinic hours no longer permit that time.' };

  for (const staff of foundation.staff) {
    const schedule = await checkAuthoritativeSchedule({ db, staffId: Number(staff.id), locationId: location.id, startsAt, endsAt });
    if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
      return { ok: false, reason: `${staff.display_name}’s working schedule no longer permits that time.` };
    }
    const conflicts = await getConflicts({ db, staffId: Number(staff.id), startsAt, endsAt });
    if (conflicts.length) return { ok: false, reason: `${staff.display_name} now has an appointment or block that conflicts with that time.` };
  }

  return { ok: true };
}

async function recordPolicyAcceptance(phone, intent, db = pool) {
  await ensurePolicySchema();
  await db.query(`
    INSERT INTO booking_policy_acceptances
      (phone, policy_version, channel, service_text, preferred_date, preferred_time, therapist_text)
    VALUES ($1,$2,'whatsapp',$3,$4,$5,$6)
  `, [normalizePhone(phone), POLICY_VERSION, SERVICE_NAME, intent.selected_date, formatTime(intent.selected_starts_at), STAFF_NAMES.join(' & ')]);
}

async function commitCouplesMassage(phone) {
  const normalizedPhone = normalizePhone(phone);
  const identity = await resolveClientByWhatsApp(normalizedPhone);
  if (identity.status !== 'unique' || !profileComplete(identity.client)) {
    return { handled: true, status: 'identity_not_ready', reply: 'The lead-client identity is no longer uniquely complete, so nothing has been booked.' };
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const intentResult = await db.query(`
      SELECT * FROM couples_booking_intents
       WHERE phone=$1 AND state='awaiting_policy_acceptance' AND policy_accepted_at IS NOT NULL
       FOR UPDATE
    `, [normalizedPhone]);
    const intent = intentResult.rows[0] || null;
    if (!intent) {
      await db.query('ROLLBACK');
      return { handled: true, status: 'intent_missing', reply: 'This Couples Massage request is no longer ready to confirm. Nothing has been booked.' };
    }
    if (String(intent.lead_client_id) !== String(identity.client.id)) {
      await db.query('ROLLBACK');
      return { handled: true, status: 'identity_changed', reply: 'The lead-client identity changed before confirmation, so nothing has been booked.' };
    }

    const foundation = await resolveFoundation(db);
    const location = await getDefaultActiveLocation(db);
    if (!location) throw new Error('Couples Massage cannot resolve one active clinic location');

    const startsAt = intent.selected_starts_at;
    const endsAt = intent.selected_ends_at;
    if (!startsAt || !endsAt || new Date(endsAt).getTime() - new Date(startsAt).getTime() !== DURATION_MINUTES * 60000) {
      await db.query('ROLLBACK');
      return { handled: true, status: 'invalid_interval', reply: 'The selected Couples Massage interval is no longer exactly 90 minutes. Nothing has been booked.' };
    }

    const lockIds = foundation.staff.map((staff) => Number(staff.id)).sort((a, b) => a - b);
    for (const staffId of lockIds) await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [staffId]);

    const finalAvailability = await assertFinalAvailability(db, foundation, location, startsAt, endsAt);
    if (!finalAvailability.ok) {
      await db.query(`
        UPDATE couples_booking_intents
           SET state='choose_date', selected_date=NULL, selected_starts_at=NULL, selected_ends_at=NULL,
               policy_version=NULL, policy_accepted_at=NULL, updated_at=NOW()
         WHERE phone=$1
      `, [normalizedPhone]);
      await db.query('COMMIT');
      return {
        handled: true,
        status: 'slot_changed',
        reply: `${finalAvailability.reason}\n\nNothing has been booked. Please choose a new date and time; both Abigail and Christel will be rechecked together.`,
      };
    }

    const appointmentResult = await db.query(`
      INSERT INTO appointments
        (client_id, location_id, starts_at, ends_at, status, title, notes, total_price, currency, source)
      VALUES ($1,$2,$3,$4,'scheduled',$5,$6,$7,'ZAR',$8)
      RETURNING id, starts_at, ends_at, status
    `, [identity.client.id, location.id, startsAt, endsAt, SERVICE_NAME,
      `Companion: ${intent.companion_name}. Backup mobile is stored appointment-scoped.`, PRICE, BOOKING_SOURCE]);
    const appointment = appointmentResult.rows[0];

    await db.query(`
      INSERT INTO appointment_services
        (appointment_id, service_id, position, service_name_snapshot, price_snapshot, duration_minutes_snapshot)
      VALUES ($1,$2,1,$3,$4,$5)
    `, [appointment.id, foundation.service.id, SERVICE_NAME, PRICE, DURATION_MINUTES]);

    for (let index = 0; index < foundation.staff.length; index += 1) {
      const staff = foundation.staff[index];
      await db.query(`
        INSERT INTO appointment_staff (appointment_id, staff_id, position, staff_name_snapshot)
        VALUES ($1,$2,$3,$4)
      `, [appointment.id, staff.id, index + 1, staff.display_name]);
    }

    await db.query(`
      INSERT INTO appointment_companions
        (appointment_id, display_name, normalized_mobile, contact_role, marketing_consent)
      VALUES ($1,$2,$3,'booking_backup',FALSE)
    `, [appointment.id, intent.companion_name, intent.companion_mobile]);

    await db.query(`
      INSERT INTO appointment_status_history
        (appointment_id, from_status, to_status, changed_by, reason)
      VALUES ($1,NULL,'scheduled',$2,'Couples Massage: explicit Booking Policy acceptance; Abigail + Christel atomically reserved')
    `, [appointment.id, `client:${normalizedPhone}`]);

    await db.query(`
      INSERT INTO crm_audit_events (action, entity_type, entity_id, metadata)
      VALUES ('client.couples_booking_created','appointment',$1,$2::jsonb)
    `, [appointment.id, JSON.stringify({
      clientId: Number(identity.client.id), serviceId: Number(foundation.service.id),
      staffIds: foundation.staff.map((staff) => Number(staff.id)),
      companionContactRole: 'booking_backup', companionMarketingConsent: false,
      startsAt, endsAt, durationMinutes: DURATION_MINUTES, price: PRICE,
      policyVersion: POLICY_VERSION, bothPractitionersLocked: true, bothPractitionersRechecked: true,
      schedulingAuthority: 'shiloh_canonical',
    })]);

    await db.query('DELETE FROM couples_booking_intents WHERE phone=$1', [normalizedPhone]);
    await db.query('COMMIT');

    return {
      handled: true,
      status: 'created',
      appointmentId: Number(appointment.id),
      reply: [
        `Couples Massage request #${appointment.id} has been created.`,
        `• ${DURATION_MINUTES} min • ${formatMoney(PRICE)}`,
        `• Therapists: ${STAFF_NAMES.join(' & ')}`,
        `• Time: ${formatDateTime(startsAt)}`,
        `• Companion: ${intent.companion_name}`,
        '',
        'Both practitioners were rechecked and reserved together. The companion mobile remains a booking-only backup contact.',
      ].join('\n'),
    };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

async function processCouplesMassageMessage(phone, text) {
  const normalizedPhone = normalizePhone(phone);
  const raw = clean(text);
  const intent = await getIntent(normalizedPhone);
  if (!intent) return { handled: false };

  if (raw === CANCEL_ACTION || /^(cancel|stop|never mind|nevermind)$/i.test(raw)) {
    await clearIntent(normalizedPhone);
    return { handled: true, cancelled: true, reply: 'Couples Massage booking stopped. No appointment was created.' };
  }

  if (raw === BACK_ACTION || raw === '0') {
    if (intent.state === 'choose_date') {
      await clearIntent(normalizedPhone);
      return { handled: true, returnToCouplesPackages: true };
    }
    if (intent.state === 'choose_time') {
      await saveIntent(normalizedPhone, { state: 'choose_date', selectedDate: null, selectedStartsAt: null, selectedEndsAt: null });
      return { handled: true, interactive: await datePickerInteractive() };
    }
    if (intent.state === 'companion_name') {
      await saveIntent(normalizedPhone, { state: 'choose_time', companionName: null, companionMobile: null });
      const joint = await listJointSlots(String(intent.selected_date));
      return joint.slots.length
        ? { handled: true, interactive: timePickerInteractive(String(intent.selected_date), joint.slots) }
        : { handled: true, reply: 'That date no longer has a shared 90-minute opening for Abigail & Christel. Send 0 to choose another date.' };
    }
    if (intent.state === 'companion_mobile') {
      await saveIntent(normalizedPhone, { state: 'companion_name', companionMobile: null });
      return { handled: true, reply: 'Please send your companion’s name.\n\n0️⃣ Back' };
    }
    await saveIntent(normalizedPhone, { state: 'companion_mobile', policyVersion: null, policyAcceptedAt: null });
    return { handled: true, reply: 'Please send your companion’s South African mobile number. We’ll keep it as a booking-only backup contact for this appointment.\n\n0️⃣ Back' };
  }

  if (intent.state === 'choose_date') {
    if (!raw.startsWith(DATE_PREFIX)) return { handled: true, interactive: await datePickerInteractive() };
    const date = raw.slice(DATE_PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { handled: true, interactive: await datePickerInteractive() };
    const joint = await listJointSlots(date);
    await saveIntent(normalizedPhone, { state: 'choose_time', selectedDate: date, selectedStartsAt: null, selectedEndsAt: null });
    if (!joint.slots.length) {
      return { handled: true, reply: `There isn’t a shared 90-minute opening for Abigail & Christel on ${shortDateTitle(date)}.\n\nSend 0 to choose another date.` };
    }
    return { handled: true, interactive: timePickerInteractive(date, joint.slots) };
  }

  if (intent.state === 'choose_time') {
    if (!raw.startsWith(TIME_PREFIX)) {
      const joint = await listJointSlots(String(intent.selected_date));
      if (!joint.slots.length) return { handled: true, reply: 'That date no longer has a shared opening for both therapists. Send 0 to choose another date.' };
      return { handled: true, interactive: timePickerInteractive(String(intent.selected_date), joint.slots) };
    }
    const epoch = Number(raw.slice(TIME_PREFIX.length));
    const joint = await listJointSlots(String(intent.selected_date));
    const slot = joint.slots.find((candidate) => new Date(candidate.starts_at).getTime() === epoch);
    if (!slot) {
      return { handled: true, reply: 'That shared time is no longer available. Please choose one of the currently available times.', interactive: joint.slots.length ? timePickerInteractive(String(intent.selected_date), joint.slots) : undefined };
    }
    await saveIntent(normalizedPhone, { state: 'companion_name', selectedStartsAt: slot.starts_at, selectedEndsAt: slot.ends_at });
    return { handled: true, reply: 'Great. Please send your companion’s name.\n\n0️⃣ Back' };
  }

  if (intent.state === 'companion_name') {
    const name = validCompanionName(raw);
    if (!name) return { handled: true, reply: 'Please send the companion’s name using letters, spaces, apostrophes or hyphens.\n\n0️⃣ Back' };
    await saveIntent(normalizedPhone, { state: 'companion_mobile', companionName: name });
    return {
      handled: true,
      reply: 'Please send your companion’s South African mobile number.\n\nWe’ll only use it about this booking if Shiloh cannot reach the person who made the booking. It will not be treated as marketing consent.\n\n0️⃣ Back',
    };
  }

  if (intent.state === 'companion_mobile') {
    const mobile = normalizeRegistrationMobile(raw);
    if (!mobile) return { handled: true, reply: 'Please send a valid South African mobile number, for example 082 123 4567.\n\n0️⃣ Back' };
    if (mobile === normalizedPhone) return { handled: true, reply: 'The companion backup number needs to be different from the lead client’s WhatsApp number. Please send the companion’s mobile number.\n\n0️⃣ Back' };
    const identity = await resolveClientByWhatsApp(normalizedPhone);
    if (identity.status !== 'unique' || !profileComplete(identity.client)) {
      await clearIntent(normalizedPhone);
      return { handled: true, reply: 'The lead-client identity can no longer be verified safely. The Couples Massage request was cleared and nothing was booked.' };
    }
    const updated = await saveIntent(normalizedPhone, { state: 'review', companionMobile: mobile });
    return { handled: true, interactive: reviewInteractive(updated, identity.client) };
  }

  if (intent.state === 'review') {
    if (raw !== CONFIRM_ACTION && !/^(yes|confirm|confirmed|proceed)$/i.test(raw)) {
      const identity = await resolveClientByWhatsApp(normalizedPhone);
      if (identity.status !== 'unique') return { handled: true, reply: 'The lead-client identity can no longer be verified. Nothing has been booked.' };
      return { handled: true, interactive: reviewInteractive(intent, identity.client) };
    }
    await ensurePolicySchema();
    await saveIntent(normalizedPhone, { state: 'awaiting_policy_acceptance', policyVersion: POLICY_VERSION, policyAcceptedAt: null });
    return { handled: true, reply: POLICY_TEXT };
  }

  if (intent.state === 'awaiting_policy_acceptance') {
    if (/^(decline|i decline|do not agree|don't agree|cancel|stop)$/i.test(raw)) {
      await clearIntent(normalizedPhone);
      return { handled: true, cancelled: true, reply: 'No problem — the Couples Massage request was cancelled and no appointment was created.' };
    }
    if (!isExplicitAcceptance(raw)) {
      return { handled: true, reply: 'I can only continue after explicit acceptance of Shiloh’s Booking Policy & Terms. Reply *I AGREE* to accept, or *DECLINE* to stop.' };
    }
    await ensurePolicySchema();
    const accepted = await saveIntent(normalizedPhone, { policyVersion: POLICY_VERSION, policyAcceptedAt: new Date(), state: 'awaiting_policy_acceptance' });
    await recordPolicyAcceptance(normalizedPhone, accepted);
    try {
      const created = await commitCouplesMassage(normalizedPhone);
      return await stageCreatedBookingForApproval(created);
    } catch (error) {
      logger.error({ err: error }, 'Couples Massage final commit failed');
      return {
        handled: true,
        status: 'commit_failed',
        reply: 'I couldn’t safely complete the Couples Massage booking, so I have not claimed it as confirmed. Please contact Shiloh for assistance; the team can verify the current state before retrying.',
      };
    }
  }

  await clearIntent(normalizedPhone);
  return { handled: false };
}

async function getBookingBackupContact(appointmentId) {
  const result = await pool.query(`
    SELECT appointment_id, display_name, normalized_mobile, contact_role, marketing_consent
      FROM appointment_companions
     WHERE appointment_id=$1 AND contact_role='booking_backup' AND marketing_consent=FALSE
     LIMIT 1
  `, [Number(appointmentId)]);
  return result.rows[0] || null;
}

module.exports = {
  SERVICE_EXTERNAL_SOURCE,
  SERVICE_EXTERNAL_ID,
  SERVICE_NAME,
  DURATION_MINUTES,
  PRICE,
  STAFF_NAMES,
  DATE_PREFIX,
  TIME_PREFIX,
  CONFIRM_ACTION,
  BACK_ACTION,
  CANCEL_ACTION,
  formatMoney,
  validCompanionName,
  intersectSlots,
  hasActiveIntent,
  listJointSlots,
  startCouplesMassage,
  processCouplesMassageMessage,
  commitCouplesMassage,
  getBookingBackupContact,
};
