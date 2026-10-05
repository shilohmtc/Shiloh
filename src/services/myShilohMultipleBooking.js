'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { createMyShilohBookingService, MyShilohBookingError, positiveId, exactStart, localDate, cleanOccasionNote } = require('./myShilohBooking');
const { insertOrdinaryClientAppointment } = require('./clientBookingCommit');
const { createPendingBookingApproval } = require('./clientBookingApproval');
const { ensureBookingApprovalInfrastructure } = require('./clientBookingApprovalSchema');
const { getDefaultActiveLocation } = require('./clinicHours');
const { checkAssistantBookingHours } = require('./assistantBookingHours');
const { checkAuthoritativeSchedule, getConflicts } = require('./adminAvailability');
const { dispatchBookingRequestAlerts } = require('./bookingRequestStaffAlerts');
const { POLICY_VERSION } = require('./bookingPolicy');
const { createBookingDepositPolicyService, percentAmount } = require('./bookingDepositPolicy');
const logger = require('../lib/logger');
const { normalizeName, normalizeMobile } = require('./crmV2ClientService');

const SOURCE = 'shiloh_my_shiloh_multi';
const MAX_BOOKINGS = 10;
const COUPLES_SOURCE = 'shiloh_my_shiloh_couples';

function normalizeGuest(guest) {
  if (!guest || Object.keys(guest).some(key => !['name','mobile','consent'].includes(key))) fail('BOOKING_GUEST_INVALID', 'Enter your guest’s name and mobile number.', 422);
  const name = normalizeName(guest.name), mobile = normalizeMobile(guest.mobile);
  if (!name || !mobile || guest.consent !== true) fail('BOOKING_GUEST_INVALID', 'Enter your guest’s full name and South African mobile number, and confirm their agreement to this booking.', 422);
  return { name,mobile,consent:true };
}

function assertPair(items) {
  if (items.length !== 2 || items[0].staffId === items[1].staffId || items[0].startsAt !== items[1].startsAt) {
    fail('BOOKING_COUPLES_SELECTION', 'Choose two different therapists and one shared start time.', 422);
  }
}

function fail(code, message, status = 409) {
  throw new MyShilohBookingError(code, message, status);
}

function selections(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_BOOKINGS) {
    fail('BOOKING_CART_COUNT', 'Choose between 2 and 10 appointments.', 422);
  }
  return value.map(item => {
    if (!item || Object.keys(item).some(key => !['serviceId', 'staffId', 'startsAt'].includes(key))) {
      fail('BOOKING_CART_SELECTION', 'Please review your selected appointments again.', 422);
    }
    return { serviceId: positiveId(item.serviceId), staffId: positiveId(item.staffId), startsAt: exactStart(item.startsAt).toISOString() };
  });
}

function assertClientWindows(items) {
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      if (new Date(items[left].startsAt) < new Date(items[right].endsAt)
        && new Date(items[right].startsAt) < new Date(items[left].endsAt)) {
        fail('BOOKING_CART_OVERLAP', 'Your appointments overlap. Choose times that let you attend every treatment.');
      }
    }
  }
}

function quoteHash(quote) {
  return crypto.createHash('sha256').update(JSON.stringify(quote)).digest('hex');
}

async function clientGroupApprovalGate(db, groupId) {
  const result = await db.query(`SELECT gm.appointment_id,a.status,aba.status AS approval_status
    FROM appointment_group_members gm JOIN appointments a ON a.id=gm.appointment_id
    LEFT JOIN appointment_booking_approvals aba ON aba.appointment_id=a.id
    WHERE gm.group_id=$1 ORDER BY gm.guest_position,a.id`, [groupId]);
  const members = result.rows;
  return {
    ready: members.length >= 2 && members.every(row => ['scheduled','confirmed'].includes(row.status) && row.approval_status === 'approved'),
    appointmentId: Number(members[0]?.appointment_id),
    appointmentIds: members.map(row => Number(row.appointment_id)),
  };
}

function createMyShilohMultipleBookingService({
  db = pool,
  couples = false,
  booking = createMyShilohBookingService({ db }),
  deposits = createBookingDepositPolicyService({ db }),
  ensureApproval = ensureBookingApprovalInfrastructure,
  stageApproval = createPendingBookingApproval,
  alert = dispatchBookingRequestAlerts,
  locationProvider = getDefaultActiveLocation,
  checkClinic = checkAssistantBookingHours,
  checkSchedule = checkAuthoritativeSchedule,
  conflicts = getConflicts,
  now = () => new Date(),
} = {}) {
  const source = couples ? COUPLES_SOURCE : SOURCE;
  const auditAction = couples ? 'client.couples_booking_created' : 'client.multiple_booking_created';
  async function buildQuote(queryable, crmV2ClientId, raw, { checkSlots = true, guest = null } = {}) {
    const items = selections(raw);
    if (couples) assertPair(items);
    const policy = await deposits.loadPolicy(queryable);
    const treatments = [];
    for (const item of items) {
      const found = await queryable.query(`SELECT s.id,s.name,s.price,s.duration_minutes,s.processing_time_minutes,s.extra_time_minutes,
          st.id AS staff_id,st.display_name AS staff_name
        FROM services s JOIN staff_services ss ON ss.service_id=s.id JOIN staff st ON st.id=ss.staff_id
        WHERE s.id=$1 AND st.id=$2 AND s.status='active' AND st.status='active'
          AND st.resource_type='practitioner' AND st.client_bookable=TRUE
          AND COALESCE(st.business_role,'') <> 'tenant_practitioner'
          AND COALESCE(s.variable_price,FALSE)=FALSE AND s.price IS NOT NULL
          AND s.external_source IS DISTINCT FROM 'shiloh_special'
          AND NOT EXISTS(SELECT 1 FROM service_packages sp WHERE sp.session_service_id=s.id AND sp.status='active')
        FOR SHARE OF s,st,ss`, [item.serviceId, item.staffId]);
      const row = found.rows[0];
      if (!row) fail('BOOKING_CART_SERVICE_CHANGED', 'A treatment or practitioner is no longer available. Review your appointments.');
      const duration = Number(row.duration_minutes || 0) + Number(row.processing_time_minutes || 0) + Number(row.extra_time_minutes || 0);
      const priceCents = Math.round(Number(row.price) * 100);
      if (!Number.isSafeInteger(priceCents) || priceCents < 0 || !Number.isFinite(duration) || duration <= 0) {
        fail('BOOKING_CART_PRICE_UNRESOLVED', 'Shiloh needs to check a treatment’s price or duration before it can be booked.');
      }
      if (new Date(item.startsAt) <= now()) fail('BOOKING_SLOT_PASSED', 'An appointment time has passed. Choose another available time.');
      if (checkSlots) {
        const available = await booking.slots({ serviceId:item.serviceId, staffId:item.staffId, date:localDate(item.startsAt) });
        if (!available.slots.some(slot => new Date(slot.startsAt).getTime() === new Date(item.startsAt).getTime())) {
          fail('BOOKING_SLOT_UNAVAILABLE', 'An appointment time is no longer available. Choose another time.');
        }
      }
      const endsAt = new Date(new Date(item.startsAt).getTime() + duration * 60000).toISOString();
      const exempt = Number(row.staff_id) === Number(policy.exemptStaffId);
      treatments.push({ ...item, endsAt, service:row.name, practitioner:row.staff_name, durationMinutes:duration,
        price:(priceCents / 100).toFixed(2), deposit:exempt ? '0.00' : percentAmount(row.price, policy.rateBasisPoints).toFixed(2) });
    }
    if (!couples) assertClientWindows(treatments);
    return {
      crmV2ClientId:positiveId(crmV2ClientId), policyVersion:POLICY_VERSION, treatments,
      ...(couples ? { guest:normalizeGuest(guest) } : {}),
      total:(treatments.reduce((sum, item) => sum + Math.round(Number(item.price) * 100), 0) / 100).toFixed(2),
      deposit:(treatments.reduce((sum, item) => sum + Math.round(Number(item.deposit) * 100), 0) / 100).toFixed(2),
    };
  }

  async function review({ crmV2ClientId, treatments, guest } = {}) {
    const quote = await buildQuote(db, crmV2ClientId, treatments, { guest });
    return { ...quote, quoteHash:quoteHash(quote) };
  }

  async function createRequest({ crmV2ClientId, treatments, quoteHash:reviewHash, requestId, policyAccepted, specialOccasion, occasionNote, guest } = {}) {
    const items = selections(treatments);
    const clientId = positiveId(crmV2ClientId);
    const companion = couples ? normalizeGuest(guest) : null;
    if (couples) assertPair(items);
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(String(requestId || '')) || !/^[a-f0-9]{64}$/.test(String(reviewHash || ''))) {
      fail('BOOKING_CART_REVIEW_REQUIRED', 'Review your appointments before sending them.', 422);
    }
    if (policyAccepted !== true) fail('BOOKING_POLICY_REQUIRED', 'Please accept Shiloh’s Booking Policy & Terms.', 422);
    const note = cleanOccasionNote(occasionNote);
    if (typeof specialOccasion !== 'boolean' || (specialOccasion && !note) || (!specialOccasion && note)) {
      fail('BOOKING_OCCASION_REQUIRED', 'Please check your special occasion answer and details.', 422);
    }
    const fingerprint = quoteHash({ items, reviewHash, specialOccasion, note, ...(couples ? { guest:companion } : {}) });
    await ensureApproval(db);
    const connection = await db.connect();
    let result;
    try {
      await connection.query('BEGIN');
      for (const staffId of [...new Set(items.map(item => item.staffId))].sort((a, b) => a - b)) {
        await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [staffId]);
      }
      await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-v2-client:${clientId}`]);
      const client = (await connection.query(`SELECT id,name,normalized_mobile,status FROM crm_v2_clients WHERE id=$1 FOR UPDATE`, [clientId])).rows[0];
      if (!client || client.status !== 'active' || !String(client.name || '').trim() || !/^27[678][0-9]{8}$/.test(client.normalized_mobile)) {
        fail('BOOKING_CLIENT_NOT_READY', 'Your profile needs a verified mobile number before you can book.');
      }
      const replay = (await connection.query(`SELECT metadata FROM crm_audit_events
        WHERE action='${auditAction}' AND entity_type='appointment_group'
          AND metadata->>'crmV2ClientId'=$1 AND metadata->>'requestId'=$2 LIMIT 1`, [String(clientId), requestId])).rows[0];
      if (replay) {
        if (replay.metadata.fingerprint !== fingerprint) fail('BOOKING_CART_REQUEST_CHANGED', 'This request was already used for different appointments. Reload your bookings.');
        await connection.query('COMMIT');
        return { ...replay.metadata.result, replay:true };
      }
      const quote = await buildQuote(connection, clientId, items, { guest:companion });
      if (quoteHash(quote) !== reviewHash) fail('BOOKING_CART_QUOTE_CHANGED', 'A price, duration or deposit changed. Review the updated totals before sending.');
      let guestClient = null;
      if (couples) {
        if (companion.mobile === client.normalized_mobile) fail('BOOKING_GUEST_INVALID', 'Use a different mobile number for your guest.', 422);
        await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-v2-mobile:${companion.mobile}`]);
        const found = await connection.query(`SELECT id,name,status FROM crm_v2_clients WHERE normalized_mobile=$1 AND status='active' FOR UPDATE`, [companion.mobile]);
        guestClient = found.rows[0];
        if (guestClient && guestClient.name.trim().toLocaleLowerCase('en-ZA') !== companion.name.toLocaleLowerCase('en-ZA')) {
          fail('BOOKING_GUEST_REVIEW', 'Reception needs to confirm your guest’s details. Please contact Reception to arrange this booking.');
        }
        if (!guestClient) {
          guestClient = (await connection.query(`INSERT INTO crm_v2_clients(name,normalized_mobile,profile_status,mobile_verified_at,source,status,provenance)
            VALUES($1,$2,'minimal',NULL,'my_shiloh_couples','active',$3::jsonb) RETURNING id,name,status`,
          [companion.name,companion.mobile,JSON.stringify({ bookedByCrmV2ClientId:clientId,guestBookingOnly:true,marketingConsent:false })])).rows[0];
        }
        if (!guestClient || Number(guestClient.id) === clientId) fail('BOOKING_GUEST_INVALID', 'Choose a different guest.', 422);
        await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-v2-client:${guestClient.id}`]);
      }
      const location = await locationProvider(connection);
      if (!location?.id) fail('BOOKING_LOCATION_UNRESOLVED', 'Shiloh needs to check the clinic location before booking.');
      const activeLocation = await connection.query(`SELECT id FROM locations WHERE id=$1 AND status='active' FOR SHARE`, [location.id]);
      if (activeLocation.rowCount !== 1) fail('BOOKING_LOCATION_UNRESOLVED', 'The clinic location changed. Please review again.');
      for (const [index,item] of quote.treatments.entries()) {
        const input = { db:connection, staffId:item.staffId, locationId:Number(location.id), startsAt:item.startsAt, endsAt:item.endsAt };
        const clinic = await checkClinic(input);
        const schedule = await checkSchedule(input);
        const existing = await conflicts(input);
        const own = await connection.query(`SELECT id FROM appointments WHERE crm_v2_client_id=$1
          AND status NOT IN ('cancelled','no_show') AND starts_at<$3 AND ends_at>$2 LIMIT 1`, [couples && index === 1 ? guestClient.id : clientId,item.startsAt,item.endsAt]);
        if (!clinic.covered || !schedule.covered || schedule.partialUnavailable
          || (schedule.allDayUnavailable && !schedule.insideAvailableException) || existing.length || own.rowCount) {
          fail('BOOKING_CART_CONFLICT', 'An appointment overlaps an existing booking or is no longer available. Nothing was booked; review your times.');
        }
      }
      const startsAt = new Date(Math.min(...quote.treatments.map(item => new Date(item.startsAt).getTime()))).toISOString();
      const endsAt = new Date(Math.max(...quote.treatments.map(item => new Date(item.endsAt).getTime()))).toISOString();
      const group = await connection.query(`INSERT INTO appointment_groups(group_type,location_id,starts_at,ends_at,status,total_price,currency,source,canonical_subtotal,discount_amount,final_total)
        VALUES('${couples ? 'couples_massage' : 'multi_service_booking'}',$1,$2,$3,'scheduled',$4,'ZAR',$5,$4,0,$4) RETURNING id`, [location.id,startsAt,endsAt,quote.total,source]);
      const groupId = Number(group.rows[0].id);
      const appointmentIds = [];
      for (const [index, item] of quote.treatments.entries()) {
        const appointment = await insertOrdinaryClientAppointment(connection,
          { clientId:null, crmV2ClientId:couples && index === 1 ? guestClient.id : clientId, sourceClientName:couples && index === 1 ? companion.name : client.name }, location.id, item.startsAt,item.endsAt,item.service,item.price);
        const id = Number(appointment.id);
        appointmentIds.push(id);
        await connection.query(`INSERT INTO appointment_services(appointment_id,service_id,position,service_name_snapshot,price_snapshot,duration_minutes_snapshot)
          VALUES($1,$2,1,$3,$4,$5)`, [id,item.serviceId,item.service,item.price,item.durationMinutes]);
        await connection.query(`INSERT INTO appointment_staff(appointment_id,staff_id,position,staff_name_snapshot) VALUES($1,$2,1,$3)`, [id,item.staffId,item.practitioner]);
        await connection.query(`INSERT INTO appointment_group_members(group_id,appointment_id,guest_position,allocated_price) VALUES($1,$2,$3,$4)`, [groupId,id,index+1,item.price]);
        await connection.query(`INSERT INTO booking_policy_acceptances(phone,policy_version,channel,accepted_at,appointment_id,crm_v2_client_id)
          VALUES($1,$2,'my_shiloh',NOW(),$3,$4)`, [client.normalized_mobile,POLICY_VERSION,id,clientId]);
        const approval = await stageApproval(connection, { appointmentId:id, occasionNote:note, specialOccasion }, { schemaReady:true });
        if (!approval) fail('BOOKING_CART_APPROVAL_FAILED', 'The requests could not be prepared safely. Nothing was booked.', 503);
        await connection.query(`INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason)
          VALUES($1,NULL,'scheduled',$2,'My Shiloh multiple booking request; awaiting team approval')`, [id,`client:${clientId}`]);
      }
      result = { status:'pending_resolution', groupId, appointmentIds, total:quote.total, deposit:quote.deposit,
        message:couples ? 'Your booking for two is in. Both times are held while Shiloh reviews the appointments. You can pay one combined deposit from My Shiloh after both are approved.' : 'Your booking requests are in. All selected times are being held while Shiloh reviews them. Once every appointment is approved, you can pay the combined deposit in one payment from My Shiloh.' };
      await connection.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
        VALUES('${auditAction}','appointment_group',$1,$2::jsonb)`, [groupId,JSON.stringify({ crmV2ClientId:clientId,requestId,fingerprint,result,atomic:true,...(couples ? { guestCrmV2ClientId:Number(guestClient.id),guestConsent:true,bookingOnly:true } : {}) })]);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {});
      if (couples && error.code === '23505') fail('BOOKING_GUEST_REVIEW', 'Your guest’s details changed during booking. Please review or contact Reception.');
      throw error;
    } finally { connection.release(); }
    for (const appointmentId of result.appointmentIds) {
      try { await alert({ appointmentId }); }
      catch (error) { logger.error({ err:error,appointmentId }, 'Multiple booking request staff alert failed; canonical hold remains'); }
    }
    return result;
  }
  async function availability({ serviceIds, staffIds, date } = {}) {
    if (!couples || !Array.isArray(serviceIds) || !Array.isArray(staffIds) || serviceIds.length !== 2 || staffIds.length !== 2) fail('BOOKING_COUPLES_SELECTION', 'Choose one treatment and therapist for each person.', 422);
    const services = serviceIds.map(value => positiveId(value)), staff = staffIds.map(value => positiveId(value));
    if (staff[0] === staff[1]) fail('BOOKING_COUPLES_SELECTION', 'Choose two different therapists.', 422);
    const results = await Promise.all(services.map((serviceId,index) => booking.slots({ serviceId,staffId:staff[index],date })));
    const second = new Map(results[1].slots.map(slot => [new Date(slot.startsAt).toISOString(),slot]));
    return { slots:results[0].slots.filter(slot => second.has(new Date(slot.startsAt).toISOString())).map(slot => ({ ...slot,guestEndTime:second.get(new Date(slot.startsAt).toISOString()).endTime })) };
  }
  return { review, createRequest, availability };
}

module.exports = { SOURCE, COUPLES_SOURCE, normalizeGuest, assertPair, MAX_BOOKINGS, selections, assertClientWindows, quoteHash, clientGroupApprovalGate, createMyShilohMultipleBookingService };
