# Shiloh payments

Issue #995 introduces one provider-independent payment authority for ordinary appointments and linked booking groups. Payment processing is integrated; booking, attendance, Calendar and loyalty truth remain separate.

Shared Rand formatting, payment mobile matching and hosted payment URLs live in `src/services/paymentValues.js`. These retain their existing behavior and have no WhatsApp transport dependency. The retired payment-notification module and its unused sender/link-fallback exports are removed; current notices remain app-owned.

## Human operation

Authorized owner/Reception staff open an appointment and choose **Payments**. The payment page shows the canonical booking total, net received and outstanding balance. Staff can:

- create one full or several split Ozow payment requests;
- copy a hosted payment link for intentional delivery to the payer;
- record cash, card-machine or EFT settlement with explicit manual evidence;
- inspect immutable payment and refund history.

The staff payment page shows the balance, deposit and Ozow collection action first, followed by payment requests and history. Reception help and manual settlement are separate disclosures after that history. Reception help keeps its issue summary visible and opens when an existing link is cancelled, failed or needs preparation; routine client-step details remain under the disclosure. Manual settlement stays collapsed and is labelled **Record payment received outside Ozow**. Staff use it only for verified cash, card-machine or direct EFT receipts, not an unresolved Ozow attempt, and must confirm funds reached Shiloh before submitting the form. Ozow settlement remains automatic after verified provider notification. Client payment notices are presented in My Shiloh; the staff recovery copy does not direct clients to WhatsApp.

Each request row uses **Deposit · amount** only when its recorded purpose is deposit; other requests use **Payment · amount**, including partial or split requests. The secondary line is **Ozow · status**, with plain state labels such as Link ready, Pending, Paid, Cancelled and Failed. Historical request purpose is not inferred from the current deposit requirement or rewritten after settlement.

Refund records require the narrower `payment:refund` capability. The initial migration grants collection to active canonical owner/booking-operator principals with full business/service scope and refund authority only to the active canonical owner.

When the current booking price differs from its recorded payment-account price after payment or credit activity, authorized staff can still open Payments to review the original account, receipts and earlier-payment evidence. The page identifies both prices and labels the original balance as review only. Collection, refunds, credit applications, No charge decisions and sharing payment links remain blocked on this review page; opening it does not reconcile prices, change money or create a deposit requirement. Ordinary financial actions retain their existing price-mismatch guards. A current price of R0 is separate from the audited No charge classification and does not erase existing payment or credit history.

## Booking Policy & Terms — deposit enforcement

Shiloh has one client-facing **Booking Policy & Terms** authority. The deposit tables below are a technical enforcement mirror of that same policy, layered on top of the existing payment ledger; they are not a second clinic policy.

- The Booking Policy & Terms states that **all appointments require a 50% booking deposit**. This applies to appointments booked under the policy; existing bookings made before its effective timestamp are not enrolled retroactively.
- Appointments provided by **Marietjie are exempt**. The exemption resolves through her canonical active staff record; it is not a presentation-only name check.
- The client-facing general policy does not publish that practitioner-specific exception. Shiloh applies it internally and tells an affected client simply that no booking deposit is required for that appointment.
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

The verified **Payment received** page includes **Back to My Shiloh** beneath the reference. It opens `/my-shiloh/` in the same window without carrying the private payment reference. The confirmation stays visible until the client chooses to return; this navigation does not change payment or booking state. Pending and failed payment guidance remains authoritative for those states.

## Payment notices

Payment and voucher notices use My Shiloh. The historical Meta payment template contracts are retained for audit, marked retired, and cannot be registered or sent. Their nine Render template-name overrides are no longer read by the payment transport or provider inventory. The stable Shiloh `/pay/<request-key>` link redirects only to the stored Ozow payment URL. An app wake does not change payment truth; verified Ozow callbacks and authorized manual entries do.

## Release boundary

Deployment of the code does not enable Ozow or create any financial contract. Merchant onboarding, secret creation/entry, live endpoint confirmation and a controlled low-value test payment are separate owner/provider release steps.

## Client payment choice implementation

My Shiloh offers a reviewed deposit or remaining-treatment payment for an approved, future, priced booking whose entire payment account belongs to the signed-in client. Already recorded money and already applied eligible credits reduce the treatment remainder. This does not grant earlier credit redemption, change the deposit calculation or cancellation consequences, or waive treatment when a deposit is waived. Equal amounts appear once. Mixed-client groups and unresolved payer scope require Reception for any new amount choice; owning one guest appointment does not grant account-wide collection authority. A restricted shared review preserves an existing explicitly payer-bound fixed link, with only that request amount and no account total or other guest details. The hosted checkout revalidates it before use.

The authenticated page and assistant only prepare review. The explicit session/origin/CSRF-protected collection POST computes cents on the server and binds the review to payer, account scope, exact member revisions, price, deposit and current settlement. The assistant receives service/date and minimal amounts; private payment targets stay outside model results. No provider call happens on a read, page load or chat preparation.

New all-owned deposit preparation has positive `dpc2_` provenance bound to an audit recorded in the same preparation transaction and no external link. Prefix alone, missing metadata or a historic staff operation never establishes non-issuance. Public route projections carry every provenance field needed by the same guard. An intentional client choice creates a durable `cpc_` pending reservation before the single external issuance call. Interrupted or uncertain outcomes recover the same operation and never blindly retry issuance. Historic, started, expired or locally closed external attempts are not assumed revoked; they prevent a competing client link. An eligible existing bound continuation still passes the public checkout guards. The provider adapter has no cancellation or status API.

Booking-account row locks serialize the new reservation with direct staff issuance, background deposit preparation, callbacks, manual money, prior evidence, refunds, credit and waiver paths. Group/member/appointment locks use a consistent order where those rows are needed. Trusted staff split collection remains available except while an unresolved client reservation exists. Manual records still represent actual funds received; their existing fresh outstanding cap remains authoritative.

Both public terms GET and acceptance POST recheck the current payment reservation. Stale client attempts require review rather than silently changing their fixed amount. Historic deposit continuation is conservative when subsequent financial or booking changes cannot be bound to its original amount. Local request closure does not promise provider revocation. Verified receipts arriving after closure, settlement or a changed review are retained as money evidence and flagged for Reception; no automatic refund or booking reconfirmation is invented. Transaction identity deduplicates actual money independently of notification status/envelope, so a pending notification cannot consume a later successful receipt and a distinct verified receipt is retained separately.

These are engineering safeguards for the narrowly scoped client flow, not new clinic policy or a claim of owner acceptance. Synthetic mocked-provider tests and isolated PostgreSQL evidence do not establish live Ozow payment acceptance.
