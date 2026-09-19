'use strict';

const { pool } = require('../db/pool');

const UPCOMING_APPOINTMENT_STATUSES = Object.freeze(['scheduled', 'confirmed']);
const CLIENT_FORM_ACTION_STATUSES = new Set(['not_sent', 'sent', 'opened']);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function decimal(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : null;
}

function paymentState({ amountDue, paid, refunded }) {
  if (amountDue == null) {
    return { state: 'unknown', amountDue: null, paid: null, refunded: null, netPaid: null, outstanding: null };
  }
  const due = Number(amountDue);
  const received = Number(paid || 0);
  const returned = Number(refunded || 0);
  const net = received - returned;
  const outstanding = Math.max(0, due - net);
  return {
    state: net > due
      ? 'overpaid'
      : outstanding === 0
        ? (returned > 0 ? 'partially_refunded' : 'paid')
        : net > 0
          ? 'partially_paid'
          : 'unpaid',
    amountDue: due.toFixed(2),
    paid: received.toFixed(2),
    refunded: returned.toFixed(2),
    netPaid: net.toFixed(2),
    outstanding: outstanding.toFixed(2),
  };
}

function appointmentFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    status: String(row.status || ''),
    totalPrice: decimal(row.total_price),
    currency: String(row.currency || 'ZAR'),
    services: Array.isArray(row.services)
      ? row.services.map(item => String(item?.name || '')).filter(Boolean)
      : [],
    practitioners: Array.isArray(row.practitioners)
      ? row.practitioners.map(item => String(item?.name || '')).filter(Boolean)
      : [],
  };
}

function createMyShilohClientContextService({
  db = pool,
  now = () => new Date(),
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh client context database is required');

  async function loadClient(crmV2ClientId) {
    const id = positiveId(crmV2ClientId);
    if (!id) return null;
    const result = await db.query(
      `/* myShilohClientContext:client */
       SELECT id,name
         FROM crm_v2_clients
        WHERE id=$1 AND status='active'
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? { id: Number(row.id), name: String(row.name || 'Client') } : null;
  }

  async function loadNextAppointment(crmV2ClientId) {
    const id = positiveId(crmV2ClientId);
    if (!id) return null;
    const result = await db.query(
      `/* myShilohClientContext:next-appointment */
       SELECT a.id,a.starts_at,a.ends_at,a.status,a.total_price,a.currency,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', aps.service_name_snapshot,
                  'position', aps.position
                ) ORDER BY aps.position,aps.id)
                  FROM appointment_services aps
                 WHERE aps.appointment_id=a.id
              ),'[]'::jsonb) AS services,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', ast.staff_name_snapshot,
                  'position', ast.position
                ) ORDER BY ast.position,ast.id)
                  FROM appointment_staff ast
                 WHERE ast.appointment_id=a.id
              ),'[]'::jsonb) AS practitioners
         FROM appointments a
        WHERE a.crm_v2_client_id=$1
          AND a.client_id IS NULL
          AND a.status = ANY($2::text[])
          AND a.ends_at>$3::timestamptz
        ORDER BY a.starts_at,a.id
        LIMIT 1`,
      [id, [...UPCOMING_APPOINTMENT_STATUSES], now()],
    );
    return appointmentFromRow(result.rows[0]);
  }

  async function loadUpcomingAppointments(crmV2ClientId, { limit = 5 } = {}) {
    const id = positiveId(crmV2ClientId);
    const boundedLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);
    if (!id) return [];
    const result = await db.query(
      `/* myShilohClientContext:upcoming-appointments */
       SELECT a.id,a.starts_at,a.ends_at,a.status,a.total_price,a.currency,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', aps.service_name_snapshot,
                  'position', aps.position
                ) ORDER BY aps.position,aps.id)
                  FROM appointment_services aps
                 WHERE aps.appointment_id=a.id
              ),'[]'::jsonb) AS services,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', ast.staff_name_snapshot,
                  'position', ast.position
                ) ORDER BY ast.position,ast.id)
                  FROM appointment_staff ast
                 WHERE ast.appointment_id=a.id
              ),'[]'::jsonb) AS practitioners
         FROM appointments a
        WHERE a.crm_v2_client_id=$1
          AND a.client_id IS NULL
          AND a.status = ANY($2::text[])
          AND a.ends_at>$3::timestamptz
        ORDER BY a.starts_at,a.id
        LIMIT $4`,
      [id, [...UPCOMING_APPOINTMENT_STATUSES], now(), boundedLimit],
    );
    return result.rows.map(appointmentFromRow);
  }

  async function loadForms(crmV2ClientId, appointmentId) {
    const clientId = positiveId(crmV2ClientId);
    const bookingId = positiveId(appointmentId);
    if (!clientId || !bookingId) return [];
    const result = await db.query(
      `/* myShilohClientContext:forms-status-only */
       SELECT a.id,a.status,t.template_key,t.title
         FROM consultation_form_assignments a
         JOIN consultation_form_template_versions tv ON tv.id=a.template_version_id
         JOIN consultation_form_templates t ON t.id=tv.template_id
        WHERE a.crm_v2_client_id=$1
          AND a.client_id IS NULL
          AND a.appointment_id=$2
        ORDER BY a.id`,
      [clientId, bookingId],
    );
    return result.rows.map(row => ({
      id: Number(row.id),
      status: String(row.status || ''),
      templateKey: String(row.template_key || ''),
      title: String(row.title || 'Consultation form'),
      actionRequired: CLIENT_FORM_ACTION_STATUSES.has(String(row.status || '')),
    }));
  }

  async function loadPayment(appointment) {
    if (!appointment?.id) return null;
    const accountResult = await db.query(
      `/* myShilohClientContext:payment-position */
       SELECT bpa.id,bpa.canonical_amount_due,bpa.currency,
              COALESCE(SUM(ple.amount) FILTER (WHERE ple.entry_type='payment'),0) AS paid,
              COALESCE(SUM(ple.amount) FILTER (WHERE ple.entry_type='refund'),0) AS refunded
         FROM booking_payment_accounts bpa
         LEFT JOIN appointment_group_members gm
           ON gm.group_id=bpa.appointment_group_id
         LEFT JOIN payment_ledger_entries ple
           ON ple.payment_account_id=bpa.id
        WHERE bpa.appointment_id=$1
           OR gm.appointment_id=$1
        GROUP BY bpa.id,bpa.canonical_amount_due,bpa.currency
        ORDER BY bpa.id DESC
        LIMIT 1`,
      [positiveId(appointment.id)],
    );
    const account = accountResult.rows[0];
    if (!account) {
      const amountDue = decimal(appointment.totalPrice);
      return {
        ...paymentState({ amountDue, paid: 0, refunded: 0 }),
        state: amountDue == null ? 'unknown' : 'not_recorded',
        activePaymentPath: null,
      };
    }

    const requestResult = await db.query(
      `/* myShilohClientContext:active-payment-request */
       SELECT request_key
         FROM payment_requests
        WHERE payment_account_id=$1
          AND provider_payment_url IS NOT NULL
          AND state IN ('link_issued','pending')
        ORDER BY id DESC
        LIMIT 1`,
      [Number(account.id)],
    );
    const requestKey = String(requestResult.rows[0]?.request_key || '');
    return {
      ...paymentState({
        amountDue: account.canonical_amount_due,
        paid: account.paid,
        refunded: account.refunded,
      }),
      currency: String(account.currency || 'ZAR'),
      activePaymentPath: /^[A-Za-z0-9_-]{8,100}$/.test(requestKey) ? `/pay/${requestKey}` : null,
    };
  }

  async function getContext({ crmV2ClientId } = {}) {
    const client = await loadClient(crmV2ClientId);
    if (!client) return null;
    const appointment = await loadNextAppointment(client.id);
    const [forms, payment] = appointment
      ? await Promise.all([
        loadForms(client.id, appointment.id),
        loadPayment(appointment),
      ])
      : [[], null];

    return {
      version: 'my_shiloh_client_context_v1',
      generatedAt: now().toISOString(),
      client,
      nextAppointment: appointment,
      forms,
      payment,
    };
  }

  return {
    loadClient,
    loadNextAppointment,
    loadUpcomingAppointments,
    loadForms,
    loadPayment,
    getContext,
  };
}

const service = createMyShilohClientContextService();

module.exports = {
  UPCOMING_APPOINTMENT_STATUSES,
  CLIENT_FORM_ACTION_STATUSES,
  positiveId,
  decimal,
  paymentState,
  appointmentFromRow,
  createMyShilohClientContextService,
  ...service,
};
