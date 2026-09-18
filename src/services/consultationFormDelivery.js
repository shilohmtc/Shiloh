const { pool } = require('../db/pool');
const logger = require('../lib/logger');
const clientConsultationForms = require('./clientConsultationForms');
const { sendWhatsAppTemplate } = require('./whatsapp');
const { assertTemplateSendAllowed } = require('./metaTemplateContracts');
const {
  loadBookingConfirmationAuthority,
  initialDeliveryFailure,
} = require('./customerBookingConfirmation');
const { exactPhoneCandidates } = require('./clientVerifiedIdentity');
const { resolveClientFacingName } = require('./clientFacingNameAuthority');

const DELIVERY_FLAG = 'SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED';
const DELIVERY_NOT_BEFORE_FLAG = 'SHILOH_CONSULTATION_FORM_DELIVERY_NOT_BEFORE';
const INITIAL_TEMPLATE = 'shiloh_consultation_form_v1';
const INITIAL_CONTRACT = 'consultation_form';
const TEMPLATE_LANGUAGE = 'en';
const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const LOOKAHEAD_MS = 90 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
let scheduler = null;
let running = false;

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isConsultationFormDeliveryEnabled(env = process.env) {
  return String(env[DELIVERY_FLAG] || '').trim().toLowerCase() === 'true';
}

function parseDeliveryNotBefore(env = process.env) {
  const raw = String(env[DELIVERY_NOT_BEFORE_FLAG] || '').trim();
  if (!raw) return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new Error(`${DELIVERY_NOT_BEFORE_FLAG} must be a valid ISO-8601 timestamp`);
  }
  return value;
}

function formatAppointmentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function providerMessageId(response) {
  return response?.messages?.[0]?.id || null;
}

function identityModel(authority = {}) {
  if (authority.identity_model) return String(authority.identity_model);
  if (authority.crm_v2_client_id && !authority.client_id) return 'crm_v2';
  if (authority.client_id && !authority.crm_v2_client_id) return 'legacy';
  return 'invalid';
}

async function preflightTemplateSend(assertFn = assertTemplateSendAllowed) {
  if (assertFn === assertTemplateSendAllowed) {
    return assertTemplateSendAllowed(INITIAL_TEMPLATE, TEMPLATE_LANGUAGE);
  }
  return assertFn(INITIAL_TEMPLATE, TEMPLATE_LANGUAGE);
}

async function resolveDeliveryRecipient(authority, {
  db = pool,
  exactPhoneCandidatesFn = exactPhoneCandidates,
  resolveName = resolveClientFacingName,
  initialFailure = initialDeliveryFailure,
} = {}) {
  const failure = initialFailure(authority);
  if (failure) return { ok: false, reason: failure };
  const model = identityModel(authority);

  if (model === 'crm_v2') {
    const name = String(authority.client_name_snapshot || '').trim();
    const phone = String(authority.client_phone || '').trim();
    if (!name || !/^27[678][0-9]{8}$/.test(phone)) return { ok: false, reason: 'crm_v2_recipient_unavailable' };
    return {
      ok: true,
      identityModel: model,
      clientId: null,
      crmV2ClientId: positiveId(authority.crm_v2_client_id),
      clientName: name,
      phone,
    };
  }

  if (model !== 'legacy') return { ok: false, reason: 'client_identity_invalid' };
  const candidates = await exactPhoneCandidatesFn(authority.client_phone, db);
  const candidate = candidates[0];
  const contactIds = Array.isArray(candidate?.contact_ids) ? candidate.contact_ids : [];
  if (
    candidates.length !== 1
    || String(candidate?.id || '') !== String(authority.client_id || '')
    || !contactIds.some((id) => String(id) === String(authority.contact_id || ''))
  ) {
    return { ok: false, reason: 'client_contact_ambiguous' };
  }
  const name = await resolveName(authority.client_id, db);
  if (name?.status !== 'authoritative' || !String(name.name || '').trim()) {
    return { ok: false, reason: 'client_name_authority_not_found' };
  }
  return {
    ok: true,
    identityModel: model,
    clientId: positiveId(authority.client_id),
    crmV2ClientId: null,
    clientName: String(name.name).trim(),
    phone: String(authority.client_phone || '').trim(),
  };
}

function createConsultationFormDeliveryService({
  db = pool,
  env = process.env,
  formService = clientConsultationForms,
  sendTemplate = sendWhatsAppTemplate,
  assertSendAllowed = assertTemplateSendAllowed,
  loadAuthority = loadBookingConfirmationAuthority,
  exactPhoneCandidatesFn = exactPhoneCandidates,
  resolveName = resolveClientFacingName,
  initialFailure = initialDeliveryFailure,
  now = () => new Date(),
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Consultation form delivery database is required');

  async function discoverAssignments() {
    if (!formService.isClientConsultationFormsEnabled(env)) return { created: 0 };
    const current = now();
    const until = new Date(current.getTime() + LOOKAHEAD_MS);
    const result = await db.query(
      `/* consultationFormDelivery:discover */
       INSERT INTO consultation_form_assignments(
         appointment_id,template_version_id,client_id,crm_v2_client_id,status,created_at,updated_at
       )
       SELECT DISTINCT ap.id,m.template_version_id,ap.client_id,ap.crm_v2_client_id,'not_sent',$1::timestamptz,$1::timestamptz
         FROM appointments ap
         JOIN appointment_services aps ON aps.appointment_id=ap.id
         JOIN consultation_form_service_mappings m ON m.service_id=aps.service_id AND m.required=TRUE
         JOIN consultation_form_template_versions tv ON tv.id=m.template_version_id
         JOIN consultation_form_templates t ON t.id=tv.template_id AND t.status='active'
        WHERE ap.status IN ('scheduled','confirmed')
          AND ap.starts_at>$1::timestamptz AND ap.starts_at<=$2::timestamptz
          AND (
            (ap.client_id IS NOT NULL AND ap.crm_v2_client_id IS NULL)
            OR (ap.client_id IS NULL AND ap.crm_v2_client_id IS NOT NULL)
          )
       ON CONFLICT (appointment_id,template_version_id) DO NOTHING
       RETURNING id`,
      [current, until]
    );
    return { created: result.rowCount || 0 };
  }

  async function dueAssignmentIds({ deliveryNotBefore = parseDeliveryNotBefore(env) } = {}) {
    if (!deliveryNotBefore) return [];
    const current = now();
    const result = await db.query(
      `/* consultationFormDelivery:due */
       SELECT a.id
         FROM consultation_form_assignments a
         JOIN appointments ap ON ap.id=a.appointment_id
         JOIN consultation_form_template_versions tv ON tv.id=a.template_version_id
         JOIN consultation_form_templates t ON t.id=tv.template_id AND t.status='active'
        WHERE a.status='not_sent'
          AND ap.status IN ('scheduled','confirmed')
          AND ap.starts_at>$1
          AND a.created_at >= $2::timestamptz
          AND EXISTS (
            SELECT 1
              FROM appointment_services aps
              JOIN consultation_form_service_mappings m
                ON m.service_id=aps.service_id
               AND m.template_version_id=a.template_version_id
               AND m.required=TRUE
             WHERE aps.appointment_id=a.appointment_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM crm_audit_events e
             WHERE e.action='consultation_form.delivery_uncertain'
               AND e.entity_type='consultation_form_assignment'
               AND e.entity_id=a.id::text
          )
        ORDER BY ap.starts_at,a.id
        LIMIT ${BATCH_SIZE}`,
      [current, deliveryNotBefore]
    );
    return result.rows.map((row) => positiveId(row.id)).filter(Boolean);
  }

  async function loadAssignmentContext(assignmentId, { deliveryNotBefore = parseDeliveryNotBefore(env) } = {}) {
    if (!deliveryNotBefore) return null;
    const result = await db.query(
      `/* consultationFormDelivery:context */
       SELECT a.id AS assignment_id,a.appointment_id,a.template_version_id,a.status AS assignment_status,
              ap.starts_at,ap.status AS appointment_status,
              t.template_key,
              mapped.service_name
         FROM consultation_form_assignments a
         JOIN appointments ap ON ap.id=a.appointment_id
         JOIN consultation_form_template_versions tv ON tv.id=a.template_version_id
         JOIN consultation_form_templates t ON t.id=tv.template_id AND t.status='active'
         JOIN LATERAL (
           SELECT string_agg(x.service_name_snapshot,' + ' ORDER BY x.position,x.id) AS service_name
             FROM appointment_services x
             JOIN consultation_form_service_mappings m
               ON m.service_id=x.service_id
              AND m.template_version_id=a.template_version_id
              AND m.required=TRUE
            WHERE x.appointment_id=ap.id
         ) mapped ON TRUE
        WHERE a.id=$1
          AND a.status='not_sent'
          AND ap.status IN ('scheduled','confirmed')
          AND ap.starts_at>$2
          AND a.created_at >= $3::timestamptz
          AND mapped.service_name IS NOT NULL
        LIMIT 1`,
      [assignmentId, now(), deliveryNotBefore]
    );
    return result.rows[0] || null;
  }

  async function audit(action, assignmentId, metadata = {}) {
    await db.query(
      `INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
       VALUES($1,'consultation_form_assignment',$2,$3::jsonb)`,
      [action, String(assignmentId), JSON.stringify(metadata)]
    );
  }

  async function markUncertain(assignmentId, context, providerId = null) {
    try {
      await audit('consultation_form.delivery_uncertain', assignmentId, {
        appointmentId: positiveId(context?.appointment_id),
        templateVersionId: positiveId(context?.template_version_id),
        providerMessageId: providerId,
      });
    } catch (error) {
      logger.error({ err: error, assignmentId }, 'Consultation form uncertain-delivery audit failed');
    }
  }

  async function sendAssignment(assignmentId, { contractPreflighted = false } = {}) {
    const id = positiveId(assignmentId);
    if (!id) return { sent: false, reason: 'assignment_invalid' };
    if (!formService.isClientConsultationFormsEnabled(env)) return { sent: false, reason: 'client_forms_disabled' };
    if (!isConsultationFormDeliveryEnabled(env)) return { sent: false, reason: 'delivery_disabled' };
    let deliveryNotBefore;
    try { deliveryNotBefore = parseDeliveryNotBefore(env); } catch (_error) {
      return { sent: false, reason: 'delivery_not_before_invalid' };
    }
    if (!deliveryNotBefore) return { sent: false, reason: 'delivery_not_before_unconfigured' };
    formService.parseDataKey(env);
    if (!contractPreflighted) await preflightTemplateSend(assertSendAllowed);

    const context = await loadAssignmentContext(id, { deliveryNotBefore });
    if (!context) return { sent: false, reason: 'assignment_not_due' };
    const authority = await loadAuthority(context.appointment_id, db);
    const recipient = await resolveDeliveryRecipient(authority, {
      db,
      exactPhoneCandidatesFn,
      resolveName,
      initialFailure,
    });
    if (!recipient.ok) return { sent: false, reason: recipient.reason };

    const date = formatAppointmentDate(context.starts_at);
    const serviceName = String(context.service_name || '').trim();
    if (!date || !serviceName) return { sent: false, reason: 'appointment_context_incomplete' };

    const issued = await formService.issueAccessToken({ assignmentId: id });
    let providerAccepted = false;
    let acceptedProviderMessageId = null;
    try {
      const response = await sendTemplate(
        recipient.phone,
        INITIAL_TEMPLATE,
        [recipient.clientName, serviceName, date],
        TEMPLATE_LANGUAGE,
        [],
        [issued.token]
      );
      providerAccepted = true;
      acceptedProviderMessageId = providerMessageId(response);
      const sentAt = now();
      const marked = await db.query(
        `UPDATE consultation_form_assignments
            SET status='sent',sent_at=COALESCE(sent_at,$2),updated_at=$2
          WHERE id=$1 AND status='not_sent'`,
        [id, sentAt]
      );
      if (marked.rowCount !== 1) throw new Error('Consultation form provider accepted message but sent transition failed');
      await audit('consultation_form.sent', id, {
        appointmentId: positiveId(context.appointment_id),
        templateVersionId: positiveId(context.template_version_id),
        providerMessageId: acceptedProviderMessageId,
        identityModel: recipient.identityModel,
      });
      return {
        sent: true,
        assignmentId: id,
        appointmentId: positiveId(context.appointment_id),
        providerMessageId: acceptedProviderMessageId,
      };
    } catch (error) {
      if (providerAccepted || !error?.response) {
        await markUncertain(id, context, acceptedProviderMessageId);
      }
      throw error;
    }
  }

  async function runOnce() {
    if (!formService.isClientConsultationFormsEnabled(env)) {
      return { enabled: false, deliveryEnabled: false, created: 0, attempted: 0, sent: 0, reason: 'client_forms_disabled' };
    }
    let dataKeyReady = true;
    try { formService.parseDataKey(env); } catch (_error) { dataKeyReady = false; }
    if (!dataKeyReady) {
      return { enabled: true, deliveryEnabled: false, created: 0, attempted: 0, sent: 0, reason: 'data_key_unavailable' };
    }

    const discovered = await discoverAssignments();
    if (!isConsultationFormDeliveryEnabled(env)) {
      return { enabled: true, deliveryEnabled: false, created: discovered.created, attempted: 0, sent: 0, reason: 'delivery_disabled' };
    }
    let deliveryNotBefore;
    try { deliveryNotBefore = parseDeliveryNotBefore(env); } catch (_error) {
      return { enabled: true, deliveryEnabled: true, created: discovered.created, attempted: 0, sent: 0, reason: 'delivery_not_before_invalid' };
    }
    if (!deliveryNotBefore) {
      return { enabled: true, deliveryEnabled: true, created: discovered.created, attempted: 0, sent: 0, reason: 'delivery_not_before_unconfigured' };
    }

    try {
      await preflightTemplateSend(assertSendAllowed);
    } catch (_error) {
      return { enabled: true, deliveryEnabled: true, created: discovered.created, attempted: 0, sent: 0, reason: 'template_not_ready' };
    }

    const due = await dueAssignmentIds({ deliveryNotBefore });
    const results = [];
    for (const assignmentId of due) {
      try {
        results.push(await sendAssignment(assignmentId, { contractPreflighted: true }));
      } catch (error) {
        logger.error({ err: error, assignmentId }, 'Consultation form delivery attempt failed');
        results.push({ sent: false, assignmentId, reason: error?.response ? 'provider_rejected' : 'delivery_uncertain' });
      }
    }
    return {
      enabled: true,
      deliveryEnabled: true,
      created: discovered.created,
      attempted: results.length,
      sent: results.filter((item) => item.sent).length,
      results,
    };
  }

  return {
    discoverAssignments,
    dueAssignmentIds,
    loadAssignmentContext,
    sendAssignment,
    runOnce,
  };
}

const service = createConsultationFormDeliveryService();

function startConsultationFormDeliveryScheduler() {
  if (scheduler) return;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const result = await service.runOnce();
      if (result.created || result.attempted) {
        logger.info({
          created: result.created,
          attempted: result.attempted,
          sent: result.sent,
          reason: result.reason || null,
        }, 'Consultation form appointment delivery scan completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Consultation form appointment delivery scan failed');
    } finally {
      running = false;
    }
  };
  setImmediate(execute);
  scheduler = setInterval(execute, SCAN_INTERVAL_MS);
  scheduler.unref?.();
  logger.info({
    scanMinutes: SCAN_INTERVAL_MS / 60000,
    clientFormsEnabled: clientConsultationForms.isClientConsultationFormsEnabled(process.env),
    deliveryEnabled: isConsultationFormDeliveryEnabled(process.env),
    deliveryNotBeforeConfigured: Boolean(String(process.env[DELIVERY_NOT_BEFORE_FLAG] || '').trim()),
  }, 'Consultation form appointment delivery scheduler started');
}

module.exports = {
  DELIVERY_FLAG,
  DELIVERY_NOT_BEFORE_FLAG,
  INITIAL_TEMPLATE,
  INITIAL_CONTRACT,
  TEMPLATE_LANGUAGE,
  SCAN_INTERVAL_MS,
  LOOKAHEAD_MS,
  BATCH_SIZE,
  positiveId,
  isConsultationFormDeliveryEnabled,
  parseDeliveryNotBefore,
  formatAppointmentDate,
  providerMessageId,
  identityModel,
  preflightTemplateSend,
  resolveDeliveryRecipient,
  createConsultationFormDeliveryService,
  startConsultationFormDeliveryScheduler,
  ...service,
};
