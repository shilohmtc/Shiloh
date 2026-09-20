'use strict';

const { pool } = require('../db/pool');

const WELCOME_VOUCHER_TERMS = Object.freeze([
  'R100 off one treatment priced at R450 or more.',
  'Valid for 60 days from the date it is unlocked.',
  'One voucher per verified Shiloh client; it cannot be transferred or exchanged for cash.',
  'Not valid for gift vouchers, packages or products, and cannot be combined with another promotional voucher.',
  'Shiloh Rewards are earned only on the amount actually paid.',
]);

class MyShilohWelcomeVoucherError extends Error {
  constructor(code, message, httpStatus = 400, resolution = []) {
    super(message);
    this.name = 'MyShilohWelcomeVoucherError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.resolution = resolution;
  }
}

function positiveId(value, label = 'record') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_INVALID_ID', `A valid ${label} is required.`, 422, ['Reload My Shiloh.', 'Try again from your voucher card.']);
  }
  return id;
}

function operationKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_INVALID_REQUEST', 'That request could not be verified.', 422, ['Reload My Shiloh.', 'Choose the booking again.']);
  }
  return key;
}

function registrationProgress(row = {}) {
  const mobileVerified = Boolean(row.mobile_verified_at);
  const detailsComplete = Boolean(String(row.name || '').trim() && row.date_of_birth && row.gender);
  const registrationComplete = mobileVerified && detailsComplete && row.profile_status === 'registered';
  return {
    complete: registrationComplete,
    steps: [
      { key: 'mobile', label: 'Verify your WhatsApp number', complete: mobileVerified },
      { key: 'details', label: 'Complete your personal details', complete: detailsComplete },
      { key: 'registration', label: 'Finish registration', complete: registrationComplete },
    ],
  };
}

function publicVoucher(row) {
  if (!row) return null;
  return {
    state: String(row.state),
    amount: Number(row.amount),
    minimumBookingValue: Number(row.minimum_booking_value),
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    redeemedAt: row.redeemed_at ? new Date(row.redeemed_at).toISOString() : null,
  };
}

function publicBooking(row) {
  return {
    id: Number(row.id),
    startsAt: new Date(row.starts_at).toISOString(),
    service: String(row.service_name || 'Shiloh treatment'),
    total: Number(row.total_price),
    outstanding: Number(row.outstanding),
  };
}

function createMyShilohWelcomeVoucherService({ db = pool, now = () => new Date() } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh welcome voucher database is required');

  async function loadAuthority(queryable, clientId, { lock = false } = {}) {
    const result = await queryable.query(
      `SELECT id,name,date_of_birth,gender,profile_status,mobile_verified_at,status
         FROM crm_v2_clients
        WHERE id=$1 AND status='active'
        LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
      [clientId],
    );
    return result.rows[0] || null;
  }

  async function syncGrant({ crmV2ClientId } = {}) {
    const clientId = positiveId(crmV2ClientId, 'client');
    const authority = await loadAuthority(db, clientId);
    if (!authority) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_CLIENT_UNAVAILABLE', 'Your active Shiloh profile is unavailable.', 404, ['Sign in again with your verified WhatsApp number.', 'Contact Shiloh if the problem continues.']);
    const progress = registrationProgress(authority);
    if (progress.complete) {
      await db.query(
        `INSERT INTO my_shiloh_welcome_vouchers(crm_v2_client_id,amount,minimum_booking_value,issued_at,expires_at)
         SELECT $1,s.amount,s.minimum_booking_value,$2::timestamptz,$2::timestamptz + make_interval(days => s.validity_days)
           FROM my_shiloh_welcome_voucher_settings s
          WHERE s.singleton=TRUE AND s.active=TRUE AND s.activated_at<=$2::timestamptz
         ON CONFLICT(crm_v2_client_id) DO NOTHING`,
        [clientId, now()],
      );
    }
    await db.query(
      `UPDATE my_shiloh_welcome_vouchers
          SET state='expired',updated_at=NOW()
        WHERE crm_v2_client_id=$1 AND state='available' AND expires_at<=$2::timestamptz`,
      [clientId, now()],
    );
    const voucher = (await db.query(
      `SELECT id,state,amount,minimum_booking_value,issued_at,expires_at,redeemed_at
         FROM my_shiloh_welcome_vouchers WHERE crm_v2_client_id=$1`,
      [clientId],
    )).rows[0] || null;
    return { progress, voucher };
  }

  async function eligibleBookings(clientId, voucher) {
    if (!voucher || voucher.state !== 'available') return [];
    const result = await db.query(
      `SELECT a.id,a.starts_at,a.total_price,
              COALESCE((SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.position) FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Shiloh treatment') AS service_name,
              GREATEST(0,a.total_price
                - COALESCE((SELECT SUM(CASE WHEN ple.entry_type='payment' THEN ple.amount ELSE -ple.amount END) FROM payment_ledger_entries ple WHERE ple.payment_account_id=bpa.id),0)
                - COALESCE((SELECT SUM(bla.amount) FROM booking_loyalty_allocations bla WHERE bla.booking_payment_account_id=bpa.id AND bla.state='applied'),0)
                - COALESCE((SELECT SUM(wva.amount) FROM booking_welcome_voucher_allocations wva WHERE wva.booking_payment_account_id=bpa.id AND wva.state='applied'),0)) AS outstanding
         FROM appointments a
         LEFT JOIN booking_payment_accounts bpa ON bpa.appointment_id=a.id
        WHERE a.crm_v2_client_id=$1
          AND a.client_id IS NULL
          AND a.status IN ('scheduled','confirmed')
          AND a.starts_at>$2::timestamptz
          AND a.total_price>=$3
          AND NOT EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.appointment_id=a.id)
          AND NOT EXISTS(SELECT 1 FROM package_session_redemptions psr WHERE psr.appointment_id=a.id AND psr.status IN ('reserved','redeemed'))
        ORDER BY a.starts_at,a.id
        LIMIT 10`,
      [clientId, now(), voucher.minimum_booking_value],
    );
    return result.rows.filter((row) => Number(row.outstanding) >= Number(voucher.amount)).map(publicBooking);
  }

  async function getClientModel({ crmV2ClientId } = {}) {
    const clientId = positiveId(crmV2ClientId, 'client');
    const synced = await syncGrant({ crmV2ClientId: clientId });
    return {
      version: 'my_shiloh_welcome_voucher_v1',
      eligibility: synced.progress,
      voucher: publicVoucher(synced.voucher),
      eligibleBookings: await eligibleBookings(clientId, synced.voucher),
      terms: [...WELCOME_VOUCHER_TERMS],
    };
  }

  async function applyToBooking({ crmV2ClientId, sessionId, appointmentId, operationId } = {}) {
    const clientId = positiveId(crmV2ClientId, 'client');
    const secureSessionId = positiveId(sessionId, 'secure session');
    const bookingId = positiveId(appointmentId, 'booking');
    const key = operationKey(operationId);
    if (typeof db.connect !== 'function') throw new Error('Welcome voucher redemption requires a transactional database');
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const session = (await client.query(
        `SELECT id FROM client_browser_sessions WHERE id=$1 AND crm_v2_client_id=$2 AND revoked_at IS NULL AND expires_at>$3::timestamptz`,
        [secureSessionId, clientId, now()],
      )).rows[0];
      if (!session) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_SESSION_EXPIRED', 'Your secure session has expired.', 401, ['Sign in again with WhatsApp.', 'Return to your R100 voucher card.']);
      const replay = (await client.query(`SELECT amount FROM booking_welcome_voucher_allocations WHERE operation_key=$1`, [`welcome:${key}`])).rows[0];
      if (replay) { await client.query('COMMIT'); return { status: 'idempotent_replay', amount: Number(replay.amount) }; }
      const voucher = (await client.query(
        `SELECT * FROM my_shiloh_welcome_vouchers WHERE crm_v2_client_id=$1 FOR UPDATE`,
        [clientId],
      )).rows[0];
      if (!voucher) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_NOT_UNLOCKED', 'Complete your registration to unlock your R100 voucher.', 409, ['Open Profile in My Shiloh.', 'Complete and save your personal details.']);
      if (voucher.state !== 'available' || new Date(voucher.expires_at) <= now()) {
        throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_UNAVAILABLE', 'This welcome voucher is no longer available.', 409, ['Check the voucher status shown in My Shiloh.', 'Choose another payment method for this booking.']);
      }
      const booking = (await client.query(
        `SELECT a.id,a.total_price,a.currency,a.updated_at,a.status,a.starts_at,a.crm_v2_client_id
           FROM appointments a
          WHERE a.id=$1 FOR UPDATE`,
        [bookingId],
      )).rows[0];
      const invalidBooking = !booking || Number(booking.crm_v2_client_id) !== clientId || !['scheduled','confirmed'].includes(booking.status) || new Date(booking.starts_at) <= now();
      if (invalidBooking) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_BOOKING_UNAVAILABLE', 'Choose an upcoming booking from the voucher card.', 409, ['Return to My Shiloh.', 'Choose one of the eligible upcoming bookings.']);
      if (Number(booking.total_price) < Number(voucher.minimum_booking_value)) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_MINIMUM_NOT_MET', `Choose a treatment priced at R${Number(voucher.minimum_booking_value).toFixed(0)} or more.`, 409, ['Choose another upcoming treatment.', 'Or keep the voucher for a later qualifying booking.']);
      const grouped = await client.query(`SELECT 1 FROM appointment_group_members WHERE appointment_id=$1 LIMIT 1`, [bookingId]);
      if (grouped.rowCount) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_GROUP_BOOKING', 'This voucher cannot be applied to a linked or package booking.', 409, ['Choose a standalone treatment.', 'Contact Shiloh if you need help.']);
      const packageSession = await client.query(`SELECT 1 FROM package_session_redemptions WHERE appointment_id=$1 AND status IN ('reserved','redeemed') LIMIT 1`, [bookingId]);
      if (packageSession.rowCount) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_PACKAGE_BOOKING', 'This voucher cannot be applied to a prepaid package session.', 409, ['Choose a standalone treatment.', 'Or keep the voucher for a later qualifying booking.']);
      let account = (await client.query(`SELECT * FROM booking_payment_accounts WHERE appointment_id=$1 FOR UPDATE`, [bookingId])).rows[0];
      if (!account) account = (await client.query(
        `INSERT INTO booking_payment_accounts(appointment_id,canonical_amount_due,currency,pricing_revision) VALUES($1,$2,$3,$4) RETURNING *`,
        [bookingId, booking.total_price, booking.currency || 'ZAR', booking.updated_at],
      )).rows[0];
      const totals = (await client.query(
        `SELECT COALESCE((SELECT SUM(CASE WHEN entry_type='payment' THEN amount ELSE -amount END) FROM payment_ledger_entries WHERE payment_account_id=$1),0) AS net_paid,
                COALESCE((SELECT SUM(amount) FROM booking_loyalty_allocations WHERE booking_payment_account_id=$1 AND state='applied'),0) AS rewards,
                COALESCE((SELECT SUM(amount) FROM booking_welcome_voucher_allocations WHERE booking_payment_account_id=$1 AND state='applied'),0) AS welcome`,
        [account.id],
      )).rows[0];
      const outstanding = Number(account.canonical_amount_due) - Number(totals.net_paid) - Number(totals.rewards) - Number(totals.welcome);
      if (outstanding < Number(voucher.amount)) throw new MyShilohWelcomeVoucherError('WELCOME_VOUCHER_BALANCE_TOO_LOW', 'Less than R100 remains on this booking.', 409, ['Choose another qualifying booking.', 'Or keep this voucher for a later treatment.']);
      await client.query(
        `INSERT INTO booking_welcome_voucher_allocations(welcome_voucher_id,booking_payment_account_id,amount,applied_by_client_session_id,operation_key)
         VALUES($1,$2,$3,$4,$5)`,
        [voucher.id, account.id, voucher.amount, secureSessionId, `welcome:${key}`],
      );
      await client.query(`UPDATE my_shiloh_welcome_vouchers SET state='redeemed',redeemed_at=$2::timestamptz,updated_at=NOW() WHERE id=$1`, [voucher.id, now()]);
      await client.query(
        `INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata) VALUES('welcome_voucher.redeemed','my_shiloh_welcome_voucher',$1,$2::jsonb)`,
        [voucher.id, JSON.stringify({ appointmentId: bookingId, amount: Number(voucher.amount) })],
      );
      await client.query('COMMIT');
      return { status: 'applied', amount: Number(voucher.amount), appointmentId: bookingId, outstanding: outstanding - Number(voucher.amount) };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }

  return { syncGrant, getClientModel, applyToBooking };
}

module.exports = {
  WELCOME_VOUCHER_TERMS,
  MyShilohWelcomeVoucherError,
  registrationProgress,
  publicVoucher,
  createMyShilohWelcomeVoucherService,
};
