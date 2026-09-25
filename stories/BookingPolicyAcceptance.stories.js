import acceptancePresentation from '../src/presentation/bookingPolicyAcceptanceUx.js';
import bookingPolicyAuthority from '../src/config/bookingPolicyAuthority.js';

const { renderBookingPolicyAcceptancePage } = acceptancePresentation;
const { BOOKING_POLICY_TEXT, BOOKING_POLICY_VERSION, BOOKING_POLICY_UPDATED } = bookingPolicyAuthority;

function request(channel = 'clinic_device') {
  return {
    appointmentId: 812,
    clientName: 'Christel',
    channel,
    accepted: false,
    requestKey: channel === 'clinic_device' ? 'C'.repeat(43) : 'P'.repeat(43),
    policyVersion: BOOKING_POLICY_VERSION,
    policyUpdated: BOOKING_POLICY_UPDATED,
    policyText: BOOKING_POLICY_TEXT,
    startsAt: '2026-09-30T08:00:00.000Z',
  };
}

function surface(html) {
  const styles = [...String(html).matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const body = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}</style><div data-story-surface>${body}</div>`;
}

export default {
  title: 'Client/Booking policy acceptance',
  parameters: { layout: 'fullscreen' },
};

export const ClinicDeviceReview = {
  render: () => surface(renderBookingPolicyAcceptancePage({ request: request('clinic_device') })),
};

export const ClientPhoneReview = {
  render: () => surface(renderBookingPolicyAcceptancePage({ request: request('secure_link') })),
};

export const TermsAcceptedDepositNext = {
  render: () => {
    const accepted = { ...request('secure_link'), accepted: true };
    return surface(renderBookingPolicyAcceptancePage({
      request: accepted,
      outcome: {
        state: 'accepted',
        confirmationState: 'pending',
        depositRequired: true,
        depositAmount: '340.00',
        paymentPath: '/pay/dep_storybook_812',
      },
    }));
  },
};
