const { pool } = require('../db/pool');
const { verifyMigrationFiles } = require('./migrations');
const { clientRescheduleRequestsEnabled } = require('../config/clientReschedulePolicy');

const BASE_MIGRATION = '064_client_reschedule_practitioner_approval.sql';
const MIGRATION = '087_whatsapp_crm_v2_reschedule_compat.sql';
const APPROVAL_TEMPLATE = 'shiloh_reschedule_approval_request_v1';
const DECLINED_TEMPLATE = 'shiloh_reschedule_declined_v1';
let schemaReady = null;

async function initializeClientRescheduleApprovalSchema() {
  const [, migration] = await verifyMigrationFiles([BASE_MIGRATION, MIGRATION]);
  const verification = await pool.query(`
    SELECT to_regclass('public.appointment_reschedule_requests') AS request_table,
           EXISTS (
             SELECT 1
               FROM pg_indexes
              WHERE schemaname='public'
                AND indexname='uq_appointment_reschedule_requests_pending_appointment'
           ) AS pending_unique_index,
           EXISTS (
             SELECT 1
               FROM pg_indexes
              WHERE schemaname='public'
                AND indexname='idx_appointment_reschedule_requests_pending_staff'
           ) AS pending_staff_index,
           EXISTS (
             SELECT 1
               FROM information_schema.columns
              WHERE table_schema='public'
                AND table_name='appointment_reschedule_requests'
                AND column_name='client_id'
                AND is_nullable='YES'
           ) AS legacy_identity_nullable,
           EXISTS (
             SELECT 1
               FROM information_schema.columns
              WHERE table_schema='public'
                AND table_name='appointment_reschedule_requests'
                AND column_name='crm_v2_client_id'
                AND is_nullable='YES'
           ) AS crm_v2_identity_column,
           EXISTS (
             SELECT 1
               FROM pg_constraint
              WHERE conrelid='appointment_reschedule_requests'::regclass
                AND conname='appointment_reschedule_requests_crm_v2_client_id_fkey'
                AND contype='f'
                AND confrelid='crm_v2_clients'::regclass
                AND confdeltype='r'
           ) AS crm_v2_restrict_fk,
           EXISTS (
             SELECT 1
               FROM pg_constraint
              WHERE conrelid='appointment_reschedule_requests'::regclass
                AND conname='appointment_reschedule_requests_client_identity_xor'
                AND contype='c'
                AND convalidated=TRUE
           ) AS client_identity_xor
  `);
  const row = verification.rows[0] || {};
  if (
    !row.request_table
    || !row.pending_unique_index
    || !row.pending_staff_index
    || !row.legacy_identity_nullable
    || !row.crm_v2_identity_column
    || !row.crm_v2_restrict_fk
    || !row.client_identity_xor
  ) {
    throw new Error('Client reschedule approval schema verification failed');
  }

  return {
    initialized: true,
    migration: MIGRATION,
    applied: false,
    checksumVerified: migration.checksumMatches === true,
    appliedAt: migration.appliedAt || null,
    requestTable: String(row.request_table),
    pendingUniqueIndex: row.pending_unique_index === true,
    pendingStaffIndex: row.pending_staff_index === true,
    legacyIdentityNullable: row.legacy_identity_nullable === true,
    crmV2IdentityColumn: row.crm_v2_identity_column === true,
    crmV2RestrictForeignKey: row.crm_v2_restrict_fk === true,
    clientIdentityXor: row.client_identity_xor === true,
    featureEnabled: clientRescheduleRequestsEnabled(),
    approvalTemplateConfigured: String(process.env.WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE || '').trim() === APPROVAL_TEMPLATE,
    declinedTemplateConfigured: String(process.env.WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE || '').trim() === DECLINED_TEMPLATE,
  };
}

async function ensureClientRescheduleApprovalSchema() {
  if (!schemaReady) schemaReady = initializeClientRescheduleApprovalSchema();
  try {
    return await schemaReady;
  } catch (error) {
    schemaReady = null;
    throw error;
  }
}

module.exports = {
  BASE_MIGRATION,
  MIGRATION,
  APPROVAL_TEMPLATE,
  DECLINED_TEMPLATE,
  ensureClientRescheduleApprovalSchema,
};
