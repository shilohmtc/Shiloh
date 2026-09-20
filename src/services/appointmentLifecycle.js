const { pool } = require("../db/pool");
const { sendWhatsAppTemplate } = require("./whatsapp");
const { resolveClientFacingNameByPhone } = require("./clientFacingNameAuthority");
const { createPendingExperience } = require("./customerExperience");
const logger = require("../lib/logger");
const { assertTarget: assertControlledMessagingTestTarget } = require("./controlledMessagingTestLane");

const REMINDER_HOURS = Number(process.env.APPOINTMENT_REMINDER_HOURS || 24);
const FOLLOWUP_HOURS = Number(process.env.APPOINTMENT_FOLLOWUP_HOURS || 4);
const SCAN_MINUTES = Number(process.env.APPOINTMENT_SCAN_MINUTES || 5);
const LANGUAGE_CODE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en";

let initialized = false;
let timer = null;
let running = false;

async function ensureTable() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_lifecycle (
      id BIGSERIAL PRIMARY KEY,
      appointment_id BIGINT,
      client_id BIGINT,
      crm_v2_client_id BIGINT,
      client_name_snapshot TEXT,
      phone VARCHAR(32) NOT NULL,
      service_text TEXT NOT NULL,
      appointment_at TIMESTAMPTZ NOT NULL,
      appointment_ends_at TIMESTAMPTZ,
      therapist_text TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed',
      source TEXT NOT NULL DEFAULT 'admin',
      reminder_sent_at TIMESTAMPTZ,
      followup_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE appointment_lifecycle ADD COLUMN IF NOT EXISTS appointment_id BIGINT`);
  await pool.query(`ALTER TABLE appointment_lifecycle ADD COLUMN IF NOT EXISTS client_id BIGINT`);
  await pool.query(`ALTER TABLE appointment_lifecycle ADD COLUMN IF NOT EXISTS crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE RESTRICT`);
  await pool.query(`ALTER TABLE appointment_lifecycle ADD COLUMN IF NOT EXISTS client_name_snapshot TEXT`);
  await pool.query(`ALTER TABLE appointment_lifecycle ADD COLUMN IF NOT EXISTS appointment_ends_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE appointment_lifecycle ADD COLUMN IF NOT EXISTS followup_template_name TEXT`);
  await pool.query(`ALTER TABLE appointment_lifecycle ADD COLUMN IF NOT EXISTS followup_provider_message_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_appointment_lifecycle_due ON appointment_lifecycle (status, appointment_at)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_lifecycle_appointment_id ON appointment_lifecycle (appointment_id) WHERE appointment_id IS NOT NULL`);
  initialized = true;
}

function normalizePhone(phone) { return String(phone || "").replace(/[^0-9]/g, ""); }

function formatAppointmentDate(value) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

async function createAppointment({ appointmentId = null, clientId = null, crmV2ClientId = null, clientName = null, phone, service, appointmentAt, appointmentEndsAt = null, therapist, source = "admin" }) {
  await ensureTable();
  const cleanPhone = normalizePhone(phone);
  const when = new Date(appointmentAt);
  const ends = appointmentEndsAt ? new Date(appointmentEndsAt) : null;
  if (!cleanPhone || !service || Number.isNaN(when.getTime()) || (ends && Number.isNaN(ends.getTime()))) throw new Error("phone, service and a valid appointmentAt are required");

  if (appointmentId) {
    const result = await pool.query(
      `INSERT INTO appointment_lifecycle
         (appointment_id, client_id, crm_v2_client_id, client_name_snapshot,
          phone, service_text, appointment_at, appointment_ends_at, therapist_text, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (appointment_id) WHERE appointment_id IS NOT NULL DO UPDATE SET
         client_id=EXCLUDED.client_id, crm_v2_client_id=EXCLUDED.crm_v2_client_id,
         client_name_snapshot=EXCLUDED.client_name_snapshot,
         phone=EXCLUDED.phone, service_text=EXCLUDED.service_text,
         appointment_at=EXCLUDED.appointment_at, appointment_ends_at=EXCLUDED.appointment_ends_at,
         therapist_text=EXCLUDED.therapist_text, source=EXCLUDED.source, updated_at=NOW()
       RETURNING *`,
      [appointmentId, clientId, crmV2ClientId, clientName ? String(clientName).trim() : null, cleanPhone, String(service).trim(), when.toISOString(), ends?.toISOString() || null, therapist || null, source]
    );
    return result.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO appointment_lifecycle (phone, service_text, appointment_at, appointment_ends_at, therapist_text, source)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [cleanPhone, String(service).trim(), when.toISOString(), ends?.toISOString() || null, therapist || null, source]
  );
  return result.rows[0];
}

async function listAppointments(limit = 100) {
  await ensureTable();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await pool.query(`SELECT * FROM appointment_lifecycle ORDER BY appointment_at DESC LIMIT $1`, [safeLimit]);
  return result.rows;
}

async function updateAppointmentStatus(id, status) {
  await ensureTable();
  const allowed = new Set(["confirmed", "confirmed_by_client", "cancelled", "completed"]);
  if (!allowed.has(status)) throw new Error("Invalid appointment status");
  const result = await pool.query(`UPDATE appointment_lifecycle SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *`, [id, status]);
  return result.rows[0] || null;
}

async function claimDueReminder(db = pool) {
  if (db === pool) await ensureTable();
  const result = await db.query(
    `WITH due AS (
       SELECT al.id,
              COALESCE(ap.starts_at,al.appointment_at) AS effective_start,
              COALESCE(ap.ends_at,al.appointment_ends_at) AS effective_end
         FROM appointment_lifecycle al
         LEFT JOIN appointments ap ON ap.id=al.appointment_id
        WHERE al.status IN ('confirmed','confirmed_by_client')
          AND al.reminder_sent_at IS NULL
          AND (al.appointment_id IS NULL OR (ap.id IS NOT NULL AND ap.status IN ('scheduled','confirmed')))
          AND COALESCE(ap.starts_at,al.appointment_at)>NOW()
          AND COALESCE(ap.starts_at,al.appointment_at)<=NOW()+($1*INTERVAL '1 hour')
          AND NOT EXISTS (
            SELECT 1
              FROM appointment_change_intents aci
             WHERE aci.phone = al.phone
               AND aci.status = 'collecting'
               AND aci.action IN ('reschedule','cancel')
          )
        ORDER BY COALESCE(ap.starts_at,al.appointment_at) ASC
        FOR UPDATE OF al SKIP LOCKED
        LIMIT 1
     )
     UPDATE appointment_lifecycle lifecycle
        SET reminder_sent_at=NOW(),
            appointment_at=due.effective_start,
            appointment_ends_at=due.effective_end,
            updated_at=NOW()
       FROM due
      WHERE lifecycle.id=due.id
     RETURNING lifecycle.*`, [REMINDER_HOURS]
  );
  return result.rows[0] || null;
}

async function claimDueFollowup() {
  await ensureTable();
  const result = await pool.query(
    `UPDATE appointment_lifecycle a SET followup_sent_at=NOW(),updated_at=NOW()
     WHERE a.id=(SELECT id FROM appointment_lifecycle
       WHERE status='completed' AND followup_sent_at IS NULL
         AND COALESCE(appointment_ends_at,appointment_at)<=NOW()-($1*INTERVAL '1 hour')
       ORDER BY COALESCE(appointment_ends_at,appointment_at) ASC FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING a.*`, [FOLLOWUP_HOURS]
  );
  return result.rows[0] || null;
}

async function undoClaim(id,column){if(!["reminder_sent_at","followup_sent_at"].includes(column))return;await pool.query(`UPDATE appointment_lifecycle SET ${column}=NULL,updated_at=NOW() WHERE id=$1`,[id]);}

async function customerName(phone){
  const resolved = await resolveClientFacingNameByPhone(normalizePhone(phone));
  return resolved.name || "there";
}

async function deliverClaimedFollowup(appointment, followupTemplate, followupActionsTemplate, deps = {}) {
  const send = deps.send || sendWhatsAppTemplate;
  const updateEvidence = deps.updateEvidence || ((id, templateName, providerMessageId) => pool.query(`UPDATE appointment_lifecycle SET followup_template_name=$2,followup_provider_message_id=$3,updated_at=NOW() WHERE id=$1`, [id, templateName, providerMessageId]));
  const createExperience = deps.createExperience || createPendingExperience;
  const releaseClaim = deps.releaseClaim || ((id) => undoClaim(id, "followup_sent_at"));
  let providerAccepted = false;
  let providerMessageId = null;
  try {
    const name = deps.name || appointment.client_name_snapshot || await customerName(appointment.phone);
    const quickReplyPayloads = followupActionsTemplate ? ['1','2','3','4','5'] : [];
    const accepted = await send(appointment.phone, followupTemplate, [name, appointment.service_text], LANGUAGE_CODE, quickReplyPayloads);
    providerAccepted = true;
    providerMessageId = accepted?.messages?.[0]?.id || null;
    try { await updateEvidence(appointment.id, followupTemplate, providerMessageId); }
    catch (error) { logger.error({err:error,appointmentId:appointment.appointment_id||appointment.id,templateName:followupTemplate,providerMessageId}, "Follow-up accepted; delivery-evidence update failed without reopening claim"); }
    try { await createExperience({appointmentId:appointment.appointment_id||appointment.id,phone:appointment.phone,service:appointment.service_text}); }
    catch (error) { logger.error({err:error,appointmentId:appointment.appointment_id||appointment.id,templateName:followupTemplate,providerMessageId}, "Follow-up accepted; experience bookkeeping failed without reopening claim"); }
    return { sent: true, providerMessageId };
  } catch (error) {
    if (!providerAccepted) await releaseClaim(appointment.id);
    throw error;
  }
}

async function deliverClaimedReminder(appointment, reminderTemplate, reminderActionsTemplate, deps = {}) {
  const send = deps.send || sendWhatsAppTemplate;
  const resolveName = deps.resolveName || customerName;
  const assertE2eTarget = deps.assertE2eTarget || assertControlledMessagingTestTarget;
  const env = deps.env || process.env;
  const name = deps.name || appointment.client_name_snapshot || await resolveName(appointment.phone);
  const formatted = formatAppointmentDate(appointment.appointment_at);
  const parts = formatted.split(", ");
  const time = parts[parts.length - 1] || formatted;
  const date = parts.slice(0, -1).join(", ") || formatted;
  const quickReplyPayloads = reminderActionsTemplate ? ["client_reschedule_booking", "client_cancel_booking"] : [];
  if (deps.controlledE2e === true) {
    await assertE2eTarget({
      clientId: appointment.client_id,
      crmV2ClientId: appointment.crm_v2_client_id,
      phone: appointment.phone,
      env,
    });
  }
  return send(
    appointment.phone,
    reminderTemplate,
    [name, appointment.service_text, date, time],
    deps.languageCode || LANGUAGE_CODE,
    quickReplyPayloads
  );
}

async function processReminders() {
  const reminderActionsTemplate=process.env.WHATSAPP_REMINDER_ACTIONS_TEMPLATE;
  const reminderTemplate=reminderActionsTemplate||process.env.WHATSAPP_REMINDER_TEMPLATE;
  const followupActionsTemplate=process.env.WHATSAPP_FOLLOWUP_ACTIONS_TEMPLATE;
  const followupTemplate=followupActionsTemplate||process.env.WHATSAPP_FOLLOWUP_TEMPLATE;
  if(!reminderTemplate&&!followupTemplate)return;

  if(reminderTemplate){
    for(let i=0;i<20;i+=1){const appointment=await claimDueReminder();if(!appointment)break;try{await deliverClaimedReminder(appointment,reminderTemplate,reminderActionsTemplate);logger.info({appointmentId:appointment.appointment_id||appointment.id,actionTemplate:Boolean(reminderActionsTemplate)},"Customer appointment reminder sent");}catch(error){await undoClaim(appointment.id,"reminder_sent_at");logger.error({err:error,appointmentId:appointment.appointment_id||appointment.id},"Appointment reminder failed");break;}}
  }

  if(followupTemplate){
    for(let i=0;i<20;i+=1){const appointment=await claimDueFollowup();if(!appointment)break;try{const delivery=await deliverClaimedFollowup(appointment,followupTemplate,followupActionsTemplate);logger.info({appointmentId:appointment.appointment_id||appointment.id,actionTemplate:Boolean(followupActionsTemplate),templateName:followupTemplate,providerMessageId:delivery.providerMessageId},"Customer aftercare/follow-up sent");}catch(error){logger.error({err:error,appointmentId:appointment.appointment_id||appointment.id},"Appointment follow-up failed before provider acceptance");break;}}
  }
}

async function runScan(){if(running)return;running=true;try{await processReminders();}catch(error){logger.error({err:error},"Appointment lifecycle scan failed");}finally{running=false;}}
function startAppointmentLifecycleScheduler(){if(timer)return;logger.info({scanMinutes:SCAN_MINUTES,reminderHours:REMINDER_HOURS,followupHours:FOLLOWUP_HOURS,reminderTemplateConfigured:Boolean(process.env.WHATSAPP_REMINDER_TEMPLATE),reminderActionsTemplateConfigured:Boolean(process.env.WHATSAPP_REMINDER_ACTIONS_TEMPLATE),followupTemplateConfigured:Boolean(process.env.WHATSAPP_FOLLOWUP_TEMPLATE),followupActionsTemplateConfigured:Boolean(process.env.WHATSAPP_FOLLOWUP_ACTIONS_TEMPLATE)},"Appointment lifecycle scheduler started");setTimeout(runScan,5000).unref();timer=setInterval(runScan,Math.max(SCAN_MINUTES,1)*60*1000);timer.unref();}

module.exports={ensureTable,createAppointment,listAppointments,updateAppointmentStatus,claimDueReminder,deliverClaimedReminder,deliverClaimedFollowup,processReminders,startAppointmentLifecycleScheduler};
