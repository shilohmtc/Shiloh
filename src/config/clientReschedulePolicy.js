'use strict';

// The clinic request/Calendar hold policy is independent of Meta delivery.
// Until Render has the new setting, preserve the existing production decision.
function clientRescheduleRequestsEnabled(env = process.env) {
  if (env.SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED !== undefined) {
    return env.SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED === 'true';
  }
  return env.WHATSAPP_RESCHEDULE_APPROVAL_ENABLED === 'true';
}

module.exports = { clientRescheduleRequestsEnabled };
