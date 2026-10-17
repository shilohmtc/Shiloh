'use strict';

// Accepted 17 October 2026. Limits are shared across purposes and channels;
// changing a purpose or requesting SMS must never reset a person's allowance.
const CODE_SIGN_IN_POLICY = Object.freeze({
  staff: Object.freeze({ dailyCodes: 10, perPersonDailyCodes: 10, perPersonDailySms: 2 }),
  client: Object.freeze({ dailyCodes: 50, perPersonDailyCodes: 3, perPersonDailySms: 1 }),
  resendMs: 60000,
});

function codeReservationBuckets({ audience, personKey, channel, digest, current, includeCooldown = true }) {
  const policy = CODE_SIGN_IN_POLICY[audience];
  if (!policy || !personKey || !['whatsapp', 'sms'].includes(channel) ||
      typeof digest !== 'function' || !(current instanceof Date) || !Number.isFinite(current.getTime())) {
    throw Error('Invalid code reservation context');
  }
  // A fixed South African calendar day, independent of the server timezone.
  const localMs = current.getTime() + 2 * 60 * 60 * 1000;
  const day = new Date(localMs).toISOString().slice(0, 10);
  const untilMidnight = 86400000 - localMs % 86400000;
  return [
    { key: digest('code-day', audience, day), limit: policy.dailyCodes, windowMs: untilMidnight },
    { key: digest('person-code-day', audience, day, personKey), limit: policy.perPersonDailyCodes, windowMs: untilMidnight },
    ...(includeCooldown ? [{ key: digest('code-resend', audience, personKey), limit: 1, windowMs: CODE_SIGN_IN_POLICY.resendMs }] : []),
    ...(channel === 'sms' ? [
      { key: digest('person-sms-day', audience, day, personKey), limit: policy.perPersonDailySms, windowMs: untilMidnight },
    ] : []),
  ];
}

module.exports = { CODE_SIGN_IN_POLICY, codeReservationBuckets };
