# Website publishing and the Morning Welcome Offer

Accepted by the owner on 22 October 2026.

Discover Shiloh has a public series listing and a permanent page for each
episode. Home shows the latest episode and current offer. About and the footer
link to the series; the footer also links to Current offers. Keep the existing
header navigation, colours, photography and clinic name.

Clinic administrators use Workspace → Website to upload artwork, edit text,
save drafts, preview, publish, schedule and take items off the website. A saved
draft does not replace a published version. Restoring a saved version creates a
draft for review. An optional end date removes the item from public discovery
and prevents new offer pricing after expiry. Display and date controls use
South African time.

The Morning Welcome Offer is ongoing, with no October expiry. Its rules are:

- 20% off every eligible massage or pedicure treatment in a client's first visit.
- Each qualifying treatment starts from 08:00 and before 12:00 in South African
  time; it may finish later. Saturdays are excluded.
- Advance booking is required; existing clinic hours and availability apply.
- Only one promotional offer applies to a booking. Purchased gift vouchers are
  a payment method and remain usable.
- Client visit history determines eligibility; opening an account is not a
  first visit. All eligible treatments on the first visit date can qualify;
  a later visit date does not receive another claim, even after an account is recreated.
- Show the original price, saving and amount due before confirmation. Recheck
  eligibility and prices atomically when creating the booking. A changed quote
  requires another review rather than silently charging a different amount.
- Clients may turn off this offer before confirmation to retain a different
  promotional voucher for the booking. A purchased gift voucher remains payment.
- Pausing publication stops new offer claims while keeping existing agreed
  booking prices and payment history.

Review the offer's results and margins monthly. This document records the
owner's decision, not a claim that publication, deployment or a real payment
has completed. The corresponding PR records implementation and release state.

## Controlled release

This feature adds `199_website_publishing_morning_offer.sql`. Follow the existing
production migration authority: confirm an available backup/PITR recovery point,
freeze the exact tested revision and sole pending migration, then execute the
controlled migration before the new web process starts. Declare
`SHILOH_CONTROLLED_RELEASE_MIGRATION=199_website_publishing_morning_offer.sql`
in the release plan. Do not merge an unprepared migration into the automatic
deployment branch.

The migration creates two drafts and no published promotion. It does not change
existing appointments, catalogue prices, payments, permissions or balances.
Verify its ledger checksum, new tables, both unpublished drafts and unchanged
existing financial records before opening the editor. Clear the controlled
release setting after successful migration and deployment verification.

Upload the original Episode 1 artwork in Website, preview both items on phone
and desktop, then publish. The revised Morning Welcome Offer artwork is included
with the application; publishing the offer enables its qualifying booking prices.
Confirm a synthetic quote before any owner acceptance test; do not send client
messages or create live appointments as an automated release check.

If the offer needs to stop, take it off the website. Existing agreed prices and
their history remain. Correct any release issue with a compatible forward fix;
do not delete booking-price snapshots, edit migration checksums or roll the app
back to a migration inventory that no longer includes this schema.
