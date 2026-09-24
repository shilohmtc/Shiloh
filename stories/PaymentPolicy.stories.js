import paymentPolicyPresentation from '../src/presentation/paymentPolicyUx.js';

const { renderPaymentPolicyPage } = paymentPolicyPresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.payment-policy-story{min-height:100vh}</style><div class="payment-policy-story" data-payment-policy-story>${body}</div>`;
}

export default {
  title: 'Client/Payment policy',
  parameters: { layout: 'fullscreen' },
};

export const DepositPolicyBeforeOzow = {
  render: () => productionSurface(renderPaymentPolicyPage({
    requestKey: 'dep_storybook_760',
    request: {
      amount: '125.00',
      payer_name: 'Jean-Pierre Botha',
      appointment_id: 760,
    },
    policyVersion: '2026-09-23-v2',
    policyText: `Booking Policy & Terms

A 50% booking deposit is required for applicable appointments and is part of your treatment price, not an extra fee.

48+ hours before your appointment: no cancellation penalty.
24–48 hours: 50% of the booking deposit may be forfeited.
Under 24 hours, same-day cancellation or no-show: 100% of the booking deposit may be forfeited.

Marietjie’s services are exempt from the booking deposit requirement.`,
  })),
};
