'use strict';

const { pool } = require('../db/pool');

const DEPOSIT_POLICY_ID = 1;

class BookingDepositPolicyError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'BookingDepositPolicyError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BookingDepositPolicyError('DEPOSIT_INVALID_APPOINTMENT', 'A valid appointment is required.');
  }
  return id;
}

function moneyNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new BookingDepositPolicyError('DEPOSIT_PRICE_UNRESOLVED', 'The booking price must be known before a deposit can be required.', 409);
  }
  return Math.round(number * 100) / 100;
}

function moneyText(value) {
  return moneyNumber(value).toFixed(2);
}

function percentAmount(amount, basisPoints) {
  return Math.round(moneyNumber(amount) * Number(basisPoints) * 100 / 10000) / 100;
}

function normalizeRows(rows = []) {
  return rows.map(row => ({
    appointmentId: Number(row.appointment_id),
    groupId: row.group_id ? Number(row.group_id) : null,
    groupType: row.group_type || null,
    guestPosition: Number(row.guest_position || 1),
    createdAt: new Date(row.created_at),
    canonicalTotal: moneyNumber(row.canonical_total),
    allocatedAmount: moneyNumber(row.allocated_amount),
    pricingRevision: new Date(row.pricing_revision).toISOString(),
    currency: String(row.currency || 'ZAR'),
    crmV2ClientId: row.crm_v2_client_id ? Number(row.crm_v2_client_id) : null,
    clientName: String(row.client_name || ''),
    clientMobile: String(row.client_mobile || ''),
    serviceName: String(row.service_name || 'Shiloh appointment'),
    staffIds: Array.isArray(row.staff_ids) ? row.staff_ids.map(Number) : [],
    staffNames: Array.isArray(row.staff_names) ? row.staff_names.map(String) : [],
  }));
}

function createBookingDepositPolicyService({ db = pool } = {}) {
  async function loadPolicy(queryable = db) {
    const result = await queryable.query(
      `SELECT id,enabled,rate_basis_points,free_notice_hours,partial_notice_hours,
              partial_forfeit_basis_points,late_forfeit_basis_points,no_show_forfeit_basis_points,
              exempt_staff_id,effective_from,policy_version
         FROM clinic_booking_deposit_policy
        WHERE id=$1`,
      [DEPOSIT_POLICY_ID],
    );
    const row = result.rows[0];
    if (!row) throw new BookingDepositPolicyError('DEPOSIT_POLICY_MISSING', 'Shiloh booking deposit policy is unavailable.', 503);
    return {
      id: Number(row.id),
      enabled: row.enabled === true,
      rateBasisPoints: Number(row.rate_basis_points),
      freeNoticeHours: Number(row.free_notice_hours),
      partialNoticeHours: Number(row.partial_notice_hours),
      partialForfeitBasisPoints: Number(row.partial_forfeit_basis_points),
      lateForfeitBasisPoints: Number(row.late_forfeit_basis_points),
      noShowForfeitBasisPoints: Number(row.no_show_forfeit_basis_points),
      exemptStaffId: Number(row.exempt_staff_id),
      effectiveFrom: new Date(row.effective_from),
      policyVersion: String(row.policy_version),
    };
  }

  async function loadScope(queryable, appointmentId, { lock = false } = {}) {
    const id = positiveId(appointmentId);
    const seed = await queryable.query(
      `SELECT a.id,a.created_at,
              gm.group_id,
              g.group_type,
              COALESCE(g.final_total,g.total_price,a.total_price) AS canonical_total,
              COALESCE(g.updated_at,a.updated_at) AS pricing_revision,
              a.currency
         FROM appointments a
         LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id
         LEFT JOIN appointment_groups g ON g.id=gm.group_id
        WHERE a.id=$1
        ${lock ? 'FOR UPDATE OF a' : ''}`,
      [id],
    );
    const root = seed.rows[0];
    if (!root) throw new BookingDepositPolicyError('DEPOSIT_BOOKING_NOT_FOUND', 'The canonical appointment no longer exists.', 404);
    if (root.canonical_total == null) {
      throw new BookingDepositPolicyError('DEPOSIT_PRICE_UNRESOLVED', 'Set the booking price before requesting a deposit.', 409);
    }
    if (lock && root.group_id) {
      await queryable.query('SELECT id FROM appointment_groups WHERE id=$1 FOR UPDATE', [root.group_id]);
    }

    const rows = root.group_id
      ? await queryable.query(
        `SELECT a.id AS appointment_id,g.id AS group_id,g.group_type,gm.guest_position,
                a.created_at,COALESCE(g.final_total,g.total_price) AS canonical_total,
                gm.allocated_price AS allocated_amount,g.updated_at AS pricing_revision,a.currency,
                a.crm_v2_client_id,
                COALESCE(v2.name,a.source_client_name,'Client') AS client_name,
                v2.normalized_mobile AS client_mobile,
                COALESCE((SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.position)
                            FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
                ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_id IS NOT NULL ORDER BY ast.position) AS staff_ids,
                ARRAY(SELECT ast.staff_name_snapshot FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position) AS staff_names
           FROM appointment_group_members gm
           JOIN appointment_groups g ON g.id=gm.group_id
           JOIN appointments a ON a.id=gm.appointment_id
           LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
          WHERE gm.group_id=$1
          ORDER BY gm.guest_position,a.id`,
        [root.group_id],
      )
      : await queryable.query(
        `SELECT a.id AS appointment_id,NULL::bigint AS group_id,NULL::text AS group_type,1 AS guest_position,
                a.created_at,a.total_price AS canonical_total,a.total_price AS allocated_amount,
                a.updated_at AS pricing_revision,a.currency,a.crm_v2_client_id,
                COALESCE(v2.name,a.source_client_name,'Client') AS client_name,
                v2.normalized_mobile AS client_mobile,
                COALESCE((SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.position)
                            FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
                ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_id IS NOT NULL ORDER BY ast.position) AS staff_ids,
                ARRAY(SELECT ast.staff_name_snapshot FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position) AS staff_names
           FROM appointments a
           LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
          WHERE a.id=$1`,
        [id],
      );

    const members = normalizeRows(rows.rows);
    if (!members.length) throw new BookingDepositPolicyError('DEPOSIT_BOOKING_NOT_FOUND', 'The booking could not be resolved.', 404);
    return {
      appointmentId: id,
      groupId: root.group_id ? Number(root.group_id) : null,
      groupType: root.group_type || null,
      amountDue: moneyText(root.canonical_total),
      pricingRevision: new Date(root.pricing_revision).toISOString(),
      currency: String(root.currency || 'ZAR'),
      createdAt: new Date(root.created_at),
      members,
    };
  }

  async function paymentAccountFor(queryable, scope) {
    const column = scope.groupId ? 'appointment_group_id' : 'appointment_id';
    const value = scope.groupId || scope.appointmentId;
    let result = await queryable.query(
      `SELECT * FROM booking_payment_accounts WHERE ${column}=$1 FOR UPDATE`,
      [value],
    );
    if (!result.rows[0]) {
      result = await queryable.query(
        `INSERT INTO booking_payment_accounts(${column},canonical_amount_due,currency,pricing_revision)
         VALUES($1,$2,$3,$4)
         ON CONFLICT (${column}) WHERE ${column} IS NOT NULL
         DO UPDATE SET updated_at=booking_payment_accounts.updated_at
         RETURNING *`,
        [value, scope.amountDue, scope.currency, scope.pricingRevision],
      );
    }
    const account = result.rows[0];
    if (Number(account.canonical_amount_due) !== Number(scope.amountDue)) {
      const settled = await queryable.query(
        'SELECT 1 FROM payment_ledger_entries WHERE payment_account_id=$1 LIMIT 1',
        [account.id],
      );
      if (settled.rowCount) {
        throw new BookingDepositPolicyError(
          'DEPOSIT_PRICE_CHANGED_AFTER_SETTLEMENT',
          'This booking price changed after payment activity. Review the payment history before changing the deposit.',
          409,
        );
      }
      const updated = await queryable.query(
        `UPDATE booking_payment_accounts
            SET canonical_amount_due=$2,pricing_revision=$3,updated_at=NOW()
          WHERE id=$1
          RETURNING *`,
        [account.id, scope.amountDue, scope.pricingRevision],
      );
      return updated.rows[0];
    }
    return account;
  }

  function calculate(scope, policy) {
    const members = scope.members.map(member => {
      const exempt = member.staffIds.includes(policy.exemptStaffId);
      const eligibleAmount = exempt ? 0 : member.allocatedAmount;
      return {
        ...member,
        eligibleAmount: moneyNumber(eligibleAmount),
        requiredAmount: moneyNumber(percentAmount(eligibleAmount, policy.rateBasisPoints)),
        exemptionReason: exempt ? 'marietjie' : null,
      };
    });
    const eligibleAmount = moneyNumber(members.reduce((sum, member) => sum + member.eligibleAmount, 0));
    const requiredAmount = moneyNumber(members.reduce((sum, member) => sum + member.requiredAmount, 0));
    return {
      members,
      eligibleAmount,
      requiredAmount,
      state: requiredAmount > 0 ? 'awaiting' : 'exempt',
    };
  }

  async function effectiveNetPaid(queryable, paymentAccountId) {
    const result = await queryable.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='payment'),0)
              - COALESCE(SUM(amount) FILTER (WHERE entry_type='refund'),0) AS net_paid
         FROM payment_ledger_entries
        WHERE payment_account_id=$1`,
      [paymentAccountId],
    );
    return moneyNumber(result.rows[0]?.net_paid || 0);
  }

  async function requirementFor(queryable, scope) {
    const column = scope.groupId ? 'appointment_group_id' : 'appointment_id';
    const value = scope.groupId || scope.appointmentId;
    const result = await queryable.query(
      `SELECT r.*,a.id AS payment_account_id
         FROM booking_payment_accounts a
         JOIN booking_deposit_requirements r ON r.payment_account_id=a.id
        WHERE a.${column}=$1`,
      [value],
    );
    return result.rows[0] || null;
  }

  async function syncState(queryable, requirement) {
    if (!requirement) return null;
    if (requirement.state === 'exempt') return requirement;
    const netPaid = await effectiveNetPaid(queryable, requirement.payment_account_id);
    const satisfied = netPaid + 0.0001 >= Number(requirement.required_amount);
    if (satisfied && requirement.state !== 'satisfied') {
      const result = await queryable.query(
        `UPDATE booking_deposit_requirements
            SET state='satisfied',satisfied_at=COALESCE(satisfied_at,NOW()),updated_at=NOW()
          WHERE id=$1
          RETURNING *`,
        [requirement.id],
      );
      return { ...result.rows[0], net_paid: moneyText(netPaid), transitioned: true };
    }
    return { ...requirement, net_paid: moneyText(netPaid), transitioned: false };
  }

  async function ensureRequirement({ appointmentId } = {}) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const policy = await loadPolicy(client);
      const scope = await loadScope(client, appointmentId, { lock: true });

      if (!policy.enabled || scope.createdAt < policy.effectiveFrom) {
        await client.query('COMMIT');
        return {
          applicable: false,
          reason: !policy.enabled ? 'policy_disabled' : 'pre_policy_booking',
          policy,
          scope,
        };
      }

      const existing = await requirementFor(client, scope);
      if (existing) {
        const synced = await syncState(client, existing);
        const members = await client.query(
          `SELECT appointment_id,eligible_amount,required_amount,exemption_reason
             FROM booking_deposit_requirement_members
            WHERE requirement_id=$1
            ORDER BY appointment_id`,
          [existing.id],
        );
        await client.query('COMMIT');
        return {
          applicable: true,
          policy,
          scope,
          requirement: synced,
          members: members.rows,
          created: false,
        };
      }

      const account = await paymentAccountFor(client, scope);
      const calculated = calculate(scope, policy);
      const created = await client.query(
        `INSERT INTO booking_deposit_requirements(
           payment_account_id,policy_id,policy_version,rate_basis_points,
           eligible_amount,required_amount,state
         ) VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          account.id,
          policy.id,
          policy.policyVersion,
          policy.rateBasisPoints,
          moneyText(calculated.eligibleAmount),
          moneyText(calculated.requiredAmount),
          calculated.state,
        ],
      );
      const requirement = created.rows[0];
      for (const member of calculated.members) {
        await client.query(
          `INSERT INTO booking_deposit_requirement_members(
             requirement_id,appointment_id,eligible_amount,required_amount,exemption_reason
           ) VALUES($1,$2,$3,$4,$5)`,
          [
            requirement.id,
            member.appointmentId,
            moneyText(member.eligibleAmount),
            moneyText(member.requiredAmount),
            member.exemptionReason,
          ],
        );
      }
      await client.query(
        `INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
         VALUES('payment.deposit_requirement_created',$1,$2,$3::jsonb)`,
        [
          scope.groupId ? 'appointment_group' : 'appointment',
          String(scope.groupId || scope.appointmentId),
          JSON.stringify({
            requirementId: Number(requirement.id),
            policyVersion: policy.policyVersion,
            rateBasisPoints: policy.rateBasisPoints,
            eligibleAmount: moneyText(calculated.eligibleAmount),
            requiredAmount: moneyText(calculated.requiredAmount),
            marietjieExemptStaffId: policy.exemptStaffId,
            prospectiveOnly: true,
          }),
        ],
      );
      await client.query('COMMIT');
      return {
        applicable: true,
        policy,
        scope,
        requirement,
        members: calculated.members.map(member => ({
          appointment_id: member.appointmentId,
          eligible_amount: moneyText(member.eligibleAmount),
          required_amount: moneyText(member.requiredAmount),
          exemption_reason: member.exemptionReason,
        })),
        created: true,
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function getPosition({ appointmentId } = {}) {
    const policy = await loadPolicy(db);
    const scope = await loadScope(db, appointmentId);
    if (!policy.enabled || scope.createdAt < policy.effectiveFrom) {
      return { applicable: false, reason: !policy.enabled ? 'policy_disabled' : 'pre_policy_booking', policy, scope };
    }
    const requirement = await requirementFor(db, scope);
    if (!requirement) return { applicable: true, policy, scope, requirement: null, members: [] };
    const synced = await syncState(db, requirement);
    const [members, events] = await Promise.all([
      db.query(
        `SELECT appointment_id,eligible_amount,required_amount,exemption_reason
           FROM booking_deposit_requirement_members
          WHERE requirement_id=$1
          ORDER BY appointment_id`,
        [requirement.id],
      ),
      db.query(
        `SELECT appointment_id,event_type,notice_minutes,forfeit_basis_points,
                member_required_amount,policy_forfeit_amount,policy_creditable_amount,created_at
           FROM booking_deposit_policy_events
          WHERE requirement_id=$1
          ORDER BY created_at DESC,id DESC`,
        [requirement.id],
      ),
    ]);
    return { applicable: true, policy, scope, requirement: synced, members: members.rows, events: events.rows };
  }

  async function confirmationGate({ appointmentId } = {}) {
    const position = await ensureRequirement({ appointmentId });
    if (!position.applicable) return { allowed: true, ...position };
    const requirement = position.requirement;
    if (!requirement || requirement.state === 'exempt' || requirement.state === 'satisfied') {
      return { allowed: true, ...position };
    }
    return { allowed: false, reason: 'deposit_required', ...position };
  }

  return {
    loadPolicy,
    loadScope,
    calculate,
    ensureRequirement,
    getPosition,
    confirmationGate,
    effectiveNetPaid,
    syncState,
  };
}

const service = createBookingDepositPolicyService();

module.exports = {
  DEPOSIT_POLICY_ID,
  BookingDepositPolicyError,
  positiveId,
  moneyNumber,
  moneyText,
  percentAmount,
  normalizeRows,
  createBookingDepositPolicyService,
  ...service,
};
