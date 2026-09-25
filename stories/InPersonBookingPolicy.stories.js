import presentation from '../src/presentation/inPersonBookingPolicyUx.js';
import authority from '../src/config/bookingPolicyAuthority.js';

const { renderInPersonBookingPolicyPage } = presentation;
const { BOOKING_POLICY_TEXT } = authority;

function productionSurface(html) {
  const styles = [...String(html).matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const body = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.in-person-story{min-height:100vh}</style><div class="in-person-story" data-in-person-policy-story>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

export default {
  title: 'Client/In-person booking policy',
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};

export const AwaitingClientAcceptance = {
  render: () => productionSurface(renderInPersonBookingPolicyPage({
    appointmentId: 812,
    crmV2ClientId: 91,
    clientName: 'Naledi Mokoena',
    startsAt: '2026-09-30T08:00:00.000Z',
    serviceText: 'Hot Stone Massage',
    therapistText: 'Christel',
    policyVersion: '2026-09-25-v3',
    policyText: BOOKING_POLICY_TEXT,
    acceptance: null,
  })),
};

export const AcceptedOnClinicDevice = {
  render: () => productionSurface(renderInPersonBookingPolicyPage({
    appointmentId: 812,
    crmV2ClientId: 91,
    clientName: 'Naledi Mokoena',
    startsAt: '2026-09-30T08:00:00.000Z',
    serviceText: 'Hot Stone Massage',
    therapistText: 'Christel',
    policyVersion: '2026-09-25-v3',
    policyText: BOOKING_POLICY_TEXT,
    acceptance: { policy_version:'2026-09-25-v3', channel:'clinic_device', accepted_at:'2026-09-25T08:32:00.000Z' },
  })),
};
