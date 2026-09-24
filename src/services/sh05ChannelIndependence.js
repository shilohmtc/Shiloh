'use strict';

const { queueClientNotification } = require('./myShilohPush');
const logger = require('../lib/logger');

function appointmentDetails({ appointmentId, crmV2ClientId, clientName, serviceName, startsAt, endsAt, changeKind = 'confirmation', auditEventId = null }) {
  const when = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  const date = when && !Number.isNaN(when.getTime())
    ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium' }).format(when)
    : 'your scheduled time';
  const time = when && end && !Number.isNaN(when.getTime()) && !Number.isNaN(end.getTime())
    ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', timeStyle: 'short' }).format(when)
      + '–'
      + new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', timeStyle: 'short' }).format(end)
    : 'your scheduled time';
  const label = changeKind === 'cancellation' ? 'Appointment cancelled' : changeKind === 'reminder' ? 'Appointment reminder' : changeKind === 'confirmation' ? 'Appointment confirmed' : 'Appointment updated';
  const body = changeKind === 'cancellation'
    ? 'Your Shiloh appointment was cancelled. Open My Shiloh for the latest details.'
    : changeKind === 'reminder'
      ? 'Your Shiloh appointment is coming up. Open My Shiloh for the latest details.'
      : `Your Shiloh appointment is ${changeKind === 'confirmation' ? 'confirmed' : 'updated'} for ${date} at ${time}. Open My Shiloh for the latest details.`;
  return {
    crmV2ClientId: Number(crmV2ClientId),
    eventKey: `appointment-${changeKind}:${appointmentId}:${auditEventId || startsAt || 'current'}`,
    category: 'appointment',
    title: label,
    body: body.slice(0, 240),
    targetPath: '/my-shiloh/#bookings',
  };
}

async function queueIndependentMyShilohNotification(details, { channel = 'my_shiloh' } = {}) {
  const clientId = Number(details?.crmV2ClientId);
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return { queued: false, status: 'unavailable', reason: 'crm_v2_client_unavailable' };
  try {
    const result = await queueClientNotification(appointmentDetails(details));
    const outcome = {
      queued: result?.queued === true,
      status: result?.queued === true ? 'queued' : 'failed',
      reason: result?.reason || null,
      notificationId: result?.notificationId || null,
      channel,
    };
    logger.info({ appointmentId: details.appointmentId, crmV2ClientId: clientId, ...outcome }, 'SH-05 My Shiloh notification channel outcome');
    return outcome;
  } catch (error) {
    const outcome = { queued: false, status: 'failed', reason: 'my_shiloh_notification_error', channel };
    logger.warn({ err: error, appointmentId: details.appointmentId, crmV2ClientId: clientId, ...outcome }, 'SH-05 My Shiloh notification channel failed independently');
    return outcome;
  }
}

async function queueBookingConfirmationMyShilohNotification(details) {
  return queueIndependentMyShilohNotification({ ...details, changeKind: 'confirmation' });
}

async function queueBookingReminderMyShilohNotification(details) {
  return queueIndependentMyShilohNotification({ ...details, changeKind: 'reminder' });
}

async function queueBookingChangeMyShilohNotification(details) {
  return queueIndependentMyShilohNotification(details);
}

module.exports = {
  appointmentDetails,
  queueIndependentMyShilohNotification,
  queueBookingConfirmationMyShilohNotification,
  queueBookingReminderMyShilohNotification,
  queueBookingChangeMyShilohNotification,
};
