const crypto = require('crypto');
const { pool } = require('../db/pool');
const { resolveCalendarAuthority, hasCapability, allowsAppointmentTarget } = require('./calendarAuthorization');
const { createOzowPaymentProvider } = require('./ozowPaymentProvider');
const { STATES, EVIDENCE, transitionPaymentState } = require('../domain/paymentState');
const { PAYMENT_TEMPLATE_KEYS, formatRand, secureVoucherUrl, withActionLink, sendPaymentTemplate } = require('./paymentWhatsAppNotifications');
const { formatVoucherDate } = require('../lib/voucherDate');
const { sendWhatsAppTemplate } = require('./whatsapp');
const { issueVerifiedVoucher } = require('./giftVouchers');
const { createShilohRewardsService } = require('./shilohRewards');
const { queueClientNotification } = require('./myShilohPush');
const { calculateDepositRequirement } = require('../domain/bookingDepositPolicy');
const logger = require('../lib/logger');

const CAPABILITIES = Object.freeze({ VIEW: 'payment:view', COLLECT: 'payment:collect', REFUND: 'payment:refund' });

class BookingPaymentError extends Error {
  constructor(code, message, httpStatus = 400) { super(message); this.code = code; this.httpStatus = httpStatus; }
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new BookingPaymentError('PAYMENT_INVALID_ID', 'A valid appointment is required.');
  return id;
}

function money(value, { positive = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new BookingPaymentError('PAYMENT_INVALID_AMOUNT', 'Enter a valid Rand amount with at most two decimals.');
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(cents) || cents < (positive ? 1 : 0) || cents > 999999999999) {
    throw new BookingPaymentError('PAYMENT_INVALID_AMOUNT', 'The payment amount is outside the supported range.');
  }
  return (cents / 100).toFixed(2);
}

function requestKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new BookingPaymentError('PAYMENT_INVALID_REQUEST', 'A valid operation request identifier is required.');
  return key;
}

function normalizeMethod(value) {
  const method = String(value || '').trim();
  if (!['cash', 'card_machine', 'manual_eft'].includes(method)) throw new BookingPaymentError('PAYMENT_INVALID_METHOD', 'Choose cash, card machine, or EFT.');
  return method;
}

function bookingDate(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }).format(new Date(value));
}

function bookingTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function createBookingPaymentService({
  db = pool,
  ozow = createOzowPaymentProvider(),
  sendTemplate = sendWhatsAppTemplate,
  rewards = createShilohRewardsService({ db }),
  notifyClient = null,
} = {}) {
  const pushNotify = notifyClient || (db === pool ? queueClientNotification : null);
  async function syncRewardsAfterPayment() {
    try { await rewards.syncEligibleEarnings(); }
    catch (error) { logger.error({ err:error }, 'Shiloh Rewards payment sync failed'); }
  }
  async function resolveOperator(queryable, adminId, capability) {
    const operator = await resolveCalendarAuthority(queryable, positiveId(adminId), { additionalCapabilities: Object.values(CAPABILITIES) });
    if (!operator || !hasCapability(operator.calendarAuthority, capability)) {
      throw new BookingPaymentError('PAYMENT_FORBIDDEN', 'Current Shiloh authority does not permit this payment operation.', 403);
    }
    return operator;
  }

  async function loadSubject(queryable, appointmentId, { lock = false } = {}) {
    const result = await queryable.query(
      `/* bookingPayments:subject */
       SELECT a.id AS appointment_id,a.crm_v2_client_id,a.status AS appointment_status,a.total_price AS appointment_total,
              a.currency,a.updated_at AS appointment_revision,a.created_at AS appointment_created_at,
              a.starts_at AS appointment_starts_at,a.ends_at AS appointment_ends_at,
              COALESCE(c.display_name,v2.name) AS client_name,
              COALESCE((SELECT cc.normalized_value
                          FROM client_contacts cc
                         WHERE cc.client_id=c.id
                           AND cc.contact_type IN ('whatsapp','mobile')
                         ORDER BY cc.is_primary DESC,cc.id
                         LIMIT 1),v2.normalized_mobile) AS client_mobile,
              COALESCE((SELECT string_agg(aps.service_name_snapshot, ' + ' ORDER BY aps.position)
                          FROM appointment_services aps
                         WHERE aps.appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
              g.id AS group_id,g.group_type,g.status AS group_status,COALESCE(g.final_total,g.total_price) AS group_total,
              g.updated_at AS group_revision,
              ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_id IS NOT NULL ORDER BY ast.position) AS staff_ids,
              ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id AND aps.service_id IS NOT NULL ORDER BY aps.position) AS service_ids,
              COALESCE(
                CASE WHEN g.id IS NOT NULL THEN (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'appointmentId',gm2.appointment_id,
                      'amount',COALESCE(gm2.allocated_price,a2.total_price,0),
                      'staff',COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                          'displayName',st2.display_name,
                          'businessRole',st2.business_role
                        ) ORDER BY ast2.position)
                          FROM appointment_staff ast2
                          LEFT JOIN staff st2 ON st2.id=ast2.staff_id
                         WHERE ast2.appointment_id=gm2.appointment_id
                      ),'[]'::jsonb)
                    )
                    ORDER BY gm2.guest_position,gm2.appointment_id
                  )
                    FROM appointment_group_members gm2
                    JOIN appointments a2 ON a2.id=gm2.appointment_id
                   WHERE gm2.group_id=g.id
                ) ELSE NULL END,
                jsonb_build_array(jsonb_build_object(
                  'appointmentId',a.id,
                  'amount',COALESCE(a.total_price,0),
                  'staff',COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'displayName',st1.display_name,
                      'businessRole',st1.business_role
                    ) ORDER BY ast1.position)
                      FROM appointment_staff ast1
                      LEFT JOIN staff st1 ON st1.id=ast1.staff_id
                     WHERE ast1.appointment_id=a.id
                  ),'[]'::jsonb)
                ))
              ) AS deposit_components
         FROM appointments a
         LEFT JOIN clients c ON c.id=a.client_id
         LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
         LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id
         LEFT JOIN appointment_groups g ON g.id=gm.group_id
        WHERE a.id=$1
        ${lock ? 'FOR UPDATE OF a' : ''}`,
      [positiveId(appointmentId)]
    );
    const row = result.rows[0];
    if (!row) throw new BookingPaymentError('PAYMENT_BOOKING_NOT_FOUND', 'The canonical appointment no longer exists.', 404);
    if (lock && row.group_id) await queryable.query(`SELECT id FROM appointment_groups WHERE id=$1 FOR UPDATE`, [row.group_id]);
    const amount = row.group_id ? row.group_total : row.appointment_total;
    if (amount == null) throw new BookingPaymentError('PAYMENT_PRICE_UNRESOLVED', 'Set the booking’s canonical charged price before taking payment.', 409);
    return {
      appointmentId: Number(row.appointment_id), groupId: row.group_id ? Number(row.group_id) : null,
      groupType: row.group_type ? String(row.group_type) : null,
      crmV2ClientId: row.crm_v2_client_id ? Number(row.crm_v2_client_id) : null,
      amountDue: money(amount), currency: String(row.currency || 'ZAR'),
      pricingRevision: new Date(row.group_id ? row.group_revision : row.appointment_revision).toISOString(),
      createdAt: new Date(row.appointment_created_at).toISOString(),
      startsAt: new Date(row.appointment_starts_at).toISOString(),
      endsAt: new Date(row.appointment_ends_at).toISOString(),
      clientName: String(row.client_name || ''), clientMobile: String(row.client_mobile || ''),
      serviceName: String(row.service_name || 'Shiloh appointment'),
      staffIds: row.staff_ids.map(Number), serviceIds: row.service_ids.map(Number),
      depositComponents: Array.isArray(row.deposit_components) ? row.deposit_components : [],
      final: ['cancelled'].includes(String(row.group_id ? row.group_status : row.appointment_status)),
    };
  }

  function assertTarget(operator, subject) {
    if (!allowsAppointmentTarget(operator.calendarAuthority, subject)) {
      throw new BookingPaymentError('PAYMENT_FORBIDDEN', 'This booking is outside the current Calendar and service scope.', 403);
    }
  }

  async function loadDepositPolicy(queryable, subject, { force = false } = {}) {
    const result = await queryable.query(
      `SELECT *
         FROM booking_deposit_policies
        WHERE policy_key='shiloh_booking_deposit_v1'
          AND active=TRUE
        LIMIT 1`
    );
    const policy = result.rows[0] || null;
    if (!policy) return null;
    if (!force && new Date(subject.createdAt).getTime() < new Date(policy.activated_at).getTime()) return null;
    return policy;
  }

  async function loadRequirement(queryable, accountId) {
    const result = await queryable.query(
      `SELECT *
         FROM booking_payment_requirements
        WHERE payment_account_id=$1
        LIMIT 1`,
      [accountId]
    );
    const requirement = result.rows[0] || null;
    if (!requirement) return null;
    const items = await queryable.query(
      `SELECT appointment_id,eligible_amount,required_amount,exempt_reason
         FROM booking_payment_requirement_items
        WHERE requirement_id=$1
        ORDER BY appointment_id`,
      [requirement.id]
    );
    return { ...requirement, items: items.rows };
  }

  async function ensureRequirement(queryable, account, subject, policy) {
    let requirement = await loadRequirement(queryable, account.id);
    if (requirement) return requirement;
    const calculated = calculateDepositRequirement(subject.depositComponents, policy);
    const inserted = await queryable.query(
      `INSERT INTO booking_payment_requirements(
         payment_account_id,policy_key,percentage_basis_points,eligible_amount_base,required_amount,
         full_release_notice_hours,partial_notice_hours,partial_retention_basis_points,
         late_retention_basis_points,no_show_retention_basis_points,exempt_reason
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(payment_account_id) DO NOTHING
       RETURNING id`,
      [
        account.id, policy.policy_key, policy.deposit_basis_points,
        calculated.eligibleAmountBase, calculated.requiredAmount,
        policy.full_release_notice_hours, policy.partial_notice_hours,
        policy.partial_retention_basis_points, policy.late_retention_basis_points,
        policy.no_show_retention_basis_points, calculated.exemptReason,
      ]
    );
    if (inserted.rows[0]) {
      for (const item of calculated.items) {
        await queryable.query(
          `INSERT INTO booking_payment_requirement_items(
             requirement_id,appointment_id,eligible_amount,required_amount,exempt_reason
           ) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(requirement_id,appointment_id) DO NOTHING`,
          [inserted.rows[0].id,item.appointmentId,item.eligibleAmount,item.requiredAmount,item.exemptReason]
        );
      }
    }
    requirement = await loadRequirement(queryable, account.id);
    if (!requirement) throw new BookingPaymentError('PAYMENT_DEPOSIT_REQUIREMENT_FAILED', 'The booking deposit requirement could not be prepared.', 503);
    return requirement;
  }

  async function releaseBookingConfirmations(paymentAccountId) {
    const account = (await db.query(
      `SELECT bpa.appointment_id,bpa.appointment_group_id,g.group_type
         FROM booking_payment_accounts bpa
         LEFT JOIN appointment_groups g ON g.id=bpa.appointment_group_id
        WHERE bpa.id=$1`,
      [paymentAccountId]
    )).rows[0];
    if (!account) return [];
    let appointmentIds = [];
    if (account.appointment_id) {
      appointmentIds = [Number(account.appointment_id)];
    } else if (account.appointment_group_id) {
      const members = await db.query(
        `SELECT appointment_id
           FROM appointment_group_members
          WHERE group_id=$1
          ORDER BY guest_position,appointment_id`,
        [account.appointment_group_id]
      );
      appointmentIds = members.rows.map(row => Number(row.appointment_id));
      if (account.group_type === 'multi_service_booking') appointmentIds = appointmentIds.slice(0, 1);
    }
    if (!appointmentIds.length) return [];
    await db.query(
      `UPDATE customer_message_deliveries
          SET status='pending',next_attempt_at=NOW(),updated_at=NOW(),last_error=NULL
        WHERE appointment_id=ANY($1::bigint[])
          AND message_kind='booking_confirmation'
          AND status='awaiting_payment'`,
      [appointmentIds]
    );
    const { sendCustomerBookingConfirmationForAppointment } = require('./customerBookingConfirmation');
    const results = [];
    for (const appointmentId of appointmentIds) {
      results.push(await sendCustomerBookingConfirmationForAppointment(appointmentId));
    }
    return results;
  }

  async function accountFor(queryable, subject, { create = false } = {}) {
    const column = subject.groupId ? 'appointment_group_id' : 'appointment_id';
    const value = subject.groupId || subject.appointmentId;
    let result = await queryable.query(`SELECT * FROM booking_payment_accounts WHERE ${column}=$1 ${create ? 'FOR UPDATE' : ''}`, [value]);
    if (!result.rows[0] && create) {
      result = await queryable.query(
        `INSERT INTO booking_payment_accounts(${column},canonical_amount_due,currency,pricing_revision)
         VALUES($1,$2,$3,$4) ON CONFLICT (${column}) WHERE ${column} IS NOT NULL DO UPDATE SET updated_at=booking_payment_accounts.updated_at RETURNING *`,
        [value, subject.amountDue, subject.currency, subject.pricingRevision]
      );
    }
    const account = result.rows[0] || null;
    if (account && Number(account.canonical_amount_due) !== Number(subject.amountDue)) {
      const settled = await queryable.query(`SELECT 1 FROM payment_ledger_entries WHERE payment_account_id=$1 LIMIT 1`, [account.id]);
      if (settled.rowCount) throw new BookingPaymentError('PAYMENT_PRICE_CHANGED_AFTER_SETTLEMENT', 'This booking price changed after payment activity. Review the payment history before continuing.', 409);
      if (!create) return { ...account, canonical_amount_due:subject.amountDue, pricing_revision:subject.pricingRevision };
      const refreshed = await queryable.query(`UPDATE booking_payment_accounts SET canonical_amount_due=$2,pricing_revision=$3,updated_at=NOW() WHERE id=$1 RETURNING *`, [account.id, subject.amountDue, subject.pricingRevision]); return refreshed.rows[0];
    }
    return account;
  }

  async function position(queryable, account, subject, suppliedRequirement = null) {
    if (!account) return {
      amountDue: subject.amountDue, paid: '0.00', refunded: '0.00', netPaid: '0.00',
      rewardsApplied: '0.00', welcomeVoucherApplied: '0.00', depositForfeited: '0.00',
      outstanding: subject.amountDue, state: 'unpaid', deposit: null, requests: [], entries: [],
    };
    const requirement = suppliedRequirement || await loadRequirement(queryable, account.id);
    const [totals, rewardsApplied, welcomeVoucherApplied, dispositions, requests, entries] = await Promise.all([
      queryable.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='payment'),0) paid,COALESCE(SUM(amount) FILTER (WHERE entry_type='refund'),0) refunded FROM payment_ledger_entries WHERE payment_account_id=$1`, [account.id]),
      queryable.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM booking_loyalty_allocations WHERE booking_payment_account_id=$1 AND state='applied'`, [account.id]),
      queryable.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM booking_welcome_voucher_allocations WHERE booking_payment_account_id=$1 AND state='applied'`, [account.id]),
      requirement
        ? queryable.query(`SELECT COALESCE(SUM(retained_amount),0) AS retained FROM booking_deposit_dispositions WHERE requirement_id=$1`, [requirement.id])
        : Promise.resolve({ rows:[{ retained:0 }] }),
      queryable.query(`SELECT id,request_key,provider,provider_request_id,provider_payment_url,amount,state,purpose,deposit_appointment_id,payer_name,payer_mobile,payer_crm_v2_client_id,expires_at,created_at FROM payment_requests WHERE payment_account_id=$1 ORDER BY id DESC`, [account.id]),
      queryable.query(`SELECT id,entry_type,amount,method,evidence_kind,external_reference,notes,payer_crm_v2_client_id,created_at FROM payment_ledger_entries WHERE payment_account_id=$1 ORDER BY id DESC`, [account.id]),
    ]);
    const paid = Number(totals.rows[0].paid), refunded = Number(totals.rows[0].refunded), net = paid - refunded;
    const loyalty = Number(rewardsApplied.rows[0].amount || 0), welcome = Number(welcomeVoucherApplied.rows[0].amount || 0);
    const retained = Number(dispositions.rows[0]?.retained || 0);
    const serviceCredit = Math.max(0, net - retained);
    const due = Number(account.canonical_amount_due);
    const outstanding = Math.max(0, due - serviceCredit - loyalty - welcome);
    let deposit = null;
    if (requirement) {
      const required = Number(requirement.required_amount || 0);
      const credited = Math.min(required, Math.max(0, serviceCredit));
      const remaining = Math.max(0, required - credited);
      deposit = {
        policyKey: String(requirement.policy_key),
        percentageBasisPoints: Number(requirement.percentage_basis_points),
        eligibleAmountBase: Number(requirement.eligible_amount_base).toFixed(2),
        requiredAmount: required.toFixed(2),
        receivedAmount: Math.min(required, Math.max(0, net)).toFixed(2),
        creditedAmount: credited.toFixed(2),
        forfeitedAmount: retained.toFixed(2),
        remainingAmount: remaining.toFixed(2),
        status: required === 0
          ? (requirement.exempt_reason ? 'exempt' : 'satisfied')
          : remaining === 0 ? 'satisfied' : credited > 0 ? 'partially_satisfied' : 'required',
        exemptReason: requirement.exempt_reason || null,
        fullReleaseNoticeHours: Number(requirement.full_release_notice_hours),
        partialNoticeHours: Number(requirement.partial_notice_hours),
        partialRetentionBasisPoints: Number(requirement.partial_retention_basis_points),
        lateRetentionBasisPoints: Number(requirement.late_retention_basis_points),
        noShowRetentionBasisPoints: Number(requirement.no_show_retention_basis_points),
        items: requirement.items || [],
      };
    }
    return {
      amountDue: due.toFixed(2), paid: paid.toFixed(2), refunded: refunded.toFixed(2), netPaid: net.toFixed(2),
      rewardsApplied: loyalty.toFixed(2), welcomeVoucherApplied: welcome.toFixed(2),
      depositForfeited: retained.toFixed(2), outstanding: outstanding.toFixed(2),
      state: serviceCredit + loyalty + welcome > due ? 'overpaid'
        : outstanding === 0 ? (refunded > 0 ? 'partially_refunded' : 'paid')
          : serviceCredit + loyalty + welcome > 0 ? 'partially_paid' : 'unpaid',
      deposit,
      requests: requests.rows, entries: entries.rows,
    };
  }

  async function get({ adminId, appointmentId } = {}) {
    const operator = await resolveOperator(db, adminId, CAPABILITIES.VIEW);
    const subject = await loadSubject(db, appointmentId); assertTarget(operator, subject);
    const account = await accountFor(db, subject);
    let rewardWallet=null;
    if(subject.crmV2ClientId){try{rewardWallet=await rewards.getClientBalance(subject.crmV2ClientId);}catch(error){logger.error({err:error,appointmentId:subject.appointmentId},'Shiloh Rewards balance unavailable on payment page');}}
    return { subject, payment: await position(db, account, subject), rewards: rewardWallet, authority: {
      canCollect: hasCapability(operator.calendarAuthority, CAPABILITIES.COLLECT),
      canRefund: hasCapability(operator.calendarAuthority, CAPABILITIES.REFUND),
      ozowConfigured: ozow.configured(),
    } };
  }

  async function resolvePayer(queryable, subject, payerMobile) {
    const digits=String(payerMobile||'').replace(/[^0-9]/g,'');
    if(digits){const row=(await queryable.query(`SELECT id FROM crm_v2_clients WHERE normalized_mobile=$1 AND status='active' LIMIT 1`,[digits])).rows[0];if(row)return Number(row.id);}
    return subject.groupId ? null : subject.crmV2ClientId;
  }

  async function resolveRefundPayer(queryable, account, subject, payerMobile) {
    if (String(payerMobile || '').trim()) {
      const payerClientId = await resolvePayer(queryable, subject, payerMobile);
      if (!payerClientId) throw new BookingPaymentError('PAYMENT_PAYER_CLIENT_REQUIRED', 'Choose the payer whose mobile number matches an active Shiloh client before recording the refund.', 409);
      return payerClientId;
    }
    const payers = await queryable.query(
      `SELECT DISTINCT payer_crm_v2_client_id
         FROM payment_ledger_entries
        WHERE payment_account_id=$1
          AND entry_type='payment'
          AND payer_crm_v2_client_id IS NOT NULL
        LIMIT 2`,
      [account.id],
    );
    if (payers.rows.length === 1) return Number(payers.rows[0].payer_crm_v2_client_id);
    if (payers.rows.length > 1 || subject.groupId) {
      throw new BookingPaymentError('PAYMENT_REFUND_PAYER_REQUIRED', 'Choose which payer is receiving this refund so their rewards stay accurate.', 409);
    }
    return subject.crmV2ClientId;
  }

  async function recordManual({ adminId, appointmentId, amount, method, reference, notes, payerMobile, operationId } = {}) {
    const normalizedAmount = money(amount, { positive: true }), normalizedMethod = normalizeMethod(method), key = requestKey(operationId);
    const client = await db.connect();
    let account; let subject; let before; let requirement;
    try {
      await client.query('BEGIN');
      const operator = await resolveOperator(client, adminId, CAPABILITIES.COLLECT);
      subject = await loadSubject(client, appointmentId, { lock: true }); assertTarget(operator, subject);
      if (subject.final) throw new BookingPaymentError('PAYMENT_BOOKING_FINAL', 'Payment cannot be collected against a cancelled booking.', 409);
      account = await accountFor(client, subject, { create: true });
      const policy = await loadDepositPolicy(client, subject);
      requirement = policy ? await ensureRequirement(client, account, subject, policy) : await loadRequirement(client, account.id);
      before = await position(client, account, subject, requirement);
      const operationKey=`manual:${operator.id}:${key}`;
      const replay = await client.query(`SELECT id FROM payment_ledger_entries WHERE operation_key=$1 LIMIT 1`, [operationKey]);
      if (!replay.rows[0]) {
        if (Number(normalizedAmount) > Number(before.outstanding)) throw new BookingPaymentError('PAYMENT_EXCEEDS_OUTSTANDING', 'The amount is greater than the booking balance.', 409);
        const payerClientId=await resolvePayer(client,subject,payerMobile||subject.clientMobile);
        if(subject.groupId&&!payerClientId)throw new BookingPaymentError('PAYMENT_PAYER_CLIENT_REQUIRED','Choose a payer whose mobile number matches an active Shiloh client before recording a group payment.',409);
        await client.query(`INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,method,evidence_kind,operation_key,external_reference,actor_admin_id,notes,payer_crm_v2_client_id) VALUES($1,'payment',$2,$3,$4,$5,$6,$7,$8,$9)`,
          [account.id, normalizedAmount, normalizedMethod, EVIDENCE.AUTHORIZED_MANUAL, operationKey, String(reference || '').trim() || null, operator.id, String(notes || '').trim() || null,payerClientId]);
        await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'payment.manual_recorded','booking_payment_account',$2,$3::jsonb)`,
          [operator.id, account.id, JSON.stringify({ amount: normalizedAmount, method: normalizedMethod, reference: String(reference || '').trim() || null, operationId: key })]);
      }
      const result = await position(client, account, subject, requirement); await client.query('COMMIT');
      await syncRewardsAfterPayment();
      const depositSatisfiedNow = !replay.rows[0] && before.deposit
        && before.deposit.status !== 'satisfied' && result.deposit?.status === 'satisfied';
      if (!replay.rows[0] && depositSatisfiedNow && Number(result.outstanding) > 0) {
        await sendPaymentTemplate({
          templateKey: PAYMENT_TEMPLATE_KEYS.DEPOSIT_RECEIVED,
          to: subject.clientMobile,
          bodyParameters: [
            subject.clientName || 'there', formatRand(result.deposit.requiredAmount), subject.serviceName,
            bookingDate(subject.startsAt), bookingTime(subject.startsAt), String(subject.appointmentId), formatRand(result.outstanding),
          ],
          send: sendTemplate,
        });
      } else if (!replay.rows[0]) {
        await sendPaymentTemplate({
          templateKey: PAYMENT_TEMPLATE_KEYS.RECEIVED,
          to: subject.clientMobile,
          bodyParameters: [subject.clientName || 'there', formatRand(normalizedAmount), String(normalizedMethod).replaceAll('_', ' '), String(reference || `SHILOH ${subject.appointmentId}`), formatRand(result.outstanding)],
          send: sendTemplate,
        });
      }
      if (!replay.rows[0] && pushNotify && subject.crmV2ClientId) {
        await pushNotify({
          crmV2ClientId: Number(subject.crmV2ClientId),
          eventKey: `payment-manual:${account.id}:${operationKey}`,
          category: 'payment',
          title: depositSatisfiedNow ? 'Deposit received' : 'Payment received',
          body: depositSatisfiedNow ? 'Your Shiloh booking deposit was received.' : 'Your Shiloh payment was recorded. Open My Shiloh for the latest booking balance.',
          targetPath: '/my-shiloh/#bookings',
        });
      }
      if (result.deposit?.status === 'satisfied') await releaseBookingConfirmations(account.id);
      return { status: replay.rows[0] ? 'idempotent_replay' : 'recorded', payment: result };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  async function createOzowRequest({ adminId, appointmentId, amount, payerName, payerMobile, payerConfirmed, operationId } = {}) {
    if (String(payerConfirmed || '').toLowerCase() !== 'true') throw new BookingPaymentError('PAYMENT_PAYER_CONFIRMATION_REQUIRED', 'Confirm the payer name and mobile number before creating a payment link.', 400);
    const normalizedAmount = money(amount, { positive: true }), key = requestKey(operationId);
    const client = await db.connect(); let account; let subject; let row; let purpose='balance'; let requirement;
    try {
      await client.query('BEGIN'); const operator = await resolveOperator(client, adminId, CAPABILITIES.COLLECT);
      subject = await loadSubject(client, appointmentId, { lock: true }); assertTarget(operator, subject);
      if (subject.final) throw new BookingPaymentError('PAYMENT_BOOKING_FINAL', 'A payment link cannot be created for a cancelled booking.', 409);
      account = await accountFor(client, subject, { create: true });
      const policy = await loadDepositPolicy(client, subject);
      requirement = policy ? await ensureRequirement(client, account, subject, policy) : await loadRequirement(client, account.id);
      const current = await position(client, account, subject, requirement);
      if (Number(normalizedAmount) > Number(current.outstanding)) throw new BookingPaymentError('PAYMENT_EXCEEDS_OUTSTANDING', 'The requested amount is greater than the booking balance.', 409);
      if (current.deposit && Number(current.deposit.remainingAmount) > 0) {
        if (Number(normalizedAmount) > Number(current.deposit.remainingAmount)) {
          throw new BookingPaymentError('PAYMENT_DEPOSIT_EXCEEDS_REQUIRED', `Collect the ${formatRand(current.deposit.remainingAmount)} booking deposit first. The remaining balance can be paid afterward.`, 409);
        }
        purpose='deposit';
      } else if (subject.groupId) {
        purpose='split';
      }
      const existing = await client.query(`SELECT * FROM payment_requests WHERE request_key=$1`, [key]); row = existing.rows[0];
      if (row && (Number(row.payment_account_id) !== Number(account.id) || Number(row.amount) !== Number(normalizedAmount))) throw new BookingPaymentError('PAYMENT_IDEMPOTENCY_MISMATCH', 'That operation identifier was already used for another payment request.', 409);
      if (!row) {
        const payerClientId=await resolvePayer(client,subject,payerMobile||subject.clientMobile);
        if(subject.groupId&&!payerClientId)throw new BookingPaymentError('PAYMENT_PAYER_CLIENT_REQUIRED','Choose a payer whose mobile number matches an active Shiloh client before creating a group payment link.',409);
        row = (await client.query(`INSERT INTO payment_requests(payment_account_id,request_key,provider,amount,purpose,deposit_appointment_id,payer_name,payer_mobile,created_by_admin_id,payer_crm_v2_client_id) VALUES($1,$2,'ozow',$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [account.id,key,normalizedAmount,purpose,purpose==='deposit'?subject.appointmentId:null,String(payerName || subject.clientName).trim() || null,String(payerMobile || subject.clientMobile).trim() || null,operator.id,payerClientId])).rows[0];
      }
      await client.query('COMMIT');
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
    if (row.provider_payment_url) return { status: 'idempotent_replay', request: row };
    const linked = await ozow.createPaymentLink({ requestKey:key, amount:normalizedAmount, bankReference:`SHILOH ${account.id}`, customerName:row.payer_name, customerMobile:row.payer_mobile });
    transitionPaymentState(STATES.CREATED, STATES.LINK_ISSUED);
    const updated = await db.query(`UPDATE payment_requests SET provider_request_id=$2,provider_payment_url=$3,state='link_issued',updated_at=NOW() WHERE id=$1 AND state='created' RETURNING *`, [row.id,linked.providerRequestId,linked.paymentUrl]);
    const request = updated.rows[0];
    if (request) await sendPaymentTemplate({
      templateKey: purpose === 'deposit' ? PAYMENT_TEMPLATE_KEYS.DEPOSIT_REQUEST : subject.groupId ? PAYMENT_TEMPLATE_KEYS.SPLIT_REQUEST : PAYMENT_TEMPLATE_KEYS.BALANCE_DUE,
      to: request.payer_mobile || subject.clientMobile,
      bodyParameters: purpose === 'deposit'
        ? [request.payer_name || subject.clientName || 'there', formatRand(request.amount), subject.serviceName, bookingDate(subject.startsAt), bookingTime(subject.startsAt), String(subject.appointmentId)]
        : subject.groupId
          ? [request.payer_name || subject.clientName || 'there', subject.serviceName, formatRand(request.amount), String(subject.appointmentId)]
          : [request.payer_name || subject.clientName || 'there', subject.serviceName, String(subject.appointmentId), formatRand(request.amount)],
      urlButtonParameter: request.request_key,
      send: sendTemplate,
    });
    if (request?.payer_crm_v2_client_id && pushNotify) {
      await pushNotify({
        crmV2ClientId: Number(request.payer_crm_v2_client_id),
        eventKey: `payment-request:${request.id}:link-issued`,
        category: 'payment',
        title: purpose === 'deposit' ? 'Deposit required' : 'Payment ready',
        body: purpose === 'deposit' ? 'Your 50% Shiloh booking deposit is ready to pay securely.' : 'A secure payment is ready for your Shiloh booking.',
        targetPath: '/my-shiloh/#bookings',
      });
    }
    return { status: 'link_issued', request };
  }

  async function ensureDepositRequest({ appointmentId } = {}) {
    const client = await db.connect();
    let subject; let account; let requirement; let current; let existingRequest=null; let requestRow=null; let requestAmount=0;
    try {
      await client.query('BEGIN');
      subject = await loadSubject(client, appointmentId, { lock:true });
      if (subject.final) { await client.query('COMMIT'); return { status:'final', applies:false }; }
      const policy = await loadDepositPolicy(client, subject);
      if (!policy) { await client.query('COMMIT'); return { status:'legacy', applies:false }; }
      account = await accountFor(client, subject, { create:true });
      requirement = await ensureRequirement(client, account, subject, policy);
      current = await position(client, account, subject, requirement);
      if (current.deposit?.status === 'exempt') {
        await client.query('COMMIT');
        return { status:'exempt', applies:true, deposit:current.deposit, payment:current };
      }
      if (current.deposit?.status === 'satisfied') {
        await client.query('COMMIT');
        return { status:'satisfied', applies:true, deposit:current.deposit, payment:current };
      }
      if (!ozow.configured()) {
        await client.query('COMMIT');
        return { status:'awaiting_deposit', applies:true, reason:'provider_unavailable', deposit:current.deposit, payment:current };
      }

      const item = (requirement.items || []).find(candidate => Number(candidate.appointment_id) === Number(subject.appointmentId));
      const requestAppointmentId = subject.groupType === 'multi_service_booking'
        ? Number((requirement.items || [])[0]?.appointment_id || subject.appointmentId)
        : subject.appointmentId;
      existingRequest = (await client.query(
        `SELECT *
           FROM payment_requests
          WHERE payment_account_id=$1
            AND purpose='deposit'
            AND deposit_appointment_id=$2
            AND state IN ('created','link_issued','pending')
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE`,
        [account.id, requestAppointmentId]
      )).rows[0] || null;
      if (existingRequest?.provider_payment_url) {
        await client.query('COMMIT');
        return { status:'awaiting_deposit', applies:true, reason:'payment_link_available', deposit:current.deposit, payment:current, request:existingRequest };
      }

      const activeOther = await client.query(
        `SELECT COALESCE(SUM(amount),0) AS amount
           FROM payment_requests
          WHERE payment_account_id=$1
            AND purpose='deposit'
            AND state IN ('created','link_issued','pending')
            AND ($2::bigint IS NULL OR id<>$2)`,
        [account.id, existingRequest?.id || null]
      );
      const unrequestedRemaining = Math.max(0, Number(current.deposit.remainingAmount) - Number(activeOther.rows[0].amount || 0));

      if (subject.groupType === 'multi_service_booking' || !subject.groupId) {
        requestAmount = unrequestedRemaining;
      } else if (item) {
        const memberPaid = subject.crmV2ClientId
          ? Number((await client.query(
              `SELECT COALESCE(SUM(CASE WHEN entry_type='payment' THEN amount ELSE -amount END),0) AS net
                 FROM payment_ledger_entries
                WHERE payment_account_id=$1
                  AND payer_crm_v2_client_id=$2`,
              [account.id, subject.crmV2ClientId]
            )).rows[0].net || 0)
          : 0;
        const memberRetained = Number((await client.query(
          `SELECT COALESCE(SUM(retained_amount),0) AS amount
             FROM booking_deposit_dispositions
            WHERE requirement_id=$1 AND appointment_id=$2`,
          [requirement.id, subject.appointmentId]
        )).rows[0].amount || 0);
        const memberRemaining = Math.max(0, Number(item.required_amount) - Math.max(0, memberPaid - memberRetained));
        requestAmount = Math.min(memberRemaining, unrequestedRemaining);
      }

      if (existingRequest && !existingRequest.provider_payment_url) {
        requestRow=existingRequest;
        requestAmount=Number(existingRequest.amount);
      } else if (requestAmount > 0.004) {
        const key=`dep_${crypto.randomBytes(18).toString('base64url')}`;
        requestRow=(await client.query(
          `INSERT INTO payment_requests(
             payment_account_id,request_key,provider,amount,purpose,deposit_appointment_id,
             payer_name,payer_mobile,payer_crm_v2_client_id
           ) VALUES($1,$2,'ozow',$3,'deposit',$4,$5,$6,$7)
           RETURNING *`,
          [
            account.id,key,requestAmount.toFixed(2),requestAppointmentId,
            subject.clientName || null,subject.clientMobile || null,subject.crmV2ClientId,
          ]
        )).rows[0];
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }

    if (!requestRow) {
      return { status:'awaiting_deposit', applies:true, reason:'other_deposit_requests_pending', deposit:current.deposit, payment:current };
    }

    try {
      const linked = await ozow.createPaymentLink({
        requestKey:requestRow.request_key,
        amount:requestRow.amount,
        bankReference:`SHILOH ${account.id}`,
        customerName:requestRow.payer_name,
        customerMobile:requestRow.payer_mobile,
      });
      const updated = await db.query(
        `UPDATE payment_requests
            SET provider_request_id=$2,provider_payment_url=$3,state='link_issued',updated_at=NOW()
          WHERE id=$1 AND state='created'
          RETURNING *`,
        [requestRow.id,linked.providerRequestId,linked.paymentUrl]
      );
      const request = updated.rows[0] || (await db.query(`SELECT * FROM payment_requests WHERE id=$1`,[requestRow.id])).rows[0];
      if (updated.rows[0]) {
        await sendPaymentTemplate({
          templateKey: PAYMENT_TEMPLATE_KEYS.DEPOSIT_REQUEST,
          to: request.payer_mobile || subject.clientMobile,
          bodyParameters: [
            request.payer_name || subject.clientName || 'there', formatRand(request.amount), subject.serviceName,
            bookingDate(subject.startsAt), bookingTime(subject.startsAt), String(subject.appointmentId),
          ],
          urlButtonParameter: request.request_key,
          send: sendTemplate,
        });
        if (request.payer_crm_v2_client_id && pushNotify) {
          await pushNotify({
            crmV2ClientId:Number(request.payer_crm_v2_client_id),
            eventKey:`deposit-request:${request.id}:link-issued`,
            category:'payment',
            title:'Deposit required',
            body:'Your 50% booking deposit is ready to pay securely.',
            targetPath:'/my-shiloh/#bookings',
          });
        }
      }
      return { status:'awaiting_deposit', applies:true, reason:'payment_link_available', deposit:current.deposit, payment:current, request };
    } catch (error) {
      logger.error({ err:error,appointmentId:subject.appointmentId,paymentAccountId:account.id }, 'Booking deposit payment link preparation failed');
      return { status:'awaiting_deposit', applies:true, reason:'provider_link_failed', deposit:current.deposit, payment:current };
    }
  }

  async function recordRefund({ adminId, appointmentId, amount, method, reference, notes, payerMobile, operationId } = {}) {
    const normalizedAmount=money(amount,{positive:true}), normalizedMethod=normalizeMethod(method), key=requestKey(operationId);
    const client=await db.connect();
    try{
      await client.query('BEGIN'); const operator=await resolveOperator(client,adminId,CAPABILITIES.REFUND);
      const subject=await loadSubject(client,appointmentId,{lock:true}); assertTarget(operator,subject);
      const account=await accountFor(client,subject,{create:true});
      const operationKey=`refund:${operator.id}:${key}`;
      const replay=await client.query(`SELECT id FROM payment_ledger_entries WHERE operation_key=$1 LIMIT 1`,[operationKey]);
      if(!replay.rows[0]){
        const current=await position(client,account,subject);
        if(Number(normalizedAmount)>Number(current.netPaid))throw new BookingPaymentError('PAYMENT_REFUND_EXCEEDS_NET_PAID','The refund is greater than the net amount received.',409);
        const payerClientId=await resolveRefundPayer(client,account,subject,payerMobile);
        await client.query(`INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,method,evidence_kind,operation_key,external_reference,actor_admin_id,notes,payer_crm_v2_client_id) VALUES($1,'refund',$2,$3,$4,$5,$6,$7,$8,$9)`,[account.id,normalizedAmount,normalizedMethod,EVIDENCE.AUTHORIZED_MANUAL,operationKey,String(reference||'').trim()||null,operator.id,String(notes||'').trim()||null,payerClientId]);
        await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'payment.refund_recorded','booking_payment_account',$2,$3::jsonb)`,[operator.id,account.id,JSON.stringify({amount:normalizedAmount,method:normalizedMethod,operationId:key})]);
      }
      const result=await position(client,account,subject);await client.query('COMMIT');await syncRewardsAfterPayment();
      if (!replay.rows[0]) await sendPaymentTemplate({
        templateKey: PAYMENT_TEMPLATE_KEYS.REFUND_UPDATE,
        to: subject.clientMobile,
        bodyParameters: [subject.clientName || 'there', 'Recorded', formatRand(normalizedAmount), String(reference || `SHILOH ${subject.appointmentId}`)],
        send: sendTemplate,
      });
      if (!replay.rows[0] && pushNotify && subject.crmV2ClientId) {
        await pushNotify({
          crmV2ClientId: Number(subject.crmV2ClientId),
          eventKey: `payment-refund:${account.id}:${operationKey}`,
          category: 'payment',
          title: 'Payment update',
          body: 'A refund was recorded for your Shiloh booking.',
          targetPath: '/my-shiloh/#bookings',
        });
      }
      return{status:replay.rows[0]?'idempotent_replay':'refunded',payment:result};
    }catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}
  }

  async function handleOzowNotification(payload = {}) {
    const raw = JSON.stringify(payload); const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const eventKey = String(payload.TransactionId || payload.transactionId || payload.PaymentRequestId || payload.requestId || '').trim();
    const requestReference = String(payload.TransactionReference || payload.transactionReference || '').trim();
    if (!eventKey || !requestReference || !ozow.verifyNotification(payload)) throw new BookingPaymentError('PAYMENT_PROVIDER_NOTIFICATION_REJECTED', 'Provider notification could not be verified.', 400);
    const status = String(payload.Status || payload.status || '').trim().toLowerCase();
    const paid = ['complete','completed','paid','successful','success'].includes(status);
    const cancelled = ['cancelled','canceled','abandoned'].includes(status);
    const notVerifiedOutcome = ['failed','error','cancelled','canceled','abandoned','expired','declined'].includes(status);
    const client = await db.connect();
    let paymentReceived = null;
    let paymentNotVerified = null;
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(`SELECT id FROM payment_provider_events WHERE provider='ozow' AND provider_event_key=$1`, [eventKey]);
      if (duplicate.rows[0]) { await client.query('COMMIT'); return { status:'duplicate' }; }
      const request = (await client.query(
        `SELECT pr.*,
                COALESCE(pr.deposit_appointment_id,bpa.appointment_id,(
                  SELECT agm.appointment_id
                    FROM appointment_group_members agm
                   WHERE agm.group_id=bpa.appointment_group_id
                   ORDER BY agm.guest_position,agm.appointment_id
                   LIMIT 1
                )) AS appointment_id
           FROM payment_requests pr
           LEFT JOIN booking_payment_accounts bpa ON bpa.id=pr.payment_account_id
          WHERE pr.request_key=$1
          FOR UPDATE OF pr`,
        [requestReference],
      )).rows[0];
      if (!request) { await client.query(`INSERT INTO payment_provider_events(provider,provider_event_key,signature_verified,payload_sha256,outcome) VALUES('ozow',$1,TRUE,$2,'unmatched')`, [eventKey,hash]); await client.query('COMMIT'); return { status:'unmatched' }; }
      if (paid) {
        const notifiedAmount = String(payload.Amount ?? payload.amount ?? '').trim();
        const notifiedCurrency = String(payload.CurrencyCode ?? payload.currencyCode ?? '').trim().toUpperCase();
        if (money(notifiedAmount) !== money(request.amount) || notifiedCurrency !== String(request.currency).toUpperCase()) {
          throw new BookingPaymentError('PAYMENT_PROVIDER_AMOUNT_MISMATCH', 'Provider payment amount or currency does not match the Shiloh payment request.', 400);
        }
      }
      let voucherIssued = null;
      if (paid && request.state !== 'paid') {
        transitionPaymentState(request.state, STATES.PAID, { evidence:EVIDENCE.VERIFIED_PROVIDER });
        if (request.gift_voucher_order_id) {
          voucherIssued = await issueVerifiedVoucher(client, request, eventKey);
        } else {
          await client.query(`INSERT INTO payment_ledger_entries(payment_account_id,payment_request_id,entry_type,amount,method,evidence_kind,provider_transaction_id,payer_crm_v2_client_id) VALUES($1,$2,'payment',$3,'ozow',$4,$5,$6) ON CONFLICT DO NOTHING`, [request.payment_account_id,request.id,request.amount,EVIDENCE.VERIFIED_PROVIDER,eventKey,request.payer_crm_v2_client_id]);
        }
        await client.query(`UPDATE payment_requests SET state='paid',updated_at=NOW() WHERE id=$1`, [request.id]);
        if (!request.gift_voucher_order_id) {
          const balance = (await client.query(
          `SELECT bpa.canonical_amount_due,
                  COALESCE(SUM(ple.amount) FILTER (WHERE ple.entry_type='payment'),0)
                  - COALESCE(SUM(ple.amount) FILTER (WHERE ple.entry_type='refund'),0) AS net_paid
             FROM booking_payment_accounts bpa
             LEFT JOIN payment_ledger_entries ple ON ple.payment_account_id=bpa.id
            WHERE bpa.id=$1
            GROUP BY bpa.id`,
          [request.payment_account_id],
          )).rows[0];
          paymentReceived = { request, remaining: Math.max(0, Number(balance?.canonical_amount_due || 0) - Number(balance?.net_paid || 0)) };
        }
      } else if (!paid && notVerifiedOutcome && ['link_issued', 'pending'].includes(String(request.state))) {
        const nextState = cancelled ? STATES.CANCELLED : STATES.FAILED;
        transitionPaymentState(request.state, nextState);
        await client.query(`UPDATE payment_requests SET state=$2,updated_at=NOW() WHERE id=$1`, [request.id, nextState]);
        if (request.gift_voucher_order_id) await client.query(`UPDATE gift_voucher_orders SET state=$2,updated_at=NOW() WHERE id=$1`, [request.gift_voucher_order_id, nextState]);
        paymentNotVerified = request;
      }
      await client.query(`INSERT INTO payment_provider_events(provider,provider_event_key,payment_request_id,signature_verified,payload_sha256,outcome) VALUES('ozow',$1,$2,TRUE,$3,'accepted')`, [eventKey,request.id,hash]);
      await client.query('COMMIT');
      await syncRewardsAfterPayment();
      if (paymentReceived) {
        let receivedSubject=null; let receivedPosition=null;
        if (paymentReceived.request.appointment_id) {
          receivedSubject=await loadSubject(db,paymentReceived.request.appointment_id);
          const receivedAccount=await accountFor(db,receivedSubject);
          if (receivedAccount) receivedPosition=await position(db,receivedAccount,receivedSubject);
        }
        if (paymentReceived.request.purpose === 'deposit' && receivedSubject && receivedPosition?.deposit) {
          await sendPaymentTemplate({
            templateKey: PAYMENT_TEMPLATE_KEYS.DEPOSIT_RECEIVED,
            to: paymentReceived.request.payer_mobile,
            bodyParameters: [
              paymentReceived.request.payer_name || receivedSubject.clientName || 'there',
              formatRand(paymentReceived.request.amount),receivedSubject.serviceName,
              bookingDate(receivedSubject.startsAt),bookingTime(receivedSubject.startsAt),
              String(receivedSubject.appointmentId),formatRand(receivedPosition.outstanding),
            ],
            send: sendTemplate,
          });
        } else {
          await sendPaymentTemplate({
            templateKey: PAYMENT_TEMPLATE_KEYS.RECEIVED,
            to: paymentReceived.request.payer_mobile,
            bodyParameters: [paymentReceived.request.payer_name || 'there', formatRand(paymentReceived.request.amount), 'Ozow', requestReference, formatRand(receivedPosition?.outstanding ?? paymentReceived.remaining)],
            send: sendTemplate,
          });
        }
        if (receivedPosition?.deposit?.status === 'satisfied') {
          await releaseBookingConfirmations(paymentReceived.request.payment_account_id);
        }
      }
      if (paymentNotVerified) await sendPaymentTemplate({
        templateKey: PAYMENT_TEMPLATE_KEYS.NOT_VERIFIED,
        to: paymentNotVerified.payer_mobile,
        bodyParameters: [paymentNotVerified.payer_name || 'there', `Booking #${paymentNotVerified.appointment_id || 'payment'}`, requestReference, formatRand(paymentNotVerified.amount)],
        send: sendTemplate,
      });
      if (voucherIssued) await sendPaymentTemplate({
        templateKey: PAYMENT_TEMPLATE_KEYS.VOUCHER_ISSUED,
        to: voucherIssued.order.delivery_mobile,
        bodyParameters: [voucherIssued.order.recipient_name, voucherIssued.voucher.voucher_code, formatRand(voucherIssued.voucher.original_value), withActionLink(formatVoucherDate(voucherIssued.voucher.valid_until), 'Secure voucher link', secureVoucherUrl(request.request_key))],
        urlButtonParameter: request.request_key,
        send: sendTemplate,
      });
      if (paymentReceived?.request?.payer_crm_v2_client_id && pushNotify) {
        await pushNotify({
          crmV2ClientId: Number(paymentReceived.request.payer_crm_v2_client_id),
          eventKey: `payment-provider:${paymentReceived.request.id}:paid`,
          category: 'payment',
          title: 'Payment received',
          body: 'Your Shiloh payment was received successfully.',
          targetPath: '/my-shiloh/#bookings',
        });
      }
      if (voucherIssued?.voucher?.recipient_crm_v2_client_id && pushNotify) {
        await pushNotify({
          crmV2ClientId: Number(voucherIssued.voucher.recipient_crm_v2_client_id),
          eventKey: `voucher-issued:${voucherIssued.voucher.id}`,
          category: 'voucher',
          title: 'A voucher has arrived',
          body: 'A Shiloh gift voucher is ready in your Wallet.',
          targetPath: '/my-shiloh/#wallet',
        });
      }
      return { status: paid ? 'paid' : 'accepted' };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  return { get, recordManual, recordRefund, createOzowRequest, ensureDepositRequest, handleOzowNotification };
}

module.exports = { CAPABILITIES, BookingPaymentError, money, createBookingPaymentService };
