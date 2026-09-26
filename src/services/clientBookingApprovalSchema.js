const { pool } = require('../db/pool');

let ready = false;

async function ensureBookingApprovalInfrastructure(db = pool) {
  if (ready && db === pool) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS appointment_booking_approvals (
      appointment_id BIGINT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
      approver_staff_id BIGINT REFERENCES staff(id),
      approver_admin_id BIGINT REFERENCES staff_admin_accounts(id),
      observer_staff_id BIGINT REFERENCES staff(id),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','awaiting_client_confirmation','approved','declined')),
      approval_mode TEXT NOT NULL DEFAULT 'standard',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approver_notified_at TIMESTAMPTZ,
      backup_notified_at TIMESTAMPTZ,
      observer_notified_at TIMESTAMPTZ,
      decided_at TIMESTAMPTZ,
      decided_by_admin_id BIGINT,
      decision_note TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const additions = [
    `requested_client_id BIGINT REFERENCES clients(id)`,
    `requested_crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id)`,
    `requested_client_phone TEXT`,
    `requested_location_id BIGINT REFERENCES locations(id)`,
    `requested_staff_id BIGINT REFERENCES staff(id)`,
    `requested_staff_ids BIGINT[]`,
    `requested_service_id BIGINT REFERENCES services(id)`,
    `requested_service_ids BIGINT[]`,
    `requested_starts_at TIMESTAMPTZ`,
    `requested_ends_at TIMESTAMPTZ`,
    `requested_revision TIMESTAMPTZ`,
    `proposed_location_id BIGINT REFERENCES locations(id)`,
    `proposed_staff_id BIGINT REFERENCES staff(id)`,
    `proposed_staff_ids BIGINT[]`,
    `proposed_service_id BIGINT REFERENCES services(id)`,
    `proposed_starts_at TIMESTAMPTZ`,
    `proposed_ends_at TIMESTAMPTZ`,
    `proposal_version INTEGER NOT NULL DEFAULT 0`,
    `proposal_expires_at TIMESTAMPTZ`,
    `proposed_by_admin_id BIGINT REFERENCES staff_admin_accounts(id)`,
    `client_responded_at TIMESTAMPTZ`,
    `planning_started_at TIMESTAMPTZ`,
    `planning_by_admin_id BIGINT REFERENCES staff_admin_accounts(id)`,
  ];
  for (const definition of additions) {
    const column = definition.split(/\s+/)[0];
    await db.query(`ALTER TABLE appointment_booking_approvals ADD COLUMN IF NOT EXISTS ${column} ${definition.slice(column.length + 1)}`);
  }
  await db.query(`CREATE INDEX IF NOT EXISTS idx_appointment_booking_approvals_status ON appointment_booking_approvals(status, requested_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_appointment_booking_approvals_approver ON appointment_booking_approvals(approver_staff_id, status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_booking_approval_proposal_holds ON appointment_booking_approvals(proposed_staff_id,proposed_starts_at,proposed_ends_at) WHERE status='awaiting_client_confirmation'`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_booking_approval_proposal_staff_ids ON appointment_booking_approvals USING GIN(proposed_staff_ids) WHERE status='awaiting_client_confirmation'`);
  await db.query(`ALTER TABLE appointment_booking_approvals DROP CONSTRAINT IF EXISTS appointment_booking_approvals_status_check`);
  await db.query(`ALTER TABLE appointment_booking_approvals ADD CONSTRAINT appointment_booking_approvals_status_check CHECK (status IN ('pending','awaiting_client_confirmation','approved','declined'))`);
  await db.query(`ALTER TABLE appointment_booking_approvals DROP CONSTRAINT IF EXISTS appointment_booking_approvals_requested_identity_check`);
  await db.query(`ALTER TABLE appointment_booking_approvals ADD CONSTRAINT appointment_booking_approvals_requested_identity_check CHECK (num_nonnulls(requested_client_id,requested_crm_v2_client_id)<=1)`);
  await db.query(`ALTER TABLE appointment_booking_approvals DROP CONSTRAINT IF EXISTS appointment_booking_approvals_active_snapshot_check`);
  await db.query(`ALTER TABLE appointment_booking_approvals ADD CONSTRAINT appointment_booking_approvals_active_snapshot_check CHECK (
    status NOT IN ('pending','awaiting_client_confirmation') OR (
      num_nonnulls(requested_client_id,requested_crm_v2_client_id)=1 AND requested_location_id IS NOT NULL
      AND requested_staff_id IS NOT NULL AND cardinality(requested_staff_ids)>0
      AND requested_service_id IS NOT NULL AND cardinality(requested_service_ids)>0 AND requested_starts_at IS NOT NULL
      AND requested_ends_at IS NOT NULL AND requested_revision IS NOT NULL AND requested_ends_at>requested_starts_at))`);
  await db.query(`ALTER TABLE appointment_booking_approvals DROP CONSTRAINT IF EXISTS appointment_booking_approvals_proposal_check`);
  await db.query(`ALTER TABLE appointment_booking_approvals ADD CONSTRAINT appointment_booking_approvals_proposal_check CHECK (
    status<>'awaiting_client_confirmation' OR (proposal_version>0 AND proposal_expires_at IS NOT NULL
      AND proposed_location_id IS NOT NULL AND proposed_staff_id IS NOT NULL AND proposed_service_id IS NOT NULL
      AND cardinality(proposed_staff_ids)>0
      AND proposed_starts_at IS NOT NULL AND proposed_ends_at IS NOT NULL AND proposed_ends_at>proposed_starts_at))`);

  await db.query(`
    CREATE OR REPLACE FUNCTION create_client_booking_approval_hold()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE booking appointments%ROWTYPE; primary_staff_id BIGINT; primary_service_id BIGINT; canonical_phone TEXT;
    BEGIN
      SELECT * INTO booking FROM appointments WHERE id=NEW.appointment_id;
      IF booking.source IS DISTINCT FROM 'shiloh_client_whatsapp' THEN RETURN NEW; END IF;
      SELECT staff_id INTO primary_staff_id FROM appointment_staff WHERE appointment_id=NEW.appointment_id AND position=1;
      SELECT service_id INTO primary_service_id FROM appointment_services WHERE appointment_id=NEW.appointment_id AND position=1;
      IF booking.crm_v2_client_id IS NOT NULL THEN
        SELECT normalized_mobile INTO canonical_phone FROM crm_v2_clients WHERE id=booking.crm_v2_client_id AND status='active';
      ELSE
        SELECT normalized_value INTO canonical_phone FROM client_contacts
         WHERE client_id=booking.client_id AND LOWER(contact_type) IN ('whatsapp','mobile','phone','telephone')
           AND normalized_value IS NOT NULL ORDER BY is_primary DESC,id LIMIT 1;
      END IF;
      INSERT INTO appointment_booking_approvals (
        appointment_id,approver_staff_id,status,approval_mode,
        requested_client_id,requested_crm_v2_client_id,requested_client_phone,
        requested_location_id,requested_staff_id,requested_staff_ids,requested_service_id,requested_service_ids,
        requested_starts_at,requested_ends_at,requested_revision
      ) VALUES (
        NEW.appointment_id,primary_staff_id,'pending','standard',
        booking.client_id,booking.crm_v2_client_id,canonical_phone,
        booking.location_id,primary_staff_id,
        (SELECT array_agg(x.staff_id ORDER BY x.position,x.id) FROM appointment_staff x WHERE x.appointment_id=NEW.appointment_id),
        primary_service_id,
        (SELECT array_agg(x.service_id ORDER BY x.position,x.id) FROM appointment_services x WHERE x.appointment_id=NEW.appointment_id),
        booking.starts_at,booking.ends_at,booking.updated_at
      ) ON CONFLICT (appointment_id) DO UPDATE SET
        approver_staff_id=EXCLUDED.approver_staff_id,
        requested_staff_id=EXCLUDED.requested_staff_id,
        requested_staff_ids=EXCLUDED.requested_staff_ids,
        requested_service_id=EXCLUDED.requested_service_id,
        requested_service_ids=EXCLUDED.requested_service_ids
      WHERE appointment_booking_approvals.status='pending';
      RETURN NEW;
    END; $$
  `);
  await db.query(`DROP TRIGGER IF EXISTS trg_client_booking_approval_hold ON appointment_staff`);
  await db.query(`CREATE TRIGGER trg_client_booking_approval_hold AFTER INSERT ON appointment_staff FOR EACH ROW EXECUTE FUNCTION create_client_booking_approval_hold()`);

  if (db === pool) ready = true;
}

module.exports = { ensureBookingApprovalInfrastructure };
