'use strict';

const { pool } = require('../db/pool');

const WELCOME_VOUCHER_REPORT_CAPABILITY = 'welcome_vouchers:view_campaign';
const CAMPAIGN_ROLES = new Set(['owner', 'business_admin']);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissions(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function canViewWelcomeVoucherCampaign(principal) {
  return principal?.active === true
    && CAMPAIGN_ROLES.has(String(principal.business_role || principal.businessRole || '').trim().toLowerCase())
    && permissions(principal.permissions)[WELCOME_VOUCHER_REPORT_CAPABILITY] === true;
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function campaignSummary(row = {}, recentActivity = []) {
  const unlocked = numberValue(row.vouchers_unlocked);
  const redeemed = numberValue(row.vouchers_redeemed);
  return {
    version: 'workspace_welcome_voucher_campaign_v1',
    launchedAt: row.launched_at ? new Date(row.launched_at).toISOString() : null,
    registrationsCompleted: numberValue(row.registrations_completed),
    vouchersUnlocked: unlocked,
    vouchersRedeemed: redeemed,
    redemptionPercent: unlocked > 0 ? Math.round((redeemed / unlocked) * 1000) / 10 : 0,
    expiringSoon: numberValue(row.expiring_soon),
    discountsGiven: numberValue(row.discounts_given),
    bookingRevenueReceived: numberValue(row.booking_revenue_received),
    recentActivity,
  };
}

function activityProjection(row = {}) {
  return {
    voucherId: positiveId(row.voucher_id),
    clientFirstName: String(row.client_first_name || 'Client').trim() || 'Client',
    state: String(row.state || 'available').trim().toLowerCase(),
    amount: numberValue(row.amount),
    issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    redeemedAt: row.redeemed_at ? new Date(row.redeemed_at).toISOString() : null,
    treatment: String(row.treatment || '').trim() || null,
  };
}

function createWorkspaceWelcomeVoucherCampaignService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Welcome-voucher campaign reporting database is required');

  async function resolveAccess(adminId) {
    const id = positiveId(adminId);
    if (!id) return null;
    const result = await db.query(
      `/* workspaceWelcomeVoucherCampaign:principal */
       SELECT id,display_name,active,business_role,permissions
         FROM staff_admin_accounts
        WHERE id=$1
        LIMIT 2`,
      [id],
    );
    if (result.rows.length !== 1 || !canViewWelcomeVoucherCampaign(result.rows[0])) return null;
    return {
      adminId: id,
      displayName: String(result.rows[0].display_name || 'Shiloh').trim() || 'Shiloh',
    };
  }

  async function readSummary(now) {
    const result = await db.query(
      `/* workspaceWelcomeVoucherCampaign:summary */
       WITH settings AS (
         SELECT activated_at
           FROM my_shiloh_welcome_voucher_settings
          WHERE singleton=TRUE
       ),
       applied_allocations AS (
         SELECT booking_payment_account_id,SUM(amount) AS discount
           FROM booking_welcome_voucher_allocations
          WHERE state='applied'
          GROUP BY booking_payment_account_id
       ),
       account_payments AS (
         SELECT payment_account_id,
                GREATEST(0,COALESCE(SUM(CASE WHEN entry_type='payment' THEN amount ELSE -amount END),0)) AS net_paid
           FROM payment_ledger_entries
          GROUP BY payment_account_id
       )
       SELECT s.activated_at AS launched_at,
              (SELECT COUNT(*)::int
                 FROM crm_v2_clients c
                WHERE c.status='active'
                  AND c.profile_status='registered'
                  AND c.mobile_verified_at IS NOT NULL
                  AND c.date_of_birth IS NOT NULL
                  AND NULLIF(BTRIM(c.gender),'') IS NOT NULL
                  AND c.updated_at>=s.activated_at) AS registrations_completed,
              (SELECT COUNT(*)::int FROM my_shiloh_welcome_vouchers) AS vouchers_unlocked,
              (SELECT COUNT(*)::int FROM my_shiloh_welcome_vouchers WHERE state='redeemed') AS vouchers_redeemed,
              (SELECT COUNT(*)::int
                 FROM my_shiloh_welcome_vouchers
                WHERE state='available'
                  AND expires_at>$1::timestamptz
                  AND expires_at<=$1::timestamptz+INTERVAL '7 days') AS expiring_soon,
              COALESCE((SELECT SUM(discount) FROM applied_allocations),0) AS discounts_given,
              COALESCE((SELECT SUM(COALESCE(p.net_paid,0))
                          FROM applied_allocations a
                          LEFT JOIN account_payments p ON p.payment_account_id=a.booking_payment_account_id),0) AS booking_revenue_received
         FROM settings s`,
      [now],
    );
    return result.rows[0] || {};
  }

  async function readRecentActivity(limit) {
    const result = await db.query(
      `/* workspaceWelcomeVoucherCampaign:activity */
       SELECT v.id AS voucher_id,
              SPLIT_PART(BTRIM(c.name),' ',1) AS client_first_name,
              v.state,v.amount,v.issued_at,v.expires_at,v.redeemed_at,
              COALESCE(
                (SELECT STRING_AGG(aps.service_name_snapshot,' + ' ORDER BY aps.position)
                   FROM appointment_services aps
                  WHERE aps.appointment_id=bpa.appointment_id),
                a.title
              ) AS treatment
         FROM my_shiloh_welcome_vouchers v
         JOIN crm_v2_clients c ON c.id=v.crm_v2_client_id
         LEFT JOIN booking_welcome_voucher_allocations wva
           ON wva.welcome_voucher_id=v.id AND wva.state='applied'
         LEFT JOIN booking_payment_accounts bpa ON bpa.id=wva.booking_payment_account_id
         LEFT JOIN appointments a ON a.id=bpa.appointment_id
        ORDER BY COALESCE(v.redeemed_at,v.updated_at,v.issued_at) DESC,v.id DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(activityProjection);
  }

  async function buildCampaign({ adminId, now = new Date(), recentLimit = 12 } = {}) {
    const authority = await resolveAccess(adminId);
    if (!authority) return null;
    const safeNow = new Date(now);
    if (Number.isNaN(safeNow.getTime())) throw new Error('Welcome-voucher campaign reporting requires a valid time');
    const limit = Math.min(30, Math.max(1, Number(recentLimit) || 12));
    const [summary, activity] = await Promise.all([
      readSummary(safeNow.toISOString()),
      readRecentActivity(limit),
    ]);
    return campaignSummary(summary, activity);
  }

  return { resolveAccess, buildCampaign };
}

const service = createWorkspaceWelcomeVoucherCampaignService();

module.exports = {
  WELCOME_VOUCHER_REPORT_CAPABILITY,
  canViewWelcomeVoucherCampaign,
  campaignSummary,
  activityProjection,
  createWorkspaceWelcomeVoucherCampaignService,
  ...service,
};
