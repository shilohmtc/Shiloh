'use strict';

const BOOKING_POLICY_VERSION = '2026-09-25-v3';
const BOOKING_POLICY_UPDATED = '25 September 2026';

const DEPOSIT_RULES = Object.freeze({
  rateBasisPoints: 5000,
  freeNoticeHours: 48,
  partialNoticeHours: 24,
  partialForfeitBasisPoints: 5000,
  lateForfeitBasisPoints: 10000,
  noShowForfeitBasisPoints: 10000,
  exemptPractitionerDisplayName: 'Marietjie',
});

function percentText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function basisPointsPercent(value) {
  return Number(value) / 100;
}

function normalizedPractitioners(value) {
  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap(item => String(item || '').split(/\s*\+\s*/))
    .map(item => item.trim())
    .filter(Boolean);
}

function depositExemptForPractitioners(practitioners = []) {
  const names = normalizedPractitioners(practitioners);
  if (!names.length) return false;
  const exempt = DEPOSIT_RULES.exemptPractitionerDisplayName.toLowerCase();
  return names.every(name => name.toLowerCase() === exempt);
}

function cancellationBand({ startsAt, now = new Date(), noShow = false } = {}) {
  if (noShow) {
    return {
      key: 'no_show',
      forfeitPercent: basisPointsPercent(DEPOSIT_RULES.noShowForfeitBasisPoints),
    };
  }
  const start = new Date(startsAt);
  const current = new Date(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime())) {
    return { key: 'unknown', forfeitPercent: null };
  }
  const hours = (start.getTime() - current.getTime()) / 3600000;
  if (hours >= DEPOSIT_RULES.freeNoticeHours) {
    return { key: 'free', forfeitPercent: 0 };
  }
  if (hours >= DEPOSIT_RULES.partialNoticeHours) {
    return {
      key: 'partial',
      forfeitPercent: basisPointsPercent(DEPOSIT_RULES.partialForfeitBasisPoints),
    };
  }
  return {
    key: 'late',
    forfeitPercent: basisPointsPercent(DEPOSIT_RULES.lateForfeitBasisPoints),
  };
}

function cancellationPolicyNotice({ startsAt, practitioners = [], now = new Date() } = {}) {
  if (depositExemptForPractitioners(practitioners)) {
    return 'Under Shiloh’s Booking Policy & Terms, no booking deposit is required for this appointment.';
  }
  const band = cancellationBand({ startsAt, now });
  if (band.key === 'free') {
    return `Under Shiloh’s Booking Policy & Terms, ${DEPOSIT_RULES.freeNoticeHours} hours or more before your appointment means no portion of your booking deposit is forfeited.`;
  }
  if (band.key === 'partial') {
    return `This cancellation is ${DEPOSIT_RULES.partialNoticeHours}–${DEPOSIT_RULES.freeNoticeHours} hours before the appointment. Under Shiloh’s Booking Policy & Terms, up to ${percentText(band.forfeitPercent)}% of your booking deposit may be retained.`;
  }
  if (band.key === 'late') {
    return `This cancellation is less than ${DEPOSIT_RULES.partialNoticeHours} hours before the appointment. Under Shiloh’s Booking Policy & Terms, up to ${percentText(band.forfeitPercent)}% of your booking deposit may be retained.`;
  }
  return 'Shiloh’s current Booking Policy & Terms apply to this cancellation.';
}

function reschedulePolicyNotice() {
  return 'Under Shiloh’s Booking Policy & Terms, any deposit already paid remains linked to your booking when you reschedule.';
}

function buildDepositPolicyNotice({ priceKnown = false, exempt = false } = {}) {
  if (exempt) {
    return [
      '*Booking deposit*',
      'No booking deposit is required for this appointment under Shiloh’s Booking Policy & Terms.',
    ].join('\n');
  }

  const rate = percentText(basisPointsPercent(DEPOSIT_RULES.rateBasisPoints));
  const free = percentText(DEPOSIT_RULES.freeNoticeHours);
  const partial = percentText(DEPOSIT_RULES.partialNoticeHours);
  const partialForfeit = percentText(basisPointsPercent(DEPOSIT_RULES.partialForfeitBasisPoints));
  const lateForfeit = percentText(basisPointsPercent(DEPOSIT_RULES.lateForfeitBasisPoints));
  const noShowForfeit = percentText(basisPointsPercent(DEPOSIT_RULES.noShowForfeitBasisPoints));
  const priceLine = priceKnown
    ? 'If Shiloh accepts this request, we’ll prepare the exact deposit amount and secure payment option.'
    : `The booking price still needs to be confirmed before the ${rate}% deposit can be calculated. Shiloh cannot accept the request until that price is set.`;

  return [
    '*Booking deposit*',
    `A ${rate}% booking deposit is required to secure this appointment if Shiloh accepts your request. It forms part of the total cost of your treatment — it is not an additional fee.`,
    priceLine,
    '',
    '*Cancellation & rescheduling*',
    `• ${free} hours or more before your appointment: No portion of your booking deposit is forfeited.`,
    `• ${partial}–${free} hours before your appointment: Up to ${partialForfeit}% of your booking deposit may be retained.`,
    `• Less than ${partial} hours or same-day cancellation: Up to ${lateForfeit}% of your booking deposit may be retained.`,
    `• No-show: Up to ${noShowForfeit}% of your booking deposit may be retained.`,
    '• Rescheduling: Any deposit already paid remains linked to your booking.',
    'Once your deposit has been received and verified by Shiloh, your appointment is confirmed.',
  ].join('\n');
}

const BOOKING_POLICY_TEXT = [
  '*Shiloh Massage Therapy & Aesthetic Clinic — Booking Policy & Terms*',
  '',
  'All treatments and services provided by Shiloh are strictly professional and non-sexual. Inappropriate, suggestive, abusive, discriminatory, threatening or disrespectful behaviour, comments or requests will not be tolerated. Shiloh may refuse or immediately end a treatment where these standards are breached.',
  '',
  '*Appointments & Arrival*',
  'Please arrive on time. Late arrival may require a shorter treatment so later clients are not delayed, and the full treatment fee may still apply.',
  '',
  '*Booking Deposit*',
  `A ${percentText(basisPointsPercent(DEPOSIT_RULES.rateBasisPoints))}% booking deposit is required for new bookings.`,
  'Your deposit forms part of the total cost of your treatment — it is not an additional fee. Once your deposit has been received and verified by Shiloh, your appointment is confirmed.',
  '',
  '*Cancellations & Rescheduling*',
  'We understand that plans can change. If you need to cancel or reschedule, please let us know as soon as possible. Our therapists set aside this time especially for you, and adequate notice allows us to offer the appointment to another client while respecting the time our team has reserved for your treatment.',
  `• ${DEPOSIT_RULES.freeNoticeHours} hours or more before your appointment: No portion of your booking deposit is forfeited.`,
  `• ${DEPOSIT_RULES.partialNoticeHours}–${DEPOSIT_RULES.freeNoticeHours} hours before your appointment: Up to ${percentText(basisPointsPercent(DEPOSIT_RULES.partialForfeitBasisPoints))}% of your booking deposit may be retained.`,
  `• Less than ${DEPOSIT_RULES.partialNoticeHours} hours or same-day cancellation: Up to ${percentText(basisPointsPercent(DEPOSIT_RULES.lateForfeitBasisPoints))}% of your booking deposit may be retained.`,
  `• No-show: Up to ${percentText(basisPointsPercent(DEPOSIT_RULES.noShowForfeitBasisPoints))}% of your booking deposit may be retained.`,
  '• Rescheduling: Any deposit already paid remains linked to your booking.',
  '',
  '*Health & Treatment Information*',
  'Please provide accurate and relevant health, medical, pregnancy, allergy, medication and treatment information before your service, and tell your practitioner about any change that could affect treatment safety or suitability.',
  '',
  '*Treatment Suitability & Results*',
  'Some treatments are not suitable for every client. A treatment may be adjusted, postponed or declined for safety reasons. Individual experiences and results may vary.',
  '',
  '*Respect, Safety & Belongings*',
  'Shiloh is committed to a professional, respectful and safe environment. We may refuse service where conduct compromises another person’s safety, dignity or wellbeing. Please take reasonable care of your personal belongings while at the clinic.',
  '',
  `Policy updated: ${BOOKING_POLICY_UPDATED}`,
  `Policy version: ${BOOKING_POLICY_VERSION}`,
  '',
  'To continue with this booking request, reply exactly: *I AGREE*',
  'If you do not agree, reply *DECLINE* and the booking request will not proceed.',
].join('\n');

const BOOKING_POLICY_AUTHORITY = Object.freeze({
  version: BOOKING_POLICY_VERSION,
  updated: BOOKING_POLICY_UPDATED,
  deposit: DEPOSIT_RULES,
});

module.exports = {
  BOOKING_POLICY_AUTHORITY,
  BOOKING_POLICY_VERSION,
  BOOKING_POLICY_UPDATED,
  BOOKING_POLICY_TEXT,
  DEPOSIT_RULES,
  basisPointsPercent,
  percentText,
  normalizedPractitioners,
  depositExemptForPractitioners,
  cancellationBand,
  cancellationPolicyNotice,
  reschedulePolicyNotice,
  buildDepositPolicyNotice,
};
