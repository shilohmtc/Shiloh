'use strict';

const { pool } = require('../db/pool');
const logger = require('../lib/logger');

// Cohort counts only. A push subscription is a notification route, not proof
// that every client has installed or opened My Shiloh.
async function getMyShilohCutoverCoverage(db = pool) {
  const result = await db.query(`
    WITH push AS (
      SELECT crm_v2_client_id,
             BOOL_OR(enabled AND revoked_at IS NULL) AS active,
             BOOL_OR(enabled AND revoked_at IS NULL
                     AND last_push_status LIKE 'accepted_%'
                     AND last_push_at >= NOW() - INTERVAL '30 days') AS recently_accepted
        FROM my_shiloh_push_subscriptions
       GROUP BY crm_v2_client_id
    ), upcoming AS (
      SELECT DISTINCT crm_v2_client_id
        FROM appointments
       WHERE status IN ('scheduled','confirmed')
         AND starts_at >= NOW() AND starts_at < NOW() + INTERVAL '30 days'
         AND crm_v2_client_id IS NOT NULL
    ), legacy_upcoming AS (
      SELECT DISTINCT client_id
        FROM appointments
       WHERE status IN ('scheduled','confirmed')
         AND starts_at >= NOW() AND starts_at < NOW() + INTERVAL '30 days'
         AND crm_v2_client_id IS NULL AND client_id IS NOT NULL
    )
    SELECT (SELECT COUNT(*)::int FROM crm_v2_clients WHERE status='active') AS active_v2_clients,
           (SELECT COUNT(*)::int FROM crm_v2_clients c JOIN push p ON p.crm_v2_client_id=c.id
             WHERE c.status='active' AND p.active) AS active_v2_with_push,
           (SELECT COUNT(*)::int FROM crm_v2_clients c JOIN push p ON p.crm_v2_client_id=c.id
             WHERE c.status='active' AND p.recently_accepted) AS active_v2_recently_accepted,
           (SELECT COUNT(*)::int FROM upcoming u JOIN crm_v2_clients c ON c.id=u.crm_v2_client_id
             WHERE c.status='active') AS upcoming_v2_clients,
           (SELECT COUNT(*)::int FROM upcoming u JOIN crm_v2_clients c ON c.id=u.crm_v2_client_id
             JOIN push p ON p.crm_v2_client_id=c.id
             WHERE c.status='active' AND p.active) AS upcoming_v2_with_push,
           (SELECT COUNT(*)::int FROM upcoming u JOIN crm_v2_clients c ON c.id=u.crm_v2_client_id
             JOIN push p ON p.crm_v2_client_id=c.id
             WHERE c.status='active' AND p.recently_accepted) AS upcoming_v2_recently_accepted,
           (SELECT COUNT(*)::int FROM legacy_upcoming) AS upcoming_legacy_clients,
           (SELECT COUNT(*)::int FROM clients c JOIN client_customer_care_preferences p ON p.client_id=c.id
             WHERE c.status='active' AND p.birthday_opt_in=TRUE) AS legacy_birthday_opted_in,
           (SELECT COUNT(*)::int FROM payment_requests WHERE receipt_notice_state='sending') AS receipt_claims_for_review,
           (SELECT COUNT(*)::int FROM payment_requests WHERE deposit_notice_state='sending') AS deposit_claims_for_review
  `);
  const row = result.rows[0];
  if (!row) throw new Error('Cutover coverage query returned no aggregate');
  return {
    windowDays: 30,
    activeV2Clients: Number(row.active_v2_clients),
    activeV2WithPush: Number(row.active_v2_with_push),
    activeV2RecentlyAccepted: Number(row.active_v2_recently_accepted),
    upcomingV2Clients: Number(row.upcoming_v2_clients),
    upcomingV2WithPush: Number(row.upcoming_v2_with_push),
    upcomingV2RecentlyAccepted: Number(row.upcoming_v2_recently_accepted),
    upcomingLegacyClients: Number(row.upcoming_legacy_clients),
    legacyBirthdayOptedIn: Number(row.legacy_birthday_opted_in),
    receiptClaimsForReview: Number(row.receipt_claims_for_review),
    depositClaimsForReview: Number(row.deposit_claims_for_review),
  };
}

function logMyShilohCutoverCoverage() {
  getMyShilohCutoverCoverage()
    .then(coverage => logger.info({ coverage }, 'My Shiloh cutover cohort coverage'))
    .catch(error => logger.warn({ err: error }, 'My Shiloh cutover coverage unavailable'));
}

module.exports = { getMyShilohCutoverCoverage, logMyShilohCutoverCoverage };
