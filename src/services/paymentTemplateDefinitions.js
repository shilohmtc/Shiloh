const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_FOOTER = 'Shiloh Massage Therapy & Aesthetic Clinic';
const PAYMENT_URL = 'https://app.shilohmtc.co.za/pay/{{1}}';

const DEFINITIONS = Object.freeze({
  payment_deposit_request: {
    name: 'shiloh_payment_deposit_request_v1',
    env: 'WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE',
    header: 'Deposit required',
    body: `Hi {{1}}, a deposit of {{2}} is required for your Shiloh booking.

Treatment: {{3}}
Date: {{4}}
Time: {{5}}
Booking #{{6}}

Your booking is awaiting payment. Shiloh confirms it only after the payment is verified.`,
    example: [['Christel', 'R300.00', 'Couples Massage', 'Monday, 21 September 2026', '10:00', '712']],
    button: { text: 'Pay deposit', example: ['deposit_712_example'] },
  },
  payment_deposit_received: {
    name: 'shiloh_payment_deposit_received_v1',
    env: 'WHATSAPP_PAYMENT_DEPOSIT_RECEIVED_TEMPLATE',
    header: 'Deposit received',
    body: `Hi {{1}}, Shiloh has verified your deposit of {{2}}.

Treatment: {{3}}
Date: {{4}}
Time: {{5}}
Booking #{{6}}
Remaining balance: {{7}}

Your booking is confirmed.`,
    example: [['Christel', 'R300.00', 'Couples Massage', 'Monday, 21 September 2026', '10:00', '712', 'R900.00']],
    quickReply: 'My appointments',
  },
  payment_balance_due: {
    name: 'shiloh_payment_balance_due_v1',
    env: 'WHATSAPP_PAYMENT_BALANCE_DUE_TEMPLATE',
    header: 'Balance due',
    body: `Hi {{1}}, thank you for visiting Shiloh.

Treatment: {{2}}
Appointment #{{3}}
Outstanding balance: {{4}}

You can pay securely using the option below or at reception using FNB Speedpoint.`,
    example: [['Christel', 'Full Body Swedish Massage', '713', 'R650.00']],
    button: { text: 'Pay balance', example: ['balance_713_example'] },
  },
  payment_split_request: {
    name: 'shiloh_payment_split_request_v1',
    env: 'WHATSAPP_PAYMENT_SPLIT_REQUEST_TEMPLATE',
    header: 'Shared payment request',
    body: `Hi {{1}}, a Shiloh payment request has been created for you.

Booking: {{2}}
Your requested amount: {{3}}
Booking #{{4}}

This payment is reconciled against the shared Couples or Group booking balance.`,
    example: [['Naledi', 'Couples Massage', 'R600.00', '714']],
    button: { text: 'Pay securely', example: ['split_714_example'] },
  },
  payment_received: {
    name: 'shiloh_payment_received_v1',
    env: 'WHATSAPP_PAYMENT_RECEIVED_TEMPLATE',
    header: 'Payment received',
    body: `Hi {{1}}, Shiloh has verified your payment.

Amount: {{2}}
Method: {{3}}
Reference: {{4}}
Remaining balance: {{5}}

Thank you.`,
    example: [['Christel', 'R650.00', 'Ozow', 'SHILOH 713', 'R0.00']],
    quickReply: 'Payment help',
  },
  payment_not_verified: {
    name: 'shiloh_payment_not_verified_v1',
    env: 'WHATSAPP_PAYMENT_NOT_VERIFIED_TEMPLATE',
    header: 'Payment status',
    body: `Hi {{1}}, Shiloh could not verify a completed payment for {{2}}.

Reference: {{3}}
Amount: {{4}}

No payment has been recorded by Shiloh. If the amount left your account, please contact us with the reference above before trying again.`,
    example: [['Christel', 'Booking #713', 'SHILOH 713', 'R650.00']],
    quickReply: 'Payment help',
  },
  payment_refund_update: {
    name: 'shiloh_payment_refund_update_v1',
    env: 'WHATSAPP_PAYMENT_REFUND_UPDATE_TEMPLATE',
    header: 'Refund update',
    body: `Hi {{1}}, here is the latest refund update from Shiloh.

Status: {{2}}
Amount: {{3}}
Reference: {{4}}

This message reflects Shiloh's latest verified refund record.`,
    example: [['Christel', 'Completed', 'R300.00', 'REFUND 713']],
    quickReply: 'Refund help',
  },
  payment_voucher_request: {
    name: 'shiloh_payment_voucher_request_v1',
    env: 'WHATSAPP_PAYMENT_VOUCHER_REQUEST_TEMPLATE',
    header: 'Voucher payment',
    body: `Hi {{1}}, your requested Shiloh voucher is awaiting payment.

Voucher: {{2}}
Value: {{3}}
Amount due: {{4}}

The voucher will be issued only after Shiloh verifies the payment.`,
    example: [['Christel', 'Medi-Heel Pedicure', 'R550.00', 'R550.00']],
    button: { text: 'Pay for voucher', example: ['voucher_request_example'] },
  },
  payment_voucher_issued: {
    name: 'shiloh_payment_voucher_issued_v1',
    env: 'WHATSAPP_PAYMENT_VOUCHER_ISSUED_TEMPLATE',
    header: 'Voucher ready',
    body: `Hi {{1}}, Shiloh has verified payment and your voucher is ready.

Voucher: {{2}}
Value: {{3}}
Valid until: {{4}}

Keep the secure voucher link private.`,
    example: [['Christel', 'Medi-Heel Pedicure', 'R550.00', '20 November 2026']],
    button: { text: 'View voucher', example: ['voucher_issued_example'] },
  },
});

function buildPaymentTemplateDefinition(key) {
  const item = DEFINITIONS[key];
  if (!item) throw new Error(`Unknown payment template: ${key}`);
  const components = [
    { type: 'HEADER', format: 'TEXT', text: item.header },
    { type: 'BODY', text: item.body, example: { body_text: item.example } },
    { type: 'FOOTER', text: TEMPLATE_FOOTER },
  ];
  if (item.button) {
    components.push({
      type: 'BUTTONS',
      buttons: [{
        type: 'URL',
        text: item.button.text,
        url: PAYMENT_URL,
        example: item.button.example,
      }],
    });
  } else if (item.quickReply) {
    components.push({
      type: 'BUTTONS',
      buttons: [{ type: 'QUICK_REPLY', text: item.quickReply }],
    });
  }
  return {
    name: item.name,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components,
  };
}

module.exports = {
  TEMPLATE_LANGUAGE,
  TEMPLATE_CATEGORY,
  TEMPLATE_FOOTER,
  PAYMENT_URL,
  DEFINITIONS,
  buildPaymentTemplateDefinition,
};
