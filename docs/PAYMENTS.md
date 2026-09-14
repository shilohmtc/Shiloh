# Shiloh payments

Issue #995 introduces one provider-independent payment authority for ordinary appointments and linked booking groups. Payment processing is integrated; booking, attendance, Calendar and loyalty truth remain separate.

## Human operation

Authorized owner/Reception staff open an appointment and choose **Payments**. The payment page shows the canonical booking total, net received and outstanding balance. Staff can:

- create one full or several split Ozow payment requests;
- copy a hosted payment link for intentional delivery to the payer;
- record cash, card-machine or EFT settlement with explicit manual evidence;
- inspect immutable payment and refund history.

Refund records require the narrower `payment:refund` capability. The initial migration grants collection to active canonical owner/booking-operator principals with full business/service scope and refund authority only to the active canonical owner.

## Ozow configuration boundary

Ozow remains fail-closed until all of these runtime values are present:

- `OZOW_SITE_CODE`
- `OZOW_PRIVATE_KEY`
- `OZOW_API_KEY`
- `SHILOH_PUBLIC_BASE_URL`

Optional values:

- `OZOW_TEST_MODE=true` for the provider test environment;
- `OZOW_PAYMENT_API_URL` only when Ozow assigns a different request endpoint.

The verified notification endpoint is `/payments/providers/ozow/notify`. Configure it with Ozow only after the merchant account and exact production credentials are approved. Shiloh stores provider identifiers, hosted links, state and payload hashes; it never collects or stores a client’s card or bank credentials.

Browser return URLs are informational only. Only a verified provider notification or an explicit authorized manual record can assert settlement truth.

## Release boundary

Deployment of the code does not enable Ozow or create any financial contract. Merchant onboarding, secret creation/entry, live endpoint confirmation and a controlled low-value test payment are separate owner/provider release steps.
