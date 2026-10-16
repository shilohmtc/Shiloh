'use strict';

const crypto = require('crypto');
const { deferredDeposit, clientAttempt, unresolved, depositPreparationProvenance } = require('./paymentCollectionGuard');

const cents = value => Math.round(Number(value || 0) * 100);
const decimal = value => (value / 100).toFixed(2);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createClientPaymentChoice({ db, ozow, loadSubject, accountFor, position, PaymentError, now }) {
  const fail = (code, message, status = 409) => { throw new PaymentError(code, message, status); };

  async function session(queryable, input, lock) {
    const id = Number(input.crmV2ClientId);
    if (!Number.isSafeInteger(id) || id <= 0 || (!Number.isSafeInteger(Number(input.sessionId)) || Number(input.sessionId)<=0)) fail('PAYMENT_CLIENT_SESSION', 'Sign in to review your payment.', 401);
    const row = (await queryable.query(`SELECT c.id,c.name,c.normalized_mobile FROM client_browser_sessions s
      JOIN crm_v2_clients c ON c.id=s.crm_v2_client_id AND c.status='active'
      WHERE s.id=$1 AND s.crm_v2_client_id=$2 AND s.revoked_at IS NULL AND s.expires_at>$3::timestamptz ${lock ? 'FOR SHARE OF s,c' : ''}`,
    [input.sessionId, id, now()])).rows[0];
    if (!row) fail('PAYMENT_CLIENT_SESSION', 'Sign in to review your payment.', 401);
    return row;
  }

  async function snapshot(queryable, input, { lock = false, checkoutOwner = null } = {}) {
    const owner = checkoutOwner || await session(queryable, input, lock);
    if (!Number.isSafeInteger(Number(input.appointmentId)) || Number(input.appointmentId)<=0) fail('PAYMENT_CLIENT_BOOKING','This appointment is unavailable.',404);
    // Ownership is checked before the canonical subject loader can expose pricing.
    const owned = (await queryable.query(`SELECT id FROM appointments WHERE id=$1 AND crm_v2_client_id=$2 AND client_id IS NULL`,
      [input.appointmentId, owner.id])).rows[0];
    if (!owned) fail('PAYMENT_CLIENT_BOOKING', 'This appointment is unavailable.', 404);
    const subject = await loadSubject(queryable, owned.id, { lock });
    const members = (await queryable.query(`SELECT a.id,a.crm_v2_client_id,a.client_id,a.status,a.total_price,
      COALESCE(allocation.allocated_price,a.total_price) AS allocated_amount,
      COALESCE((SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.position) FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Shiloh treatment') AS service,
      a.updated_at::text AS revision,a.starts_at,a.currency,to_jsonb(a)->>'financial_classification' AS classification,
      aba.status AS approval_status,
      EXISTS(SELECT 1 FROM package_session_redemptions ps WHERE ps.appointment_id=a.id AND ps.status IN ('reserved','redeemed')) AS prepaid
      FROM appointments a LEFT JOIN appointment_booking_approvals aba ON aba.appointment_id=a.id
      LEFT JOIN appointment_group_members allocation ON allocation.appointment_id=a.id
      WHERE a.id=$1 OR ($2::bigint IS NOT NULL AND EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.appointment_id=a.id AND gm.group_id=$2))
      ORDER BY a.id ${lock ? 'FOR UPDATE OF a' : ''}`, [subject.appointmentId, subject.groupId])).rows;
    const ownScope = members.length > 0 && members.every(m => Number(m.crm_v2_client_id) === Number(owner.id) && m.client_id == null);
    const eligible = ownScope && members.every(m => ['scheduled','confirmed'].includes(m.status)
      && (!m.approval_status || m.approval_status === 'approved') && new Date(m.starts_at) > now()
      && m.total_price != null && cents(m.total_price) > 0 && !m.prepaid && (!m.classification || m.classification === 'standard') && m.currency === 'ZAR')
      && ['scheduled','confirmed'].includes(subject.status) && subject.currency === 'ZAR'
      && (!subject.groupId || members.reduce((sum,m)=>sum+cents(m.allocated_amount),0)===cents(subject.amountDue));
    // A foreign guest never receives the account total, member list or other payer facts.
    if (!ownScope) {
      // Preserve only an already authorised, explicitly payer-bound fixed link.
      // No group total, member list or new collection right crosses this boundary.
      const bound=(await queryable.query(`SELECT pr.request_key,pr.amount FROM payment_requests pr
        JOIN booking_payment_accounts bpa ON bpa.id=pr.payment_account_id
        WHERE bpa.appointment_group_id=$1 AND pr.payer_crm_v2_client_id=$2
          AND pr.state IN ('link_issued','pending') AND pr.provider='ozow'
          AND pr.provider_payment_url IS NOT NULL AND NOT(left(pr.request_key,4)='cpc_' AND pr.created_by_admin_id IS NULL)
          AND (pr.expires_at IS NULL OR pr.expires_at>$3::timestamptz)
        ORDER BY CASE WHEN pr.purpose='deposit' THEN 0 ELSE 1 END,pr.created_at DESC,pr.id DESC LIMIT 1`,[subject.groupId,owner.id,now()])).rows[0];
      return {owner,subject,public:{available:false,reason:'shared_scope',
        message:bound?'You can review your existing fixed payment below. Reception must confirm any different amount or shared booking charges.':'Reception must confirm which shared booking charges you may pay.',
        ...(bound?{scopeLabel:'Your existing fixed payment only',existingPayment:{amount:decimal(cents(bound.amount))},continuationPath:`/pay/${bound.request_key}`}:{})}};
    }
    const account = await accountFor(queryable, subject, { create:lock, allowPriceReview:!lock });
    if (account?.priceReview) return { owner, subject, account, public:{ available:false, reason:'price_review', message:'Reception needs to review this booking price before payment.' } };
    const payment = await position(queryable, account, subject);
    const requirement = account ? (await queryable.query('SELECT * FROM booking_deposit_requirements WHERE payment_account_id=$1', [account.id])).rows[0] : null;
    const requests = account ? (await queryable.query(`SELECT pr.*,${depositPreparationProvenance()} AS unissued_provenance FROM payment_requests pr WHERE pr.payment_account_id=$1 ORDER BY pr.id`, [account.id])).rows : [];
    const remaining = cents(payment.outstanding);
    const netMoney = Math.max(0, cents(payment.paid) - cents(payment.refunded) + cents(payment.priorPaid) - cents(payment.transferredOut));
    const deposit = requirement && !['waived','exempt'].includes(requirement.state) ? Math.max(0, cents(requirement.required_amount) - netMoney) : 0;
    const conflicts = requests.filter(unresolved);
    const continuation = conflicts.length === 1 && conflicts[0].provider_payment_url && ['link_issued','pending'].includes(conflicts[0].state)
      && Number(conflicts[0].payer_crm_v2_client_id) === Number(owner.id) && cents(conflicts[0].amount) <= remaining
      && (!conflicts[0].expires_at || new Date(conflicts[0].expires_at) > now()) ? conflicts[0] : null;
    const groupRevision = subject.groupId ? (await queryable.query('SELECT updated_at::text AS revision FROM appointment_groups WHERE id=$1', [subject.groupId])).rows[0]?.revision : null;
    const review = digest({ scope:subject.groupId?`group:${subject.groupId}`:`appointment:${subject.appointmentId}`, due:subject.amountDue, remaining, deposit, groupRevision,
      requirement:requirement ? [requirement.id, requirement.state, requirement.required_amount] : null,
      members:members.map(m => [m.id,m.crm_v2_client_id,m.status,m.revision,m.approval_status,m.total_price,m.allocated_amount]) });
    const receiptReview = account ? (await queryable.query(`SELECT 1 FROM crm_audit_events WHERE entity_type='booking_payment_account'
      AND entity_id=$1 AND action IN ('payment.received_after_collection_changed','payment.received_after_booking_cancelled',
      'payment.received_after_prior_settlement','payment.received_after_no_charge','payment.received_after_deposit_waived') LIMIT 1`, [account.id])).rows.length > 0 : false;
    const financialReview = receiptReview || deposit > remaining && remaining > 0;
    const choices = eligible && !financialReview && remaining > 0 && conflicts.length === 0 ? [
      ...(deposit > 0 && deposit < remaining ? [{ key:'deposit', amount:decimal(deposit), label:'Pay deposit' }] : []),
      { key:'full', amount:decimal(remaining), label:'Pay remaining amount in full' },
    ] : [];
    const model = { available:eligible && !financialReview && remaining > 0, reason:!eligible ? 'booking_unavailable' : financialReview ? 'financial_review' : remaining === 0 ? 'settled' : conflicts.length ? 'existing_attempt' : null,
      message:!eligible ? 'This booking cannot collect a new payment. Ask Reception if you need help.' : financialReview ? 'Reception needs to review the recorded treatment balance and deposit before payment.' : remaining === 0 ? 'No treatment payment remains.'
        : conflicts.length ? 'An earlier payment attempt must finish or be reviewed before the amount can change. Returning from Ozow does not cancel that attempt.'
          : 'Choose an amount to review. The deposit is part-payment, not an extra fee. Full payment does not change cancellation or refund rules.',
      scopeLabel:members.length > 1 ? `All ${members.length} appointments in this booking, all belonging to you` : 'This appointment only',
      appointments:members.map(m=>({service:String(m.service),amount:decimal(cents(m.allocated_amount)),when:new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(m.starts_at))})),
      amountDue:payment.amountDue, recordedMoney:decimal(netMoney), appliedCredits:decimal(cents(payment.rewardsApplied)+cents(payment.welcomeVoucherApplied)+cents(payment.treatmentCreditApplied)+cents(payment.giftVoucherApplied)),
      remaining:decimal(remaining), depositRequired:requirement ? String(requirement.required_amount) : null,
      depositRemaining:decimal(deposit), depositWaived:requirement?.state === 'waived', choices, review,
      continuationPath:eligible && continuation ? `/pay/${continuation.request_key}` : null };
    return { owner, subject, account, payment, requirement, requests, review, public:model };
  }

  async function get(input) {
    const client = await db.connect();
    try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const data = await snapshot(client,input); await client.query('COMMIT'); return data.public; }
    catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { client.release(); }
  }

  async function collect(input) {
    if (!['deposit','full'].includes(input.choice) || !/^[A-Za-z0-9_-]{16,100}$/.test(String(input.operationId || '')) || input.confirmed !== true) {
      fail('PAYMENT_CHOICE_REVIEW', 'Review and confirm a payment choice.', 400);
    }
    if (!ozow.configured()) fail('PAYMENT_OZOW_NOT_CONFIGURED', 'Secure payment is unavailable. Ask Reception for help.');
    const client = await db.connect(); let acquired = false, row;
    // Match the existing 36-character staff reference envelope; keep the full review digest above.
    const key = `cpc_${digest([input.crmV2ClientId,input.operationId]).slice(0,32)}`;
    try {
      acquired = (await client.query("SELECT pg_try_advisory_lock(hashtext('shiloh-prior-payments')) AS acquired")).rows[0]?.acquired === true;
      if (!acquired) fail('PAYMENT_CHOICE_BUSY', 'Another payment decision is in progress. Refresh before retrying.');
      await client.query('BEGIN');
      const data = await snapshot(client,input,{lock:true});
      const expectedPurpose = input.choice === 'deposit' ? 'deposit' : 'balance';
      const replay = data.requests?.find(r => r.request_key === key);
      if (replay) {
        if (Number(replay.payer_crm_v2_client_id) !== Number(data.owner.id) || replay.purpose !== expectedPurpose) fail('PAYMENT_CHOICE_RETRY_MISMATCH','This retry belongs to a different payment choice.');
        row = replay; const valid = input.review === data.review && await currentAttempt(client,data,row); await client.query('COMMIT');
        return result(row, valid);
      }
      if (!data.account || !data.public.available) fail('PAYMENT_CHOICE_UNAVAILABLE', data.public.message);
      // Same choice from another tab recovers the one server-owned attempt.
      const active = data.requests.filter(r => clientAttempt(r) && unresolved(r));
      if (active.length === 1 && active[0].purpose === expectedPurpose && Number(active[0].payer_crm_v2_client_id) === Number(data.owner.id)) {
        row = active[0]; const valid = input.review === data.review && await currentAttempt(client,data,row); await client.query('COMMIT'); return result(row, valid);
      }
      const choice = data.public.choices.find(c => c.key === input.choice);
      if (!choice || input.review !== data.review) fail('PAYMENT_CHOICE_CHANGED', 'The amount, booking or earlier payment changed. Review the latest payment options.');
      row = (await client.query(`INSERT INTO payment_requests(payment_account_id,request_key,provider,amount,state,purpose,
        payer_name,payer_mobile,payer_crm_v2_client_id,deposit_requirement_id)
        VALUES($1,$2,'ozow',$3,'pending',$4,$5,$6,$7,$8) RETURNING *`,
      [data.account.id,key,choice.amount,expectedPurpose,data.owner.name,data.owner.normalized_mobile,data.owner.id,
        input.choice === 'deposit' ? data.requirement?.id || null : null])).rows[0];
      await client.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
        VALUES('payment.client_attempt_started','booking_payment_account',$1,$2::jsonb)`,
      [data.account.id,JSON.stringify({paymentRequestId:row.id,crmV2ClientId:Number(data.owner.id),sessionId:Number(input.sessionId),choice:input.choice,amount:choice.amount,review:data.review,scope:'all_owned_members'})]);
      // This durable claim precedes the external call. Unknown outcomes never retry it.
      await client.query('COMMIT');
      let linked;
      try { linked = await ozow.createPaymentLink({requestKey:key,amount:row.amount,bankReference:`SHILOH ${data.account.id}`,customerName:row.payer_name,customerMobile:row.payer_mobile}); }
      catch (_) { return result(row); }
      let target;
      try { target = new URL(linked?.paymentUrl); } catch (_) { return result(row); }
      if (target.protocol !== 'https:' || !/(^|\.)ozow\.com$/i.test(target.hostname)) return result(row);
      const saved = await client.query(`UPDATE payment_requests SET provider_request_id=$2,provider_payment_url=$3,state='link_issued',updated_at=NOW()
        WHERE id=$1 AND state='pending' AND provider_payment_url IS NULL RETURNING *`, [row.id,linked.providerRequestId,target.toString()]);
      row = saved.rows[0] || row;
      // Manual money/credits can change while the provider call is in flight.
      await client.query('BEGIN');
      const refreshed = await snapshot(client,input,{lock:true});
      const valid = await currentAttempt(client,refreshed,row);
      await client.query('COMMIT');
      return result(row, valid);
    } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { try { if (acquired) await client.query("SELECT pg_advisory_unlock(hashtext('shiloh-prior-payments'))"); } finally { client.release(); } }
  }

  async function currentAttempt(queryable, data, row) {
    if (!data.public.available || Number(row.payer_crm_v2_client_id) !== Number(data.owner.id)
      || row.expires_at && new Date(row.expires_at) <= now()) return false;
    const amount = row.purpose === 'deposit' ? data.public.depositRemaining : row.purpose === 'balance' ? data.public.remaining : null;
    if (amount == null || cents(amount) !== cents(row.amount) || cents(amount) <= 0
      || data.requests.some(r => r.id !== row.id && unresolved(r))) return false;
    const audit = (await queryable.query(`SELECT metadata FROM crm_audit_events WHERE action='payment.client_attempt_started'
      AND entity_type='booking_payment_account' AND entity_id=$1 AND metadata->>'paymentRequestId'=$2 ORDER BY id LIMIT 1`,
    [data.account.id,String(row.id)])).rows[0];
    return audit?.metadata?.review === data.review;
  }

  async function validateRequest(queryable, row) {
    try {
    const owner = (await queryable.query("SELECT id,name,normalized_mobile FROM crm_v2_clients WHERE id=$1 AND status='active'", [row.payer_crm_v2_client_id])).rows[0];
    if (!owner) return false;
    const target = (await queryable.query(`SELECT COALESCE(bpa.appointment_id,(SELECT gm.appointment_id FROM appointment_group_members gm
      WHERE gm.group_id=bpa.appointment_group_id ORDER BY gm.guest_position,gm.appointment_id LIMIT 1)) AS id
      FROM booking_payment_accounts bpa WHERE id=$1`, [row.payment_account_id])).rows[0];
    if (!target?.id) return false;
    const data = await snapshot(queryable,{appointmentId:target.id},{checkoutOwner:owner});
    return await currentAttempt(queryable,data,row);
    } catch(error) { if(error instanceof PaymentError && error.httpStatus>=400 && error.httpStatus<500)return false; throw error; }
  }

  function result(row, current = false) {
    const ready = current && ['pending','link_issued'].includes(row.state) && Boolean(row.provider_payment_url);
    return { status:row.state === 'paid' ? 'paid' : ready ? 'ready' : 'needs_review', amount:String(row.amount),
      paymentPath:ready ? `/pay/${row.request_key}` : null,
      message:row.state === 'paid' ? 'Your payment is recorded.' : ready ? 'Your reviewed payment is ready. Continue through the secure payment page.'
        : 'The payment attempt has not been resolved. No new attempt was created. Ask Reception to review it before trying another amount.' };
  }
  return { get, collect, validateRequest };
}

module.exports = { createClientPaymentChoice };
