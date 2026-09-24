const { pool } = require("../db/pool");
const { normalizePhone } = require("./clientIdentityOnboarding");
const { cancelOutstandingPaymentRequestsForAppointment } = require('./bookingPaymentSafety');

let initialized = false;

async function ensureTable() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_appointment_cancellation_intents (
      phone VARCHAR(32) PRIMARY KEY,
      appointment_id BIGINT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'collecting_reason',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  initialized = true;
}

function clean(value = "") { return String(value).trim().replace(/\s+/g, " "); }
function isConfirmation(value = "") { return /^(yes|y|confirm|confirmed|proceed|continue|ok|okay|confirm cancellation|cancel_confirm)$/i.test(clean(value)); }
function isAbort(value = "") { return /^(0|cancel|stop|abort|never mind|nevermind|forget it|cancel_back)$/i.test(clean(value)); }
function confirmationInteractive(row, reason) {
  return {
    type: 'button',
    body: `${appointmentSummary(row)}\n\nReason: ${reason}\n\nCancel this appointment?`,
    buttons: [
      { id: 'cancel_confirm', title: 'Confirm cancellation' },
      { id: 'cancel_back', title: '← Back' },
    ],
  };
}

async function getAdmin(sender) {
  const result = await pool.query(`SELECT id, display_name, permissions FROM staff_admin_accounts WHERE normalized_whatsapp=$1 AND active=TRUE`, [normalizePhone(sender)]);
  return result.rows[0] || null;
}
async function getAppointment(appointmentId) {
  const result = await pool.query(`SELECT a.id, a.starts_at, a.ends_at, a.status, COALESCE(c.display_name, a.source_client_name, 'Unknown client') AS client_name, COALESCE(string_agg(DISTINCT aps.service_name_snapshot, ', ') FILTER (WHERE aps.service_name_snapshot IS NOT NULL), '') AS services, COALESCE(string_agg(DISTINCT ast.staff_name_snapshot, ', ') FILTER (WHERE ast.staff_name_snapshot IS NOT NULL), '') AS staff FROM appointments a LEFT JOIN clients c ON c.id=a.client_id LEFT JOIN appointment_services aps ON aps.appointment_id=a.id LEFT JOIN appointment_staff ast ON ast.appointment_id=a.id WHERE a.id=$1 GROUP BY a.id,a.starts_at,a.ends_at,a.status,c.display_name,a.source_client_name`, [appointmentId]);
  return result.rows[0] || null;
}
async function getAppointmentStaff(appointmentId, db = pool) {
  const result = await db.query(`SELECT staff_id, staff_name_snapshot FROM appointment_staff WHERE appointment_id=$1 AND staff_id IS NOT NULL ORDER BY staff_id, position`, [appointmentId]);
  return result.rows.map((row) => ({ staffId: Number(row.staff_id), staffName: row.staff_name_snapshot }));
}
function canonicalRevision(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
async function cancelCanonicalAppointmentInTransaction(db, {
  appointmentId,
  actorAdminId,
  reason,
  expectedRevision = null,
  allowedStatuses = null,
  auditAction = 'admin.appointment_cancelled',
  auditMetadata = {},
}) {
  const current = await db.query(`SELECT a.id,a.starts_at,a.ends_at,a.status,a.updated_at FROM appointments a WHERE a.id=$1 FOR UPDATE`, [appointmentId]);
  const row = current.rows[0];
  if (!row) return { status: 'not_found' };
  if (row.status === 'cancelled') return { status: 'already_cancelled' };
  if (Array.isArray(allowedStatuses) && !allowedStatuses.includes(row.status)) return { status: 'conflict' };
  if (expectedRevision && canonicalRevision(row.updated_at) !== expectedRevision) return { status: 'conflict' };

  const assignedStaff = await getAppointmentStaff(appointmentId, db);
  for (const staff of assignedStaff) await db.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [staff.staffId]);
  const locked = await db.query(`SELECT status,updated_at FROM appointments WHERE id=$1 FOR UPDATE`, [appointmentId]);
  if (
    !locked.rows[0]
    || locked.rows[0].status === 'cancelled'
    || (Array.isArray(allowedStatuses) && !allowedStatuses.includes(locked.rows[0].status))
    || (expectedRevision && canonicalRevision(locked.rows[0].updated_at) !== expectedRevision)
  ) return { status: 'conflict' };

  const updated = await db.query(
    `UPDATE appointments SET status='cancelled',updated_at=NOW()
      WHERE id=$1 AND status=$2
    RETURNING id,starts_at,ends_at,status,updated_at`,
    [appointmentId, row.status]
  );
  if (!updated.rows[0]) return { status: 'conflict' };
  await db.query(`UPDATE appointment_lifecycle SET status='cancelled',updated_at=NOW() WHERE appointment_id=$1 AND status<>'cancelled'`, [appointmentId]);
  await db.query(
    `INSERT INTO appointment_status_history (appointment_id,from_status,to_status,changed_by,reason)
     VALUES ($1,$2,'cancelled',$3,$4)`,
    [appointmentId, row.status, `admin:${actorAdminId}`, clean(reason)]
  );
  const paymentSafety = await cancelOutstandingPaymentRequestsForAppointment(db, {
    appointmentId,
    actorAdminId,
    reason: 'appointment_cancelled',
  });
  await db.query(
    `INSERT INTO crm_audit_events (actor_admin_id,action,entity_type,entity_id,metadata)
     VALUES ($1,$2,'appointment',$3,$4::jsonb)`,
    [actorAdminId, auditAction, appointmentId, JSON.stringify({
      ...auditMetadata,
      reason: clean(reason),
      authoritativeAppointmentStateRechecked: true,
      lockedStaffIds: assignedStaff.map((staff) => staff.staffId),
      before: { status: row.status, revision: canonicalRevision(row.updated_at) },
      after: { status: 'cancelled', revision: canonicalRevision(updated.rows[0].updated_at) },
      paymentRequestsCancelled: paymentSafety.cancelled,
    })]
  );
  return { status: 'cancelled', appointment: updated.rows[0], assignedStaff, paymentSafety };
}
function formatDateTime(value) { return new Intl.DateTimeFormat("en-ZA", { timeZone:"Africa/Johannesburg", weekday:"short", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value)); }
function appointmentSummary(row) { return [`Appointment #${row.id}`, `• ${formatDateTime(row.starts_at)}–${new Intl.DateTimeFormat("en-ZA", { timeZone:"Africa/Johannesburg", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(row.ends_at))}`, `• Client: ${row.client_name}`, row.services ? `• Service: ${row.services}` : null, row.staff ? `• Staff: ${row.staff}` : null].filter(Boolean).join("\n"); }
async function getIntent(phone) { await ensureTable(); const result=await pool.query(`SELECT * FROM admin_appointment_cancellation_intents WHERE phone=$1`,[phone]); return result.rows[0]||null; }
async function hasPendingCancellationIntent(sender) { return Boolean(await getIntent(normalizePhone(sender))); }
async function clearIntent(phone) { await ensureTable(); await pool.query(`DELETE FROM admin_appointment_cancellation_intents WHERE phone=$1`,[phone]); }
async function saveIntent(phone, appointmentId, reason, status) { await ensureTable(); const result=await pool.query(`INSERT INTO admin_appointment_cancellation_intents (phone, appointment_id, reason, status, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (phone) DO UPDATE SET appointment_id=EXCLUDED.appointment_id,reason=EXCLUDED.reason,status=EXCLUDED.status,updated_at=NOW() RETURNING *`,[phone,appointmentId,reason||null,status]); return result.rows[0]; }

async function syncCancelledAppointmentToGoogleCalendar(appointmentId, staffNames = []) {
  void appointmentId;
  void staffNames;
  return { enabled:false,status:"historical_snapshot_untouched",practitionerResults:[] };
}

async function cancelAppointment({ sender, adminId, appointmentId, reason }) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const cancelled = await cancelCanonicalAppointmentInTransaction(client, {
      appointmentId,
      actorAdminId: adminId,
      reason,
      auditMetadata: { phone: normalizePhone(sender) },
    });
    if(cancelled.status!=="cancelled"){await client.query("ROLLBACK");return{status:cancelled.status};}
    await client.query("COMMIT");
    const calendarSync=await syncCancelledAppointmentToGoogleCalendar(appointmentId,cancelled.assignedStaff.map((staff)=>staff.staffName));
    return {status:"cancelled",appointment:cancelled.appointment,calendarSync};
  } catch(error){try{await client.query("ROLLBACK");}catch(_){} throw error;} finally{client.release();}
}

async function processAdminAppointmentCancellationMessage(sender,text) {
  const admin=await getAdmin(sender); if(!admin)return{handled:false};
  if(admin.permissions?.["appointment:view"]!==true)return{handled:true,reply:"Your admin account does not currently have permission to manage appointments."};
  const phone=normalizePhone(sender); const value=clean(text); let intent=await getIntent(phone);
  const direct=value.match(/^cancel\s+(?:appointment|booking)\s+#?(\d+)$/i);
  if(direct){const appointmentId=Number(direct[1]);const appointment=await getAppointment(appointmentId);if(!appointment)return{handled:true,reply:`Appointment #${appointmentId} was not found.`};if(appointment.status==="cancelled")return{handled:true,reply:`Appointment #${appointmentId} is already cancelled.`};await saveIntent(phone,appointmentId,null,"collecting_reason");return{handled:true,reply:`${appointmentSummary(appointment)}\n\nReason is required. Send a short reason for cancelling this appointment.\n\n0️⃣ Back`};}
  if(!intent)return{handled:false};
  if(isAbort(value)){await clearIntent(phone);return{handled:true,reply:"Cancellation stopped. The appointment has not been changed."};}
  const appointment=await getAppointment(intent.appointment_id);if(!appointment){await clearIntent(phone);return{handled:true,reply:`Appointment #${intent.appointment_id} was not found. The cancellation request was cleared.`};}if(appointment.status==="cancelled"){await clearIntent(phone);return{handled:true,reply:`Appointment #${appointment.id} is already cancelled.`};}
  if(intent.status==="collecting_reason"){if(!value)return{handled:true,reply:"Reason is required. Send a short reason for cancelling this appointment."};await saveIntent(phone,appointment.id,value,"awaiting_confirmation");return{handled:true,interactive:confirmationInteractive(appointment,value)};}
  if(intent.status==="awaiting_confirmation"){
    if(!isConfirmation(value))return{handled:true,interactive:confirmationInteractive(appointment,intent.reason)};
    const result=await cancelAppointment({sender,adminId:admin.id,appointmentId:appointment.id,reason:intent.reason});await clearIntent(phone);
    if(result.status==="cancelled")return{handled:true,cancelledAppointmentId:appointment.id,reply:`✅ Appointment #${appointment.id} cancelled.\nReason: ${intent.reason}`};
    if(result.status==="already_cancelled")return{handled:true,reply:`Appointment #${appointment.id} was already cancelled.`};if(result.status==="conflict")return{handled:true,reply:`Appointment #${appointment.id} changed before cancellation. No cancellation was written.`};return{handled:true,reply:`Appointment #${appointment.id} could not be found.`};
  }
  await clearIntent(phone);return{handled:false};
}
module.exports={processAdminAppointmentCancellationMessage,hasPendingCancellationIntent,ensureTable,confirmationInteractive,cancelAppointment,cancelCanonicalAppointmentInTransaction,syncCancelledAppointmentToGoogleCalendar,getAppointmentStaff};
