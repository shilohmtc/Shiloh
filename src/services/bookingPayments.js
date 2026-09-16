const crypto = require('crypto');
const { pool } = require('../db/pool');
const { resolveCalendarAuthority, hasCapability, allowsAppointmentTarget } = require('./calendarAuthorization');
const { createOzowPaymentProvider } = require('./ozowPaymentProvider');
const { STATES, EVIDENCE, transitionPaymentState } = require('../domain/paymentState');

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

function createBookingPaymentService({ db = pool, ozow = createOzowPaymentProvider() } = {}) {
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
       SELECT a.id AS appointment_id,a.status AS appointment_status,a.total_price AS appointment_total,
              a.currency,a.updated_at AS appointment_revision,
              COALESCE(c.display_name,v2.name) AS client_name,
              COALESCE((SELECT cc.normalized_value
                          FROM client_contacts cc
                         WHERE cc.client_id=c.id
                           AND cc.contact_type IN ('whatsapp','mobile')
                         ORDER BY cc.is_primary DESC,cc.id
                         LIMIT 1),v2.normalized_mobile) AS client_mobile,
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
      amountDue: money(amount), currency: String(row.currency || 'ZAR'),
      pricingRevision: new Date(row.group_id ? row.group_revision : row.appointment_revision).toISOString(),
      clientName: String(row.client_name || ''), clientMobile: String(row.client_mobile || ''),
      staffIds: row.staff_ids.map(Number), serviceIds: row.service_ids.map(Number),
      final: ['cancelled'].includes(String(row.group_id ? row.group_status : row.appointment_status)),
    };
  }

  function assertTarget(operator, subject) {
    if (!allowsAppointmentTarget(operator.calendarAuthority, subject)) {
      throw new BookingPaymentError('PAYMENT_FORBIDDEN', 'This booking is outside the current Calendar and service scope.', 403);
    }
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

  async function position(queryable, account, subject) {
    if (!account) return { amountDue: subject.amountDue, paid: '0.00', refunded: '0.00', netPaid: '0.00', outstanding: subject.amountDue, state: 'unpaid', requests: [], entries: [] };
    const [totals, requests, entries] = await Promise.all([
      queryable.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='payment'),0) paid,COALESCE(SUM(amount) FILTER (WHERE entry_type='refund'),0) refunded FROM payment_ledger_entries WHERE payment_account_id=$1`, [account.id]),
      queryable.query(`SELECT id,request_key,provider,provider_request_id,provider_payment_url,amount,state,payer_name,payer_mobile,expires_at,created_at FROM payment_requests WHERE payment_account_id=$1 ORDER BY id DESC`, [account.id]),
      queryable.query(`SELECT id,entry_type,amount,method,evidence_kind,external_reference,notes,created_at FROM payment_ledger_entries WHERE payment_account_id=$1 ORDER BY id DESC`, [account.id]),
    ]);
    const paid = Number(totals.rows[0].paid), refunded = Number(totals.rows[0].refunded), net = paid - refunded;
    const due = Number(account.canonical_amount_due), outstanding = Math.max(0, due - net);
    return {
      amountDue: due.toFixed(2), paid: paid.toFixed(2), refunded: refunded.toFixed(2), netPaid: net.toFixed(2), outstanding: outstanding.toFixed(2),
      state: net > due ? 'overpaid' : outstanding === 0 ? (refunded > 0 ? 'partially_refunded' : 'paid') : net > 0 ? 'partially_paid' : 'unpaid',
      requests: requests.rows, entries: entries.rows,
    };
  }

  async function get({ adminId, appointmentId } = {}) {
    const operator = await resolveOperator(db, adminId, CAPABILITIES.VIEW);
    const subject = await loadSubject(db, appointmentId); assertTarget(operator, subject);
    const account = await accountFor(db, subject);
    return { subject, payment: await position(db, account, subject), authority: {
      canCollect: hasCapability(operator.calendarAuthority, CAPABILITIES.COLLECT),
      canRefund: hasCapability(operator.calendarAuthority, CAPABILITIES.REFUND),
      ozowConfigured: ozow.configured(),
    } };
  }

  async function recordManual({ adminId, appointmentId, amount, method, reference, notes, operationId } = {}) {
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
        await client.query(`INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,method,evidence_kind,operation_key,external_reference,actor_admin_id,notes) VALUES($1,'payment',$2,$3,$4,$5,$6,$7,$8)`,
          [account.id, normalizedAmount, normalizedMethod, EVIDENCE.AUTHORIZED_MANUAL, operationKey, String(reference || '').trim() || null, operator.id, String(notes || '').trim() || null]);
        await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'payment.manual_recorded','booking_payment_account',$2,$3::jsonb)`,
          [operator.id, account.id, JSON.stringify({ amount: normalizedAmount, method: normalizedMethod, reference: String(reference || '').trim() || null, operationId: key })]);
      }
      const result = await position(client, account, subject); await client.query('COMMIT'); return { status: replay.rows[0] ? 'idempotent_replay' : 'recorded', payment: result };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  async function createOzowRequest({ adminId, appointmentId, amount, payerName, payerMobile, operationId } = {}) {
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
      if (!row) row = (await client.query(`INSERT INTO payment_requests(payment_account_id,request_key,provider,amount,payer_name,payer_mobile,created_by_admin_id) VALUES($1,$2,'ozow',$3,$4,$5,$6) RETURNING *`, [account.id,key,normalizedAmount,String(payerName || subject.clientName).trim() || null,String(payerMobile || subject.clientMobile).trim() || null,operator.id])).rows[0];
      await client.query('COMMIT');
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
    if (row.provider_payment_url) return { status: 'idempotent_replay', request: row };
    const linked = await ozow.createPaymentLink({ requestKey:key, amount:normalizedAmount, bankReference:`SHILOH ${account.id}`, customerName:row.payer_name, customerMobile:row.payer_mobile });
    transitionPaymentState(STATES.CREATED, STATES.LINK_ISSUED);
    const updated = await db.query(`UPDATE payment_requests SET provider_request_id=$2,provider_payment_url=$3,state='link_issued',updated_at=NOW() WHERE id=$1 AND state='created' RETURNING *`, [row.id,linked.providerRequestId,linked.paymentUrl]);
    return { status: 'link_issued', request: updated.rows[0] };
  }

  async function recordRefund({ adminId, appointmentId, amount, method, reference, notes, operationId } = {}) {
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
        await client.query(`INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,method,evidence_kind,operation_key,external_reference,actor_admin_id,notes) VALUES($1,'refund',$2,$3,$4,$5,$6,$7,$8)`,[account.id,normalizedAmount,normalizedMethod,EVIDENCE.AUTHORIZED_MANUAL,operationKey,String(reference||'').trim()||null,operator.id,String(notes||'').trim()||null]);
        await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'payment.refund_recorded','booking_payment_account',$2,$3::jsonb)`,[operator.id,account.id,JSON.stringify({amount:normalizedAmount,method:normalizedMethod,operationId:key})]);
      }
      const result=await position(client,account,subject);await client.query('COMMIT');return{status:replay.rows[0]?'idempotent_replay':'refunded',payment:result};
    }catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}
  }

  async function handleOzowNotification(payload = {}) {
    const raw = JSON.stringify(payload); const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const eventKey = String(payload.TransactionId || payload.transactionId || payload.PaymentRequestId || payload.requestId || '').trim();
    const requestReference = String(payload.TransactionReference || payload.transactionReference || '').trim();
    if (!eventKey || !requestReference || !ozow.verifyNotification(payload)) throw new BookingPaymentError('PAYMENT_PROVIDER_NOTIFICATION_REJECTED', 'Provider notification could not be verified.', 400);
    const status = String(payload.Status || payload.status || '').trim().toLowerCase();
    const paid = ['complete','completed','paid','successful','success'].includes(status);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(`SELECT id FROM payment_provider_events WHERE provider='ozow' AND provider_event_key=$1`, [eventKey]);
      if (duplicate.rows[0]) { await client.query('COMMIT'); return { status:'duplicate' }; }
      const request = (await client.query(`SELECT * FROM payment_requests WHERE request_key=$1 FOR UPDATE`, [requestReference])).rows[0];
      if (!request) { await client.query(`INSERT INTO payment_provider_events(provider,provider_event_key,signature_verified,payload_sha256,outcome) VALUES('ozow',$1,TRUE,$2,'unmatched')`, [eventKey,hash]); await client.query('COMMIT'); return { status:'unmatched' }; }
      if (paid && request.state !== 'paid') {
        transitionPaymentState(request.state, STATES.PAID, { evidence:EVIDENCE.VERIFIED_PROVIDER });
        await client.query(`INSERT INTO payment_ledger_entries(payment_account_id,payment_request_id,entry_type,amount,method,evidence_kind,provider_transaction_id) VALUES($1,$2,'payment',$3,'ozow',$4,$5) ON CONFLICT DO NOTHING`, [request.payment_account_id,request.id,request.amount,EVIDENCE.VERIFIED_PROVIDER,eventKey]);
        await client.query(`UPDATE payment_requests SET state='paid',updated_at=NOW() WHERE id=$1`, [request.id]);
      }
      await client.query(`INSERT INTO payment_provider_events(provider,provider_event_key,payment_request_id,signature_verified,payload_sha256,outcome) VALUES('ozow',$1,$2,TRUE,$3,'accepted')`, [eventKey,request.id,hash]);
      await client.query('COMMIT'); return { status: paid ? 'paid' : 'accepted' };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  return { get, recordManual, recordRefund, createOzowRequest, handleOzowNotification };
}

module.exports = { CAPABILITIES, BookingPaymentError, money, createBookingPaymentService };
