# Shiloh payments

Issue #995 introduces one provider-independent payment authority for ordinary appointments and linked booking groups. Payment processing is integrated; booking, attendance, Calendar and loyalty truth remain separate.

## Human operation

Authorized owner/Reception staff open an appointment and choose **Payments**. The payment page shows the canonical booking total, net received and outstanding balance. Staff can:

- create one full or several split Ozow payment requests;
- copy a hosted payment link for intentional delivery to the payer;
- record cash, card-machine or EFT settlement with explicit manual evidence;
- inspect immutable payment and refund history.

Refund records require the narrower `payment:refund` capability. The initial migration grants collection to active canonical owner/booking-operator principals with full business/service scope and refund authority only to the active canonical owner.

## Booking Policy & Terms — deposit enforcement

Shiloh has one client-facing **Booking Policy & Terms** authority. The deposit tables below are a technical enforcement mirror of that same policy, layered on top of the existing payment ledger; they are not a second clinic policy.

- New future bookings require a **50% booking deposit**.
- Appointments provided by **Marietjie are exempt**. The exemption resolves through her canonical active staff record; it is not a presentation-only name check.
- Linked/group bookings calculate the deposit only on non-Marietjie member allocations.
- The deposit is part-payment toward the canonical booking total, never an added fee.
- Booking confirmation is held until the required deposit is satisfied by verified Ozow or authorized manual payment evidence.
- Rewards and welcome-voucher value do not silently satisfy the cash deposit requirement.
- Existing bookings created before the policy effective timestamp and retrospective/past bookings are not enrolled retroactively.
- No unpaid-booking expiry is invented in v1; an unpaid booking remains awaiting deposit until an explicit later policy defines an expiry.

Cancellation/no-show consequence evidence is recorded separately from money movement:

- **48 hours or more notice:** 0% of the deposit is forfeitable.
- **24–48 hours notice:** 50% of the booking deposit is forfeitable.
- **Less than 24 hours, same-day cancellation, or no-show:** 100% of the booking deposit is forfeitable.
- Rescheduling preserves the existing booking payment/deposit account.
- Shiloh does not automatically issue refunds or move money because of a cancellation/no-show event. Existing authorized refund/payment operations remain the monetary authority.

The technical deposit-policy row, requirement/member allocations and policy events remain distinct from appointment status and payment-ledger settlement truth, but their rule values and policy version must match the canonical Booking Policy & Terms authority or the deposit engine fails closed.

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

## WhatsApp payment notifications

The approved Meta utility templates are wired behind one explicit master switch:

- `WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED=true`
- `WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE=shiloh_payment_deposit_request_v1`
- `WHATSAPP_PAYMENT_DEPOSIT_RECEIVED_TEMPLATE=shiloh_payment_deposit_received_v1`
- `WHATSAPP_PAYMENT_BALANCE_DUE_TEMPLATE=shiloh_payment_balance_due_v1`
- `WHATSAPP_PAYMENT_SPLIT_REQUEST_TEMPLATE=shiloh_payment_split_request_v1`
- `WHATSAPP_PAYMENT_RECEIVED_TEMPLATE=shiloh_payment_received_v1`
- `WHATSAPP_PAYMENT_NOT_VERIFIED_TEMPLATE=shiloh_payment_not_verified_v1`
- `WHATSAPP_PAYMENT_REFUND_UPDATE_TEMPLATE=shiloh_payment_refund_update_v1`
- `WHATSAPP_PAYMENT_VOUCHER_REQUEST_TEMPLATE=shiloh_payment_voucher_request_v1`
- `WHATSAPP_PAYMENT_VOUCHER_ISSUED_TEMPLATE=shiloh_payment_voucher_issued_v1`

When enabled and the centralized Meta inventory gate confirms an exact approved template, Shiloh sends a request notification after a payment link is committed, a received notification only after verified Ozow or authorized manual settlement, a not-verified notification for a verified failed/cancelled provider result, and a refund update after an authorized refund record. The WhatsApp button opens a stable Shiloh `/pay/<request-key>` link, which redirects only to the stored Ozow payment URL. No WhatsApp send changes payment truth.

## Release boundary

Deployment of the code does not enable Ozow or create any financial contract. Merchant onboarding, secret creation/entry, live endpoint confirmation and a controlled low-value test payment are separate owner/provider release steps.
