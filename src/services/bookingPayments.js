const crypto = require('crypto');
const { pool } = require('../db/pool');
const { resolveCalendarAuthority, hasCapability, allowsAppointmentTarget } = require('./calendarAuthorization');
const { createOzowPaymentProvider } = require('./ozowPaymentProvider');
const { STATES, EVIDENCE, transitionPaymentState } = require('../domain/paymentState');
const { formatRand, normalizePaymentMobile } = require('./paymentValues');
const { issueVerifiedVoucher } = require('./giftVouchers');
const { createShilohRewardsService } = require('./shilohRewards');
const { queueClientNotification } = require('./myShilohPush');
const { createBookingDepositPolicyService } = require('./bookingDepositPolicy');
const logger = require('../lib/logger');
const { priorPaymentIncomingSql, priorPaymentOutgoingSql } = require('../domain/priorPaymentSql');
const { createBookingPriorPaymentActions } = require('./bookingPriorPayments');
const { createBookingNoChargeActions } = require('./bookingNoCharge');
const { createBookingDepositWaiverActions } = require('./bookingDepositWaiver');

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

function createBookingPaymentService({
  db = pool,
  ozow = createOzowPaymentProvider(),
  rewards = createShilohRewardsService({ db }),
  notifyClient = null,
  confirmBooking = db === pool ? (id,options) => require('./customerBookingConfirmation').sendCustomerBookingConfirmationForAppointment(id,options) : async () => {},
  deposits = createBookingDepositPolicyService({ db }),
  env = process.env,
  now = () => new Date(),
} = {}) {
  const pushNotify = notifyClient || (db === pool ? queueClientNotification : null);
  async function syncRewardsAfterPayment() {
    try { await rewards.syncEligibleEarnings(); }
    catch (error) { logger.error({ err:error }, 'Shiloh Rewards payment sync failed'); }
  }
  function depositMemberMap(position) {
    return new Map((position.members || []).map(member => [Number(member.appointment_id), member]));
  }

  function depositRequestPlans(position) {
    const requirement = position.requirement;
    if (!position.applicable || !requirement || requirement.state !== 'awaiting') return [];
    const byAppointment = depositMemberMap(position);
    const eligibleMembers = position.scope.members.filter(member => Number(byAppointment.get(member.appointmentId)?.required_amount || 0) > 0);
    if (!eligibleMembers.length) return [];
    if (position.scope.groupSource === 'shiloh_my_shiloh_couples') {
      return [{ member:position.scope.members[0],amount:Number(requirement.required_amount).toFixed(2) }];
    }
    if (['couples_massage','group_booking'].includes(String(position.scope.groupType || ''))) {
      return eligibleMembers.map(member => ({
        member,
        amount: Number(byAppointment.get(member.appointmentId).required_amount).toFixed(2),
      }));
    }
    return [{
      member: eligibleMembers[0],
      amount: Number(requirement.required_amount).toFixed(2),
    }];
  }

  async function ensureDepositRequest(input = {}) {
    const client = await db.connect();
    let acquired = false;
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('shiloh-prior-payments')) AS acquired");
      acquired = lock.rows[0]?.acquired === true;
      if (!acquired) throw new BookingPaymentError('DEPOSIT_DECISION_BUSY', 'A payment or deposit decision is in progress. Reload before retrying.', 409);
      // Session lock spans provider creation and durable notice claims. Keep their
      // existing autocommit evidence so uncertain external delivery cannot retry blindly.
      return await issueDepositRequests(input, client);
    } finally {
      try { if (acquired) await client.query("SELECT pg_advisory_unlock(hashtext('shiloh-prior-payments'))"); }
      finally { client.release(); }
    }
  }

  async function issueDepositRequests({ appointmentId } = {}, queryable) {
    const position = await deposits.ensureRequirement({ appointmentId });
    if (['shiloh_my_shiloh_multi','shiloh_my_shiloh_couples'].includes(position.scope?.groupSource)) {
      const { clientGroupApprovalGate } = require('./myShilohMultipleBooking');
      const gate = await clientGroupApprovalGate(queryable, position.scope.groupId);
      if (!gate.ready) return { status:'awaiting_group_approval', deposit:position, requests:[] };
    }
    if (!position.applicable || !position.requirement || position.requirement.state !== 'awaiting') {
      return { status:'not_required', deposit:position, requests:[] };
    }
    const rootAppointmentId = Number(position.scope.members[0]?.appointmentId || position.scope.appointmentId);
    if (position.scope.groupId && Number(appointmentId) !== rootAppointmentId) {
      return { status:'deposit_waiting_on_group', deposit:position, requests:[] };
    }
    const plans = depositRequestPlans(position);
    if (!plans.length) return { status:'not_required', deposit:position, requests:[] };
    const created = [];
    for (const plan of plans) {
      let row = (await queryable.query(
        `SELECT * FROM payment_requests
          WHERE purpose='deposit'
            AND deposit_requirement_id=$1
            AND deposit_member_appointment_id=$2
          LIMIT 1`,
        [position.requirement.id, plan.member.appointmentId],
      )).rows[0];
      if (!row) {
        const key = `dep_${crypto.randomBytes(18).toString('base64url')}`;
        row = (await queryable.query(
          `INSERT INTO payment_requests(
             payment_account_id,request_key,provider,amount,payer_name,payer_mobile,payer_crm_v2_client_id,
             purpose,deposit_requirement_id,deposit_member_appointment_id
           ) VALUES($1,$2,'ozow',$3,$4,$5,$6,'deposit',$7,$8)
           ON CONFLICT (deposit_requirement_id,deposit_member_appointment_id)
             WHERE purpose='deposit' AND deposit_requirement_id IS NOT NULL AND deposit_member_appointment_id IS NOT NULL
           DO UPDATE SET updated_at=payment_requests.updated_at
           RETURNING *`,
          [
            position.requirement.payment_account_id,
            key,
            plan.amount,
            plan.member.clientName || null,
            plan.member.clientMobile || null,
            plan.member.crmV2ClientId || null,
            position.requirement.id,
            plan.member.appointmentId,
          ],
        )).rows[0];
      }
      if (!row.provider_payment_url && ozow.configured()) {
        const linked = await ozow.createPaymentLink({
          requestKey: row.request_key,
          amount: row.amount,
          bankReference: `SHILOH D${position.requirement.id}`,
          customerName: row.payer_name,
          customerMobile: row.payer_mobile,
        });
        transitionPaymentState(STATES.CREATED, STATES.LINK_ISSUED);
        row = (await queryable.query(
          `UPDATE payment_requests
              SET provider_request_id=$2,provider_payment_url=$3,state='link_issued',updated_at=NOW()
            WHERE id=$1 AND state='created'
            RETURNING *`,
          [row.id, linked.providerRequestId, linked.paymentUrl],
        )).rows[0] || row;
      }
      if (row.provider_payment_url && String(row.state) === 'link_issued' && !row.deposit_notification_sent_at) {
        const appOnlyEnabled = env.SHILOH_DEPOSIT_NOTICE_APP_ONLY_ENABLED === 'true' && Boolean(pushNotify)
          && Number(row.payer_crm_v2_client_id) > 0
          && Number(row.payer_crm_v2_client_id) === Number(plan.member.crmV2ClientId);
        if (appOnlyEnabled) {
          const identity = await queryable.query(`SELECT 1 FROM appointments a JOIN crm_v2_clients c
            ON c.id=a.crm_v2_client_id AND c.status='active'
            WHERE a.id=$1 AND a.client_id IS NULL AND c.id=$2`,
          [plan.member.appointmentId, row.payer_crm_v2_client_id]);
          if (identity.rowCount) {
            const claim = await queryable.query(`UPDATE payment_requests SET deposit_notice_state='sending',updated_at=NOW()
              WHERE id=$1 AND state='link_issued' AND deposit_notice_state='pending'
                AND deposit_notification_sent_at IS NULL RETURNING *`, [row.id]);
            if (!claim.rowCount) {
              created.push(row);
              continue;
            }
            let appDelivery;
            try {
              appDelivery = await pushNotify({
                crmV2ClientId: Number(row.payer_crm_v2_client_id),
                eventKey: `deposit-request:${row.id}:link-issued`,
                category: 'payment',
                title: 'Booking deposit required',
                body: `Your 50% Shiloh booking deposit of ${formatRand(row.amount)} is ready to pay.`,
                targetPath: '/my-shiloh/#bookings',
              });
            } catch (error) {
              logger.warn({ err: error, paymentRequestId: row.id }, 'Deposit app wake failed');
            }
            if (appDelivery?.queued === true && Number(appDelivery.accepted) > 0) {
              const recorded = await queryable.query(`UPDATE payment_requests SET deposit_notice_state='sent',deposit_notice_channel='my_shiloh',
                deposit_notification_sent_at=NOW(),updated_at=NOW() WHERE id=$1 AND deposit_notice_state='sending' RETURNING *`, [row.id]);
              if (!recorded.rowCount) throw new Error('Accepted deposit app notice requires a durable delivery record');
              created.push(recorded.rows[0]);
              continue;
            }
            await queryable.query(`UPDATE payment_requests SET deposit_notice_state='pending',updated_at=NOW()
              WHERE id=$1 AND deposit_notice_state='sending'`, [row.id]);
            created.push(row);
            continue;
          }
        }
        if (row.payer_crm_v2_client_id && pushNotify) {
          await pushNotify({
            crmV2ClientId: Number(row.payer_crm_v2_client_id),
            eventKey: `deposit-request:${row.id}:link-issued`,
            category: 'payment',
            title: 'Booking deposit required',
            body: `Your 50% Shiloh booking deposit of ${formatRand(row.amount)} is ready to pay.`,
            targetPath: '/my-shiloh/#bookings',
          });
        }
      }
      created.push(row);
    }
    return {
      status: ozow.configured() ? 'deposit_requested' : 'deposit_awaiting_provider',
      deposit: position,
      requests: created,
    };
  }

  async function retryDepositRequest({ adminId, appointmentId } = {}) {
    const operator = await resolveOperator(db, adminId, CAPABILITIES.COLLECT);
    const subject = await loadSubject(db, appointmentId);
    assertTarget(operator, subject);
    if (subject.final) throw new BookingPaymentError('PAYMENT_BOOKING_FINAL', 'A cancelled booking cannot collect a deposit.', 409);
    return ensureDepositRequest({ appointmentId: subject.appointmentId });
  }

  async function releaseConfirmedBookingAfterDeposit(position) {
    if (!position?.requirement?.transitioned) return;
    const sendCustomerBookingConfirmationForAppointment = confirmBooking;
    for (const member of position.scope.members) {
      try { await sendCustomerBookingConfirmationForAppointment(member.appointmentId, { clientGroupDispatch:true }); }
      catch (error) { logger.error({ err:error, appointmentId:member.appointmentId }, 'Deposit satisfied but booking confirmation release failed'); }
    }
  }

  async function syncDepositAfterSettlement(appointmentId) {
    try {
      const position = await deposits.getPosition({ appointmentId });
      if (position?.requirement?.transitioned) await releaseConfirmedBookingAfterDeposit(position);
      return position;
    } catch (error) {
      logger.error({ err:error, appointmentId }, 'Booking deposit settlement sync failed');
      return null;
    }
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
       SELECT a.id AS appointment_id,a.client_id AS legacy_client_id,a.crm_v2_client_id,a.status AS appointment_status,a.total_price AS appointment_total,
              a.currency,a.updated_at AS appointment_revision,
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
              to_jsonb(a)->>'financial_classification' AS financial_classification,
              to_jsonb(a)->>'pre_adjustment_total_price' AS original_price,
              g.id AS group_id,g.status AS group_status,COALESCE(g.final_total,g.total_price) AS group_total,
              g.updated_at AS group_revision,
              ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_id IS NOT NULL ORDER BY ast.position) AS staff_ids,
              ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id AND aps.service_id IS NOT NULL ORDER BY aps.position) AS service_ids
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
      crmV2ClientId: row.crm_v2_client_id ? Number(row.crm_v2_client_id) : null,
      legacyClientId: row.legacy_client_id ? Number(row.legacy_client_id) : null,
      amountDue: money(amount), currency: String(row.currency || 'ZAR'),
      pricingRevision: new Date(row.group_id ? row.group_revision : row.appointment_revision).toISOString(),
      clientName: String(row.client_name || ''), clientMobile: String(row.client_mobile || ''),
      serviceName: String(row.service_name || 'Shiloh appointment'),
      staffIds: row.staff_ids.map(Number), serviceIds: row.service_ids.map(Number),
      financialClassification: row.financial_classification || 'standard', originalPrice: row.original_price,
      status: String(row.group_id ? row.group_status : row.appointment_status),
      final: ['cancelled'].includes(String(row.group_id ? row.group_status : row.appointment_status)),
    };
  }

  function assertTarget(operator, subject) {
    if (!allowsAppointmentTarget(operator.calendarAuthority, subject)) {
      throw new BookingPaymentError('PAYMENT_FORBIDDEN', 'This booking is outside the current Calendar and service scope.', 403);
    }
  }

  async function accountFor(queryable, subject, { create = false, allowPriceReview = false } = {}) {
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
      const settled = await queryable.query(`SELECT 1 FROM payment_ledger_entries WHERE payment_account_id=$1 UNION ALL SELECT 1 FROM treatment_credit_entries WHERE booking_payment_account_id=$1 UNION ALL SELECT 1 FROM booking_gift_voucher_allocations WHERE booking_payment_account_id=$1 UNION ALL SELECT 1 FROM booking_prior_payment_entries WHERE booking_payment_account_id=$1 OR source_payment_account_id=$1 LIMIT 1`, [account.id]);
      if (settled.rowCount) {
        if (!create && allowPriceReview) return { ...account, priceReview: { kind: 'price_changed_after_settlement', recordedAmountDue: money(account.canonical_amount_due), currentAmountDue: subject.amountDue } };
        throw new BookingPaymentError('PAYMENT_PRICE_CHANGED_AFTER_SETTLEMENT', 'This booking price changed after payment activity. Review the payment history before continuing.', 409);
      }
      if (!create) return { ...account, canonical_amount_due:subject.amountDue, pricing_revision:subject.pricingRevision };
      const refreshed = await queryable.query(`UPDATE booking_payment_accounts SET canonical_amount_due=$2,pricing_revision=$3,updated_at=NOW() WHERE id=$1 RETURNING *`, [account.id, subject.amountDue, subject.pricingRevision]); return refreshed.rows[0];
    }
    return account;
  }

  async function position(queryable, account, subject) {
    if (!account) return { accountId:null,amountDue: subject.amountDue, paid: '0.00', refunded: '0.00', netPaid: '0.00', priorPaid:'0.00',transferredOut:'0.00',previouslyPaid:'0.00',receivedToday:'0.00',rewardsApplied: '0.00', welcomeVoucherApplied: '0.00', treatmentCreditApplied: '0.00', giftVoucherApplied: '0.00', noncashEntries: [], outstanding: subject.amountDue, state: 'unpaid', requests: [], entries: [] };
    const [totals, rewardsApplied, welcomeVoucherApplied, requests, entries] = await Promise.all([
      queryable.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='payment'),0) paid,COALESCE(SUM(amount) FILTER (WHERE entry_type='refund'),0) refunded,
        ${priorPaymentIncomingSql('$1')} AS prior_paid,${priorPaymentOutgoingSql('$1')} AS transferred_out,
        COALESCE(SUM(amount) FILTER (WHERE entry_type='payment' AND (created_at AT TIME ZONE 'Africa/Johannesburg')::date=$2::date),0) AS received_today,
        COALESCE(SUM(CASE WHEN entry_type='payment' THEN amount ELSE -amount END) FILTER (WHERE (created_at AT TIME ZONE 'Africa/Johannesburg')::date<$2::date),0) AS received_before
        FROM payment_ledger_entries WHERE payment_account_id=$1`, [account.id,now().toLocaleDateString('en-CA',{timeZone:'Africa/Johannesburg'})]),
      queryable.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM booking_loyalty_allocations WHERE booking_payment_account_id=$1 AND state='applied'`, [account.id]),
      queryable.query(`SELECT COALESCE(SUM(amount),0) AS amount,COALESCE((SELECT -SUM(signed_amount) FROM treatment_credit_entries WHERE booking_payment_account_id=$1 AND entry_type IN ('apply','undo')),0) AS treatment_amount,
        COALESCE((SELECT SUM(amount) FROM booking_gift_voucher_allocations WHERE booking_payment_account_id=$1),0) AS gift_amount,
        COALESCE((SELECT jsonb_agg(history ORDER BY history->>'created_at' DESC) FROM (
          SELECT jsonb_build_object('kind','treatment_credit','id',e.id,'action',e.entry_type,'amount',-e.signed_amount,'reason',e.reason,'actor',a.display_name,'created_at',e.created_at,'sourceEntryId',e.source_entry_id) AS history
            FROM treatment_credit_entries e JOIN staff_admin_accounts a ON a.id=e.actor_admin_id WHERE e.booking_payment_account_id=$1
          UNION ALL SELECT jsonb_build_object('kind','gift_voucher','id',allocation.id,'action','apply','amount',allocation.amount,'reason','Gift voucher ending '||RIGHT(v.voucher_code,4),'actor',a.display_name,'created_at',allocation.created_at)
            FROM booking_gift_voucher_allocations allocation JOIN gift_voucher_ledger_entries ledger ON ledger.id=allocation.voucher_ledger_entry_id
            JOIN gift_vouchers v ON v.id=ledger.voucher_id JOIN staff_admin_accounts a ON a.id=allocation.actor_admin_id WHERE allocation.booking_payment_account_id=$1
        ) noncash_history),'[]'::jsonb) AS noncash_entries FROM booking_welcome_voucher_allocations WHERE booking_payment_account_id=$1 AND state='applied'`, [account.id]),
      queryable.query(`SELECT id,request_key,provider,provider_request_id,provider_payment_url,amount,state,purpose,deposit_requirement_id,deposit_member_appointment_id,payer_name,payer_mobile,expires_at,created_at FROM payment_requests WHERE payment_account_id=$1 ORDER BY id DESC`, [account.id]),
      queryable.query(`SELECT id,entry_type,amount,method,evidence_kind,external_reference,notes,created_at FROM payment_ledger_entries WHERE payment_account_id=$1 ORDER BY id DESC`, [account.id]),
    ]);
    const priorPaid = Number(totals.rows[0].prior_paid || 0), transferredOut = Number(totals.rows[0].transferred_out || 0);
    const paid = Number(totals.rows[0].paid), refunded = Number(totals.rows[0].refunded), net = paid - refunded - transferredOut, loyalty = Number(rewardsApplied.rows[0].amount || 0), welcome = Number(welcomeVoucherApplied.rows[0].amount || 0), treatment = Number(welcomeVoucherApplied.rows[0].treatment_amount || 0), gift = Number(welcomeVoucherApplied.rows[0].gift_amount || 0);
    const due = Number(account.canonical_amount_due), settledCents = Math.round(net*100)+Math.round(priorPaid*100)+Math.round(loyalty*100)+Math.round(welcome*100)+Math.round(treatment*100)+Math.round(gift*100),outstanding = Math.max(0, Math.round(due*100)-settledCents)/100;
    return {
      accountId:Number(account.id),amountDue: due.toFixed(2), paid: paid.toFixed(2), refunded: refunded.toFixed(2), netPaid: net.toFixed(2), rewardsApplied: loyalty.toFixed(2), welcomeVoucherApplied: welcome.toFixed(2), treatmentCreditApplied: treatment.toFixed(2), giftVoucherApplied: gift.toFixed(2), noncashEntries: welcomeVoucherApplied.rows[0].noncash_entries || [], outstanding: outstanding.toFixed(2),
      priorPaid:priorPaid.toFixed(2),transferredOut:transferredOut.toFixed(2),previouslyPaid:(Number(totals.rows[0].received_before||0)-transferredOut+priorPaid).toFixed(2),receivedToday:Number(totals.rows[0].received_today||0).toFixed(2),
      state: settledCents > Math.round(due*100) ? 'overpaid' : outstanding === 0 ? (refunded > 0 ? 'partially_refunded' : 'paid') : settledCents > 0 ? 'partially_paid' : 'unpaid',
      requests: requests.rows, entries: entries.rows,
    };
  }

  // Opening Calendar details must never create an account, requirement, link or receipt.
  // Reuse the canonical payment position inside an enforced read-only snapshot.
  async function getSummary({ adminId, appointmentId } = {}) {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='2000ms'");
      const operator = await resolveOperator(client, adminId, CAPABILITIES.VIEW);
      const subject = await loadSubject(client, appointmentId);
      assertTarget(operator, subject);
      const account = await accountFor(client, subject, { allowPriceReview: true });
      const summary = account?.priceReview
        ? { available: true, state: 'needs_review', label: 'Payment review needed', outstanding: null }
        : { available: true, state: 'known', outstanding: (await position(client, account, subject)).outstanding,
          scopeLabel: subject.groupId ? 'Whole booking balance' : 'Appointment balance' };
      await client.query('COMMIT');
      return summary;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function get({ adminId, appointmentId } = {}, { allowPriceReview = false } = {}) {
    const operator = await resolveOperator(db, adminId, CAPABILITIES.VIEW);
    const subject = await loadSubject(db, appointmentId); assertTarget(operator, subject);
    const account = await accountFor(db, subject, { allowPriceReview });
    const priceReview = account?.priceReview || null;
    let rewardWallet=null;
    if(!priceReview && subject.crmV2ClientId){try{rewardWallet=await rewards.getClientBalance(subject.crmV2ClientId);}catch(error){logger.error({err:error,appointmentId:subject.appointmentId},'Shiloh Rewards balance unavailable on payment page');}}
    let deposit=null;
    if (!priceReview) { try { await deposits.ensureRequirement({ appointmentId:subject.appointmentId }); deposit=await deposits.getPosition({ appointmentId:subject.appointmentId }); } catch (error) { logger.error({err:error,appointmentId:subject.appointmentId},'Booking deposit position unavailable'); } }
    let paymentReview=null;
    if (account?.id) {
      const review = await db.query(
        `SELECT created_at,metadata
           FROM crm_audit_events
          WHERE action IN ('payment.received_after_booking_cancelled','payment.received_after_prior_settlement','payment.received_after_no_charge','payment.received_after_deposit_waived')
            AND entity_type='booking_payment_account'
            AND entity_id=$1::bigint
          ORDER BY created_at DESC,id DESC
          LIMIT 1`,
        [account.id],
      );
      if (review.rows[0]) paymentReview = {
        kind: review.rows[0].metadata?.depositWaived ? 'waived_deposit_payment_received' : review.rows[0].metadata?.noCharge ? 'no_charge_payment_received' : review.rows[0].metadata?.priorPaymentEntryId ? 'prior_settlement_payment_received' : 'cancelled_booking_payment_received',
        createdAt: review.rows[0].created_at,
        metadata: review.rows[0].metadata || {},
      };
    }
    const noChargeEvidence = (await db.query(`SELECT e.created_at,e.metadata,a.display_name AS actor_name FROM crm_audit_events e JOIN staff_admin_accounts a ON a.id=e.actor_admin_id WHERE e.action='booking.no_charge_recorded' AND e.entity_type='appointment' AND e.entity_id=$1 ORDER BY e.id DESC LIMIT 1`,[subject.appointmentId])).rows[0] || null;
    let depositWaiverEvidence=null;
    if(account?.id && deposit?.requirement?.state==='waived') {
      const row=(await db.query(`SELECT e.created_at,e.metadata->'result'->>'reason' AS reason,a.display_name AS actor_name
        FROM crm_audit_events e JOIN staff_admin_accounts a ON a.id=e.actor_admin_id
        WHERE e.action='booking.deposit_waived' AND e.entity_type='booking_payment_account' AND e.entity_id=$1
          AND e.metadata->'result'->>'requirementId'=$2 ORDER BY e.id DESC LIMIT 1`,[account.id,String(deposit.requirement.id)])).rows[0];
      if(row)depositWaiverEvidence={reason:row.reason,actorName:row.actor_name,createdAt:row.created_at};
    }
    return { subject, depositWaiverEvidence, noChargeEvidence, priceReview, payment: await position(db, account, subject), priorPayments:await prior.evidenceModel(db,subject,account,!priceReview&&hasCapability(operator.calendarAuthority,CAPABILITIES.COLLECT)&&prior.allowed(operator)), deposit, rewards: rewardWallet, paymentReview, authority: {
      canCollect: !priceReview && hasCapability(operator.calendarAuthority, CAPABILITIES.COLLECT),
      canRecordNoCharge: !priceReview && noCharge.allowed(operator),
      canWaiveDeposit: !priceReview && !subject.final && await waiver.allowed(operator),
      canRecordPrior:!priceReview&&hasCapability(operator.calendarAuthority,CAPABILITIES.COLLECT)&&prior.allowed(operator),
      canRefund: !priceReview && hasCapability(operator.calendarAuthority, CAPABILITIES.REFUND),
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
    try {
      await client.query('BEGIN');
      const operator = await resolveOperator(client, adminId, CAPABILITIES.COLLECT);
      const subject = await loadSubject(client, appointmentId, { lock: true }); assertTarget(operator, subject);
      if (subject.final) throw new BookingPaymentError('PAYMENT_BOOKING_FINAL', 'Payment cannot be collected against a cancelled booking.', 409);
      const account = await accountFor(client, subject, { create: true });
      const operationKey=`manual:${operator.id}:${key}`;
      const replay = await client.query(`SELECT id FROM payment_ledger_entries WHERE operation_key=$1 LIMIT 1`, [operationKey]);
      if (!replay.rows[0]) {
        const current = await position(client, account, subject);
        if (Number(normalizedAmount) > Number(current.outstanding)) throw new BookingPaymentError('PAYMENT_EXCEEDS_OUTSTANDING', 'The amount is greater than the booking balance.', 409);
        const payerClientId=await resolvePayer(client,subject,payerMobile||subject.clientMobile);
        if(subject.groupId&&!payerClientId)throw new BookingPaymentError('PAYMENT_PAYER_CLIENT_REQUIRED','Choose a payer whose mobile number matches an active Shiloh client before recording a group payment.',409);
        await client.query(`INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,method,evidence_kind,operation_key,external_reference,actor_admin_id,notes,payer_crm_v2_client_id) VALUES($1,'payment',$2,$3,$4,$5,$6,$7,$8,$9)`,
          [account.id, normalizedAmount, normalizedMethod, EVIDENCE.AUTHORIZED_MANUAL, operationKey, String(reference || '').trim() || null, operator.id, String(notes || '').trim() || null,payerClientId]);
        await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'payment.manual_recorded','booking_payment_account',$2,$3::jsonb)`,
          [operator.id, account.id, JSON.stringify({ amount: normalizedAmount, method: normalizedMethod, reference: String(reference || '').trim() || null, operationId: key })]);
      }
      const result = await position(client, account, subject); await client.query('COMMIT');
      await syncRewardsAfterPayment();
      await syncDepositAfterSettlement(subject.appointmentId);
      if (!replay.rows[0] && pushNotify && subject.crmV2ClientId) {
        await pushNotify({
          crmV2ClientId: Number(subject.crmV2ClientId),
          eventKey: `payment-manual:${account.id}:${operationKey}`,
          category: 'payment',
          title: 'Payment received',
          body: 'Your Shiloh payment was recorded. Open My Shiloh for the latest booking balance.',
          targetPath: '/my-shiloh/#bookings',
        });
      }
      return { status: replay.rows[0] ? 'idempotent_replay' : 'recorded', payment: result };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  async function createOzowRequest({ adminId, appointmentId, amount, payerName, payerMobile, payerConfirmed, operationId } = {}) {
    if (String(payerConfirmed || '').toLowerCase() !== 'true') throw new BookingPaymentError('PAYMENT_PAYER_CONFIRMATION_REQUIRED', 'Confirm the payer name and mobile number before creating a payment link.', 400);
    const normalizedAmount = money(amount, { positive: true }), key = requestKey(operationId);
    const client = await db.connect(); let account; let subject; let row;
    try {
      await client.query('BEGIN'); const operator = await resolveOperator(client, adminId, CAPABILITIES.COLLECT);
      subject = await loadSubject(client, appointmentId, { lock: true }); assertTarget(operator, subject);
      if (subject.final) throw new BookingPaymentError('PAYMENT_BOOKING_FINAL', 'A payment link cannot be created for a cancelled booking.', 409);
      account = await accountFor(client, subject, { create: true }); const current = await position(client, account, subject);
      if (Number(normalizedAmount) > Number(current.outstanding)) throw new BookingPaymentError('PAYMENT_EXCEEDS_OUTSTANDING', 'The requested amount is greater than the booking balance.', 409);
      const existing = await client.query(`SELECT * FROM payment_requests WHERE request_key=$1`, [key]); row = existing.rows[0];
      if (row && (Number(row.payment_account_id) !== Number(account.id) || Number(row.amount) !== Number(normalizedAmount))) throw new BookingPaymentError('PAYMENT_IDEMPOTENCY_MISMATCH', 'That operation identifier was already used for another payment request.', 409);
      if (!row) {
        const active = await client.query(
          `SELECT request_key FROM payment_requests
            WHERE payment_account_id=$1 AND amount=$2 AND payer_mobile=$3
              AND state IN ('link_issued','pending') AND provider_payment_url IS NOT NULL
              AND (expires_at IS NULL OR expires_at>NOW())
            LIMIT 1`,
          [account.id, normalizedAmount, String(payerMobile || subject.clientMobile).trim()],
        );
        if (active.rows.length) throw new BookingPaymentError('PAYMENT_LINK_ALREADY_ACTIVE', 'An active link for this payer and amount already exists. Copy that link from Payment requests instead.', 409);
        const payerClientId=await resolvePayer(client,subject,payerMobile||subject.clientMobile);
        if(subject.groupId&&!payerClientId)throw new BookingPaymentError('PAYMENT_PAYER_CLIENT_REQUIRED','Choose a payer whose mobile number matches an active Shiloh client before creating a group payment link.',409);
        row = (await client.query(`INSERT INTO payment_requests(payment_account_id,request_key,provider,amount,payer_name,payer_mobile,created_by_admin_id,payer_crm_v2_client_id) VALUES($1,$2,'ozow',$3,$4,$5,$6,$7) RETURNING *`, [account.id,key,normalizedAmount,String(payerName || subject.clientName).trim() || null,String(payerMobile || subject.clientMobile).trim() || null,operator.id,payerClientId])).rows[0];
      }
      await client.query('COMMIT');
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
    if (row.provider_payment_url) return { status: 'idempotent_replay', request: row };
     const linked = await ozow.createPaymentLink({ requestKey:key, amount:normalizedAmount, bankReference:`SHILOH ${account.id}`, customerName:row.payer_name, customerMobile:row.payer_mobile });
     transitionPaymentState(STATES.CREATED, STATES.LINK_ISSUED);
     const updated = await db.query(`UPDATE payment_requests SET provider_request_id=$2,provider_payment_url=$3,state='link_issued',updated_at=NOW() WHERE id=$1 AND state='created' RETURNING *`, [row.id,linked.providerRequestId,linked.paymentUrl]);
     const request = updated.rows[0];
     if (request?.payer_crm_v2_client_id && pushNotify) {
       await pushNotify({
         crmV2ClientId: Number(request.payer_crm_v2_client_id),
         eventKey: `payment-request:${request.id}:link-issued`,
         category: 'payment',
         title: 'Payment ready',
         body: 'A secure payment is ready for your Shiloh booking.',
         targetPath: '/my-shiloh/#bookings',
       });
     }
     return { status: 'link_issued', request: updated.rows[0] };
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
      const result=await position(client,account,subject);await client.query('COMMIT');await syncRewardsAfterPayment();await syncDepositAfterSettlement(subject.appointmentId);
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
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('shiloh-prior-payments'))");
      const duplicate = await client.query(`SELECT id FROM payment_provider_events WHERE provider='ozow' AND provider_event_key=$1`, [eventKey]);
      if (duplicate.rows[0]) { await client.query('COMMIT'); return { status:'duplicate' }; }
      const request = (await client.query(
        `SELECT pr.*,
                COALESCE(pr.deposit_member_appointment_id,bpa.appointment_id,(
                  SELECT agm.appointment_id
                    FROM appointment_group_members agm
                   WHERE agm.group_id=bpa.appointment_group_id
                   ORDER BY agm.guest_position,agm.appointment_id
                   LIMIT 1
                )) AS appointment_id,
                to_jsonb(payment_appointment)->>'financial_classification' AS financial_classification,
                CASE WHEN EXISTS (
                  SELECT 1 FROM appointment_group_members gm JOIN appointment_groups g ON g.id=gm.group_id
                  JOIN appointments member ON member.id=gm.appointment_id
                  WHERE g.id=bpa.appointment_group_id AND g.source='shiloh_my_shiloh_multi'
                    AND member.status='cancelled'
                ) THEN 'cancelled' ELSE payment_appointment.status END AS appointment_status
           FROM payment_requests pr
           LEFT JOIN booking_payment_accounts bpa ON bpa.id=pr.payment_account_id
           LEFT JOIN appointments payment_appointment
             ON payment_appointment.id=COALESCE(pr.deposit_member_appointment_id,bpa.appointment_id,(
               SELECT agm2.appointment_id
                 FROM appointment_group_members agm2
                WHERE agm2.group_id=bpa.appointment_group_id
                ORDER BY agm2.guest_position,agm2.appointment_id
                LIMIT 1
             ))
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
      const paidAfterBookingCancellation = paid
        && String(request.appointment_status || '').toLowerCase() === 'cancelled'
        && !request.gift_voucher_order_id;
      const paidAfterPriorSettlement = paid && request.prior_payment_closed_by_entry_id && !request.gift_voucher_order_id;
      const currentFinancial = paid && !paidAfterBookingCancellation && !paidAfterPriorSettlement && request.appointment_id ? (await client.query("SELECT to_jsonb(a)->>'financial_classification' AS financial_classification FROM appointments a WHERE id=$1",[request.appointment_id])).rows[0] : null;
      const paidAfterNoCharge = paid && currentFinancial?.financial_classification === 'no_charge' && !request.gift_voucher_order_id;
      const waivedRequirement = paid && request.purpose === 'deposit' && request.deposit_requirement_id && !request.gift_voucher_order_id
        ? (await client.query("SELECT id FROM booking_deposit_requirements WHERE id=$1 AND payment_account_id=$2 AND state='waived'", [request.deposit_requirement_id, request.payment_account_id])).rows[0] : null;
      const paidAfterDepositWaived = Boolean(waivedRequirement);
      if (paid && request.state !== 'paid') {
        if (!paidAfterBookingCancellation && !paidAfterPriorSettlement && !paidAfterNoCharge && !paidAfterDepositWaived) {
          transitionPaymentState(request.state, STATES.PAID, { evidence:EVIDENCE.VERIFIED_PROVIDER });
        }
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
                  - COALESCE(SUM(ple.amount) FILTER (WHERE ple.entry_type='refund'),0) + ${priorPaymentIncomingSql('bpa.id')} - ${priorPaymentOutgoingSql('bpa.id')} AS net_paid
             FROM booking_payment_accounts bpa
             LEFT JOIN payment_ledger_entries ple ON ple.payment_account_id=bpa.id
            WHERE bpa.id=$1
            GROUP BY bpa.id`,
          [request.payment_account_id],
          )).rows[0];
          paymentReceived = {
            request, noCharge: Boolean(paidAfterNoCharge), depositWaived: paidAfterDepositWaived,
            remaining: Math.max(0, Number(balance?.canonical_amount_due || 0) - Number(balance?.net_paid || 0)),
            reviewRequired: Boolean(paidAfterBookingCancellation || paidAfterPriorSettlement || paidAfterNoCharge || paidAfterDepositWaived),
          };
          if (paidAfterBookingCancellation) {
            await client.query(
              `INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
               VALUES('payment.received_after_booking_cancelled','booking_payment_account',$1,$2::jsonb)`,
              [request.payment_account_id, JSON.stringify({
                appointmentId: Number(request.appointment_id),
                paymentRequestId: Number(request.id),
                amount: Number(request.amount).toFixed(2),
                provider: 'ozow',
                providerEventKey: eventKey,
                reviewRequired: true,
                bookingRemainsCancelled: true,
                automaticRefundIssued: false,
              })],
            );
          }
        }
          if (paidAfterDepositWaived) await client.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata) VALUES('payment.received_after_deposit_waived','booking_payment_account',$1,$2::jsonb)`, [request.payment_account_id,JSON.stringify({appointmentId:Number(request.appointment_id),paymentRequestId:Number(request.id),requirementId:Number(request.deposit_requirement_id),depositWaived:true,amount:Number(request.amount).toFixed(2),providerEventKey:eventKey,reviewRequired:true,automaticRefundIssued:false})]);
          if (paidAfterNoCharge) await client.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata) VALUES('payment.received_after_no_charge','booking_payment_account',$1,$2::jsonb)`,[request.payment_account_id,JSON.stringify({appointmentId:Number(request.appointment_id),paymentRequestId:Number(request.id),noCharge:true,amount:Number(request.amount).toFixed(2),providerEventKey:eventKey,reviewRequired:true,automaticRefundIssued:false})]);
          if (paidAfterPriorSettlement) await client.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
            VALUES('payment.received_after_prior_settlement','booking_payment_account',$1,$2::jsonb)`,[request.payment_account_id,JSON.stringify({appointmentId:Number(request.appointment_id),paymentRequestId:Number(request.id),priorPaymentEntryId:Number(request.prior_payment_closed_by_entry_id),amount:Number(request.amount).toFixed(2),providerEventKey:eventKey,reviewRequired:true,automaticRefundIssued:false})]);
      } else if (!paid && notVerifiedOutcome && ['link_issued', 'pending'].includes(String(request.state))) {
        const nextState = cancelled ? STATES.CANCELLED : STATES.FAILED;
        transitionPaymentState(request.state, nextState);
        await client.query(`UPDATE payment_requests SET state=$2,updated_at=NOW() WHERE id=$1`, [request.id, nextState]);
        if (request.gift_voucher_order_id) await client.query(`UPDATE gift_voucher_orders SET state=$2,updated_at=NOW() WHERE id=$1`, [request.gift_voucher_order_id, nextState]);
      }
      await client.query(`INSERT INTO payment_provider_events(provider,provider_event_key,payment_request_id,signature_verified,payload_sha256,outcome) VALUES('ozow',$1,$2,TRUE,$3,'accepted')`, [eventKey,request.id,hash]);
      await client.query('COMMIT');
      if (!paymentReceived?.reviewRequired) await syncRewardsAfterPayment();
      if (paymentReceived?.request?.appointment_id && !paymentReceived.reviewRequired) {
        await syncDepositAfterSettlement(paymentReceived.request.appointment_id);
      }
      if (paymentReceived?.reviewRequired) {
        logger.error({
          appointmentId: Number(paymentReceived.request.appointment_id),
          paymentRequestId: Number(paymentReceived.request.id),
          amount: Number(paymentReceived.request.amount).toFixed(2),
        }, 'Payment received after collection closed; manual payment/refund review required');
      }
      let receiptSentViaApp = false;
      if (paymentReceived && !paymentReceived.reviewRequired) {
        const receipt = paymentReceived.request;
        const appOnlyEnabled = env.SHILOH_PAYMENT_RECEIPT_APP_ONLY_ENABLED === 'true' && Boolean(pushNotify)
          && Number(receipt.payer_crm_v2_client_id) > 0 && Boolean(normalizePaymentMobile(receipt.payer_mobile));
        let eligible = false;
        if (appOnlyEnabled) {
          // The payment payer can differ from the booked client. Only route a
          // receipt to an active profile with this exact verified payer mobile.
          const identity = await db.query(`SELECT 1 FROM crm_v2_clients
            WHERE id=$1 AND normalized_mobile=$2 AND status='active'`,
          [receipt.payer_crm_v2_client_id, normalizePaymentMobile(receipt.payer_mobile)]);
          eligible = identity.rowCount === 1;
        }
        if (eligible) {
          const claim = await db.query(`UPDATE payment_requests SET receipt_notice_state='sending',updated_at=NOW()
            WHERE id=$1 AND state='paid' AND receipt_notice_state='pending'
              AND receipt_notice_sent_at IS NULL RETURNING id`, [receipt.id]);
          if (claim.rowCount) {
            let appDelivery;
            try {
              appDelivery = await pushNotify({
                crmV2ClientId: Number(receipt.payer_crm_v2_client_id),
                eventKey: `payment-provider:${receipt.id}:paid`,
                category: 'payment',
                title: 'Payment received',
                body: 'Your Shiloh payment was received successfully.',
                targetPath: '/my-shiloh/#bookings',
              });
            } catch (error) {
              logger.warn({ err: error, paymentRequestId: receipt.id }, 'Payment receipt app wake failed');
            }
            if (appDelivery?.queued === true && Number(appDelivery.accepted) > 0) {
              const recorded = await db.query(`UPDATE payment_requests
                SET receipt_notice_state='sent',receipt_notice_channel='my_shiloh',receipt_notice_sent_at=NOW(),updated_at=NOW()
                WHERE id=$1 AND receipt_notice_state='sending' RETURNING id`, [receipt.id]);
              if (!recorded.rowCount) throw new Error('Accepted payment receipt requires a durable delivery record');
              receiptSentViaApp = true;
            } else {
              await db.query(`UPDATE payment_requests SET receipt_notice_state='pending',updated_at=NOW()
                WHERE id=$1 AND receipt_notice_state='sending'`, [receipt.id]);
            }
          }
        }
      }
      if (!receiptSentViaApp && paymentReceived?.request?.payer_crm_v2_client_id && pushNotify) {
        await pushNotify({
          crmV2ClientId: Number(paymentReceived.request.payer_crm_v2_client_id),
          eventKey: `payment-provider:${paymentReceived.request.id}:paid`,
          category: 'payment',
          title: paymentReceived.reviewRequired ? 'Payment needs review' : 'Payment received',
          body: paymentReceived.reviewRequired
            ? paymentReceived.depositWaived ? 'A payment reached Shiloh on an earlier deposit link after the deposit was waived. Shiloh will review the actual payment. No automatic refund has been issued.' : paymentReceived.noCharge ? 'A payment reached Shiloh after this treatment was marked no charge. Shiloh will review the payment. No automatic refund has been issued.' : paymentReceived.request.prior_payment_closed_by_entry_id
              ? 'A payment reached Shiloh after prior payment was recorded. Shiloh will review the payment. No automatic refund has been issued.'
              : 'A payment reached Shiloh after this booking was cancelled. The booking stays cancelled and Shiloh will review the payment. No automatic refund has been issued.'
            : 'Your Shiloh payment was received successfully.',
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
      return { status: paymentReceived?.reviewRequired ? 'paid_review_required' : paid ? 'paid' : 'accepted' };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  async function recordDepositWaiver(input) {
    const result=await waiver.record(input);
    // Existing confirmation dispatcher owns approvals, private recipients and deduplication.
    const position=await deposits.getPosition({appointmentId:result.appointmentIds[0]});
    if(position?.requirement?.state==='waived' && position.scope?.members) await releaseConfirmedBookingAfterDeposit({...position,requirement:{...position.requirement,transitioned:true}});
    return result;
  }
  const waiver = createBookingDepositWaiverActions({db, ErrorType:BookingPaymentError,positiveId,requestKey,resolveOperator,loadSubject});
  const noCharge = createBookingNoChargeActions({db, ErrorType:BookingPaymentError,positiveId,requestKey,resolveOperator,loadSubject,assertTarget,accountFor,position,syncDepositAfterSettlement});
  const prior = createBookingPriorPaymentActions({ db,money,requestKey,positiveId,ErrorType:BookingPaymentError,resolveOperator,loadSubject,assertTarget,accountFor,position,syncDepositAfterSettlement,now });
  const getReview = ({ adminId, appointmentId } = {}) => get({ adminId, appointmentId }, { allowPriceReview: true });
  return { get, getReview, getSummary, recordManual, recordRefund, createOzowRequest, ensureDepositRequest, retryDepositRequest, handleOzowNotification,recordDepositWaiver,recordNoCharge:noCharge.record,recordPrior:prior.recordPrior,reversePrior:prior.reversePrior };
}

module.exports = { CAPABILITIES, BookingPaymentError, money, createBookingPaymentService };
