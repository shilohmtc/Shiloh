const { pool } = require('../db/pool');
const logger = require('../lib/logger');
const adminAvailability = require('../services/adminAvailability');
const {
  featureEnabled,
  isClientConfirmation,
  createPendingRescheduleRequest,
  supersedePendingRescheduleForAppointment,
} = require('../services/clientRescheduleApproval');
const {
  livePendingRescheduleConflicts,
  reconcileStalePendingRescheduleHolds,
} = require('../services/clientRescheduleHoldReconciliation');
const { ensureClientRescheduleApprovalSchema } = require('../services/clientRescheduleApprovalSchema');

const schemaReady = ensureClientRescheduleApprovalSchema();
schemaReady
  .then((state) => logger.info(state, 'Client reschedule approval schema verified'))
  .catch((error) => logger.error({ err: error }, 'Client reschedule approval schema initialization failed; feature remains unusable'));

const originalGetConflicts = adminAvailability.getConflicts;
adminAvailability.getConflicts = async function getConflictsWithRescheduleHolds(args = {}) {
  const conflicts = await originalGetConflicts(args);
  if (!featureEnabled()) return conflicts;
  await schemaReady;
  const holds = await livePendingRescheduleConflicts({
    db: args.db || pool,
    staffId: args.staffId,
    startsAt: args.startsAt,
    endsAt: args.endsAt,
    excludeRequestId: args.excludeRescheduleRequestId || null,
  });
  return [...conflicts, ...holds].sort((a, b) => {
    const byStart = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    return byStart || Number(a.id) - Number(b.id);
  });
};

const originalCheckAvailability = adminAvailability.checkAvailability;
adminAvailability.checkAvailability = async function checkAvailabilityWithRescheduleHolds(args = {}) {
  const result = await originalCheckAvailability(args);
  if (!featureEnabled() || result?.status !== 'available' || !result?.staff?.id) return result;
  await schemaReady;
  const holds = await livePendingRescheduleConflicts({
    staffId: result.staff.id,
    startsAt: result.startsAt,
    endsAt: result.endsAt,
  });
  if (!holds.length) return result;
  return { ...result, status: 'conflict', conflicts: holds };
};

// Load downstream services only after adminAvailability exports have been wrapped.
const appointmentChange = require('../services/appointmentChange');

const originalProcessAppointmentChangeMessage = appointmentChange.processAppointmentChangeMessage;
appointmentChange.processAppointmentChangeMessage = async function practitionerApprovedClientReschedule(phone, text, ...rest) {
  if (!featureEnabled()) return originalProcessAppointmentChangeMessage(phone, text, ...rest);
  await schemaReady;
  const priorIntent = await appointmentChange.getIntent(phone);
  if (
    priorIntent?.action === 'reschedule'
    && priorIntent?.status === 'awaiting_confirmation'
    && isClientConfirmation(text)
  ) {
    // Explicit change boundary: retire any stale request rows before the new hold is validated.
    await reconcileStalePendingRescheduleHolds();
    const result = await createPendingRescheduleRequest(phone, priorIntent);
    await appointmentChange.clearIntent(phone);
    return { handled: true, ...result };
  }

  const result = await originalProcessAppointmentChangeMessage(phone, text, ...rest);
  if (
    priorIntent?.action === 'cancel'
    && priorIntent?.appointment_id
    && priorIntent?.status === 'awaiting_confirmation'
    && isClientConfirmation(text)
  ) {
    const status = await pool.query('SELECT status FROM appointments WHERE id=$1', [Number(priorIntent.appointment_id)]);
    if (status.rows[0]?.status === 'cancelled') {
      await supersedePendingRescheduleForAppointment(priorIntent.appointment_id, 'client cancelled the original appointment');
    }
  }
  return result;
};

// Require this only after appointmentChange has been wrapped so its internal import captures the guarded route.
const rescheduleAvailability = require('../services/clientRescheduleAvailability');
const originalProcessRescheduleAvailabilityMessage = rescheduleAvailability.processClientRescheduleAvailabilityMessage;
rescheduleAvailability.processClientRescheduleAvailabilityMessage = async function approvalAwareReschedulePresentation(phone, text, ...rest) {
  const result = await originalProcessRescheduleAvailabilityMessage(phone, text, ...rest);
  if (!featureEnabled() || result?.interactive?.type !== 'button') return result;
  const buttons = Array.isArray(result.interactive.buttons) ? result.interactive.buttons : [];
  const confirmIndex = buttons.findIndex((button) => button?.id === 'yes' && button?.title === 'Confirm reschedule');
  if (confirmIndex < 0 || !String(result.interactive.body || '').includes('Please confirm this reschedule:')) return result;

  const nextButtons = buttons.map((button, index) => (
    index === confirmIndex ? { ...button, title: 'Request change' } : button
  ));
  const nextBody = String(result.interactive.body)
    .replace('Please confirm this reschedule:', '*Request this reschedule?*')
    .replace(
      'Nothing has changed yet.',
      'Your current appointment remains confirmed. The requested new time will only replace it after the clinic confirms the change.'
    );
  return { ...result, interactive: { ...result.interactive, body: nextBody, buttons: nextButtons } };
};
