'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { createOzowPaymentProvider } = require('./ozowPaymentProvider');
const { resolveCalendarAuthority, hasCapability } = require('./calendarAuthorization');
const { PAYMENT_TEMPLATE_KEYS, formatRand, normalizeWhatsAppMobile, sendPaymentTemplate } = require('./paymentWhatsAppNotifications');
const { sendWhatsAppTemplate } = require('./whatsapp');

const CAPABILITIES = Object.freeze({ VIEW: 'voucher:view', REDEEM: 'voucher:redeem', MANAGE: 'voucher:manage' });

class GiftVoucherError extends Error {
  constructor(code, message, httpStatus = 400) { super(message); this.code = code; this.httpStatus = httpStatus; }
}

function cleanText(value, max, label, { optional = false } = {}) {
  const text = String(value || '').trim();
  if (!text && optional) return null;
  if (!text || text.length > max) throw new GiftVoucherError('VOUCHER_INVALID_DETAILS', `${label} is required and must be ${max} characters or fewer.`);
  return text;
}

function voucherAmount(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new GiftVoucherError('VOUCHER_INVALID_AMOUNT', 'Enter a valid Rand amount with at most two decimals.');
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 999999999999) throw new GiftVoucherError('VOUCHER_INVALID_AMOUNT', 'The voucher value is outside the supported range.');
  return (cents / 100).toFixed(2);
}

function requestKey(randomBytes = crypto.randomBytes) { return randomBytes(24).toString('base64url'); }
function voucherCode(key) { return `SV-${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12).toUpperCase()}`; }
function publicVoucherPath(key) { return `/gift-vouchers/${key}`; }

function createGiftVoucherService({ db = pool, ozow = createOzowPaymentProvider(), sendTemplate = sendWhatsAppTemplate, randomBytes = crypto.randomBytes } = {}) {
  async function policy(queryable = db) {
    const row = (await queryable.query(`SELECT validity_mode,validity_months FROM gift_voucher_settings WHERE singleton=TRUE`)).rows[0] || {};
    return {
      configured: ['no_expiry', 'fixed_months'].includes(String(row.validity_mode || '')),
      mode: row.validity_mode || null,
      months: row.validity_months == null ? null : Number(row.validity_months),
    };
  }

  async function purchaser(queryable, crmV2ClientId) {
    const id = Number(crmV2ClientId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new GiftVoucherError('VOUCHER_CLIENT_REQUIRED', 'Sign in to My Shiloh to purchase a voucher.', 401);
    const row = (await queryable.query(`SELECT id,name,normalized_mobile FROM crm_v2_clients WHERE id=$1 AND status='active'`, [id])).rows[0];
    if (!row) throw new GiftVoucherError('VOUCHER_CLIENT_REQUIRED', 'Your active Shiloh client profile is unavailable.', 404);
    return row;
  }

  async function getClientModel({ crmV2ClientId } = {}) {
    const [client, validity, orders] = await Promise.all([
      purchaser(db, crmV2ClientId),
      policy(db),
      db.query(
        `SELECT o.id,o.recipient_name,o.from_name,o.language,o.delivery_recipient,o.amount,o.state,o.created_at,
                pr.request_key,pr.provider_payment_url,pr.state AS payment_state,
                v.voucher_code,v.balance,v.state AS voucher_state,v.valid_until
           FROM gift_voucher_orders o
           LEFT JOIN payment_requests pr ON pr.gift_voucher_order_id=o.id
           LEFT JOIN gift_vouchers v ON v.order_id=o.id
          WHERE o.purchaser_crm_v2_client_id=$1
          ORDER BY o.id DESC LIMIT 30`,
        [Number(crmV2ClientId)],
      ),
    ]);
    return { client: { name: client.name }, policy: validity, ozowConfigured: ozow.configured(), orders: orders.rows.map((row) => ({ ...row, voucherPath: row.voucher_code ? publicVoucherPath(row.request_key) : null })) };
  }

  async function createOrder({ crmV2ClientId, recipientName, fromName, personalMessage, language, deliveryRecipient, deliveryMobile, amount } = {}) {
    const normalizedAmount = voucherAmount(amount);
    const recipient = cleanText(recipientName, 120, 'Recipient name');
    const sender = cleanText(fromName, 120, 'From name');
    const message = cleanText(personalMessage, 280, 'Message', { optional: true });
    const selectedLanguage = String(language || '').trim();
    if (!['en', 'af'].includes(selectedLanguage)) throw new GiftVoucherError('VOUCHER_INVALID_LANGUAGE', 'Choose English or Afrikaans.');
    const delivery = String(deliveryRecipient || '').trim();
    if (!['purchaser', 'recipient'].includes(delivery)) throw new GiftVoucherError('VOUCHER_INVALID_DELIVERY', 'Choose who should receive the secure voucher link.');
    const client = await db.connect(); let order; let payment;
    try {
      await client.query('BEGIN');
      const buyer = await purchaser(client, crmV2ClientId);
      const validity = await policy(client);
      if (!validity.configured) throw new GiftVoucherError('VOUCHER_POLICY_REQUIRED', 'Shiloh needs to choose the voucher validity policy before purchases can open.', 409);
      if (!ozow.configured()) throw new GiftVoucherError('VOUCHER_PAYMENT_UNAVAILABLE', 'Secure voucher payment is temporarily unavailable.', 503);
      const buyerMobile = normalizeWhatsAppMobile(buyer.normalized_mobile);
      const targetMobile = delivery === 'purchaser' ? buyerMobile : normalizeWhatsAppMobile(deliveryMobile);
      if (!targetMobile) throw new GiftVoucherError('VOUCHER_INVALID_MOBILE', 'Enter a valid South African WhatsApp number for delivery.');
      order = (await client.query(
        `INSERT INTO gift_voucher_orders
           (purchaser_crm_v2_client_id,recipient_name,from_name,personal_message,language,delivery_recipient,delivery_mobile,amount,validity_mode,validity_months)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [buyer.id, recipient, sender, message, selectedLanguage, delivery, targetMobile, normalizedAmount, validity.mode, validity.months],
      )).rows[0];
      const key = requestKey(randomBytes);
      payment = (await client.query(
        `INSERT INTO payment_requests(gift_voucher_order_id,request_key,provider,amount,payer_name,payer_mobile)
         VALUES($1,$2,'ozow',$3,$4,$5) RETURNING *`,
        [order.id, key, normalizedAmount, buyer.name, buyerMobile],
      )).rows[0];
      await client.query('COMMIT');
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }

    try {
      const linked = await ozow.createPaymentLink({ requestKey: payment.request_key, amount: normalizedAmount, bankReference: `VOUCHER ${order.id}`, customerName: payment.payer_name, customerMobile: payment.payer_mobile });
      payment = (await db.query(`UPDATE payment_requests SET provider_request_id=$2,provider_payment_url=$3,state='link_issued',updated_at=NOW() WHERE id=$1 AND state='created' RETURNING *`, [payment.id, linked.providerRequestId, linked.paymentUrl])).rows[0] || payment;
      await sendPaymentTemplate({ templateKey: PAYMENT_TEMPLATE_KEYS.VOUCHER_REQUEST, to: payment.payer_mobile, bodyParameters: [payment.payer_name || 'there', recipient, formatRand(normalizedAmount), formatRand(normalizedAmount)], urlButtonParameter: payment.request_key, send: sendTemplate });
      return { status: 'awaiting_payment', orderId: Number(order.id), paymentUrl: `/pay/${payment.request_key}` };
    } catch (error) {
      await db.query(`UPDATE gift_voucher_orders SET state='failed',updated_at=NOW() WHERE id=$1 AND state='awaiting_payment'`, [order.id]);
      throw error;
    }
  }

  async function getPublicVoucher({ requestKey: key } = {}) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(String(key || ''))) return null;
    const row = (await db.query(
      `SELECT o.recipient_name,o.from_name,o.personal_message,o.language,o.amount,
              v.voucher_code,v.balance,v.state,v.issued_at,v.valid_until
         FROM payment_requests pr
         JOIN gift_voucher_orders o ON o.id=pr.gift_voucher_order_id
         JOIN gift_vouchers v ON v.order_id=o.id
        WHERE pr.request_key=$1 AND pr.state='paid' LIMIT 1`, [key],
    )).rows[0];
    return row || null;
  }

  async function resolveOperator(queryable, adminId, capability) {
    const operator = await resolveCalendarAuthority(queryable, Number(adminId), { additionalCapabilities: Object.values(CAPABILITIES) });
    if (!operator || !hasCapability(operator.calendarAuthority, capability)) throw new GiftVoucherError('VOUCHER_FORBIDDEN', 'Current Shiloh authority does not permit this voucher operation.', 403);
    return operator;
  }

  async function getWorkspaceModel({ adminId } = {}) {
    const operator = await resolveOperator(db, adminId, CAPABILITIES.VIEW);
    const [validity, vouchers] = await Promise.all([
      policy(db),
      db.query(`SELECT v.id,v.voucher_code,v.original_value,v.balance,v.state,v.issued_at,v.valid_until,o.recipient_name,o.from_name,o.language FROM gift_vouchers v JOIN gift_voucher_orders o ON o.id=v.order_id ORDER BY v.id DESC LIMIT 100`),
    ]);
    return { policy: validity, vouchers: vouchers.rows, authority: { canRedeem: hasCapability(operator.calendarAuthority, CAPABILITIES.REDEEM), canManage: hasCapability(operator.calendarAuthority, CAPABILITIES.MANAGE) } };
  }

  async function resolveAccess(adminId) {
    try { return await resolveOperator(db, adminId, CAPABILITIES.VIEW); } catch (error) { if (error instanceof GiftVoucherError && error.httpStatus === 403) return null; throw error; }
  }

  async function updatePolicy({ adminId, mode, months } = {}) {
    const operator = await resolveOperator(db, adminId, CAPABILITIES.MANAGE);
    const selected = String(mode || '');
    if (!['no_expiry', 'fixed_months'].includes(selected)) throw new GiftVoucherError('VOUCHER_INVALID_POLICY', 'Choose no expiry or a fixed number of months.');
    const count = selected === 'fixed_months' ? Number(months) : null;
    if (selected === 'fixed_months' && (!Number.isSafeInteger(count) || count < 1 || count > 120)) throw new GiftVoucherError('VOUCHER_INVALID_POLICY', 'Choose between 1 and 120 months.');
    await db.query(`UPDATE gift_voucher_settings SET validity_mode=$1,validity_months=$2,updated_by_admin_id=$3,updated_at=NOW() WHERE singleton=TRUE`, [selected, count, operator.id]);
    return { configured: true, mode: selected, months: count };
  }

  async function redeem({ adminId, voucherCode: code, amount, operationId, notes } = {}) {
    const normalizedAmount = voucherAmount(amount);
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!/^SV-[A-F0-9]{12}$/.test(normalizedCode)) throw new GiftVoucherError('VOUCHER_INVALID_CODE', 'Enter a valid Shiloh voucher code.');
    const operation = cleanText(operationId, 100, 'Operation identifier');
    const client = await db.connect();
    try {
      await client.query('BEGIN'); const operator = await resolveOperator(client, adminId, CAPABILITIES.REDEEM);
      const voucher = (await client.query(`SELECT * FROM gift_vouchers WHERE voucher_code=$1 FOR UPDATE`, [normalizedCode])).rows[0];
      if (!voucher) throw new GiftVoucherError('VOUCHER_NOT_FOUND', 'Voucher not found.', 404);
      const replay = (await client.query(`SELECT id FROM gift_voucher_ledger_entries WHERE operation_key=$1`, [`redeem:${operation}`])).rows[0];
      if (!replay) {
        if (voucher.state !== 'active') throw new GiftVoucherError('VOUCHER_NOT_ACTIVE', 'This voucher is not active.', 409);
        if (voucher.valid_until && new Date(`${voucher.valid_until}T23:59:59Z`).getTime() < Date.now()) throw new GiftVoucherError('VOUCHER_EXPIRED', 'This voucher has expired.', 409);
        if (Number(normalizedAmount) > Number(voucher.balance)) throw new GiftVoucherError('VOUCHER_EXCEEDS_BALANCE', 'The redemption is greater than the voucher balance.', 409);
        await client.query(`INSERT INTO gift_voucher_ledger_entries(voucher_id,entry_type,amount,operation_key,actor_admin_id,notes) VALUES($1,'redemption',$2,$3,$4,$5)`, [voucher.id, normalizedAmount, `redeem:${operation}`, operator.id, cleanText(notes, 240, 'Notes', { optional: true })]);
        await client.query(`UPDATE gift_vouchers SET balance=balance-$2,state=CASE WHEN balance-$2=0 THEN 'redeemed' ELSE 'active' END,updated_at=NOW() WHERE id=$1`, [voucher.id, normalizedAmount]);
      }
      const current = (await client.query(`SELECT voucher_code,balance,state FROM gift_vouchers WHERE id=$1`, [voucher.id])).rows[0];
      await client.query('COMMIT'); return { status: replay ? 'idempotent_replay' : 'redeemed', voucher: current };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  return { getClientModel, createOrder, getPublicVoucher, getWorkspaceModel, updatePolicy, redeem, resolveAccess };
}

async function issueVerifiedVoucher(client, request, providerTransactionId) {
  const order = (await client.query(`SELECT * FROM gift_voucher_orders WHERE id=$1 FOR UPDATE`, [request.gift_voucher_order_id])).rows[0];
  if (!order) throw new GiftVoucherError('VOUCHER_ORDER_NOT_FOUND', 'Voucher order not found.', 404);
  const code = voucherCode(request.request_key);
  const issued = (await client.query(
    `INSERT INTO gift_vouchers(order_id,voucher_code,original_value,balance,valid_until)
     VALUES($1,$2,$3,$3,CASE WHEN $4='fixed_months' THEN (CURRENT_DATE + make_interval(months => $5::integer))::date ELSE NULL END)
     ON CONFLICT(order_id) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING *`,
    [order.id, code, order.amount, order.validity_mode, order.validity_months],
  )).rows[0];
  await client.query(`INSERT INTO gift_voucher_ledger_entries(voucher_id,entry_type,amount,operation_key) VALUES($1,'issue',$2,$3) ON CONFLICT(operation_key) DO NOTHING`, [issued.id, order.amount, `issue:ozow:${providerTransactionId}`]);
  await client.query(`UPDATE gift_voucher_orders SET state='paid',updated_at=NOW() WHERE id=$1`, [order.id]);
  return { order, voucher: issued };
}

module.exports = { CAPABILITIES, GiftVoucherError, voucherAmount, voucherCode, publicVoucherPath, createGiftVoucherService, issueVerifiedVoucher };
