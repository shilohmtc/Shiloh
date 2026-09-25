import paymentPolicyPresentation from '../src/presentation/paymentPolicyUx.js';
import bookingPolicyAuthority from '../src/config/bookingPolicyAuthority.js';

const { renderPaymentPolicyPage } = paymentPolicyPresentation;
const { BOOKING_POLICY_TEXT } = bookingPolicyAuthority;

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
    policyText: BOOKING_POLICY_TEXT,
  })),
};
