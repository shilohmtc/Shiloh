'use strict';

// The clinic request/Calendar hold policy is independent of Meta delivery.
function clientRescheduleRequestsEnabled(env = process.env) {
  return env.SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED === 'true';
}

module.exports = { clientRescheduleRequestsEnabled };
