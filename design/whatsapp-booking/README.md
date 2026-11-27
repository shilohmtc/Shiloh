# In-WhatsApp booking staff pilot

The unchanged registration JSON passed Meta's draft validator. The interactive
phone preview showed the four registration fields and completed the Flow. A
real callback from Meta still needs staff-device verification.

The native pilot is off by default. To test it after a controlled release, the
existing booking pilot must be on for its single staff number with a matching
Meta sender and app secret. Set native review on and identify the exact Meta
draft with `SHILOH_WHATSAPP_BOOKING_NATIVE_REVIEW_ENABLED` and
`SHILOH_WHATSAPP_BOOKING_REGISTRATION_FLOW_ID`. The native registration
message explicitly uses draft mode. This does not require publishing the Flow.

The pilot uses the existing signed Meta webhook, single-recipient admission,
delivery limit and CRM writer. A new profile requires a fresh chat invitation
and a matching signed Flow completion. Existing unambiguous verified profiles
can continue to treatments. Historical or ambiguous matches go to Reception.
This path never issues a My Shiloh session.

The chat sends the canonical terms before showing the quote and the Accept
terms button. Acceptance rechecks availability and the quote. A separate
Request appointment tap uses the existing Workspace approval path. The HTTP
fixture verifies one acceptance and one acknowledgement with a fake provider
and an appointment-writer test double. A separate existing fixture tests the
actual Workspace hold trigger. Production deposit, confirmation and form
delivery after approval require their own verification.

Migration 204 adds short-lived registration grants. It stores keyed sender and
completion fingerprints, a Flow token digest, the expiry and the canonical
client ID on completion. The existing hourly retention pass removes expired
grants. The four form answers are never stored in the grants.

First deploy with native review off. Verify the migration ledger, recovery
point and a ledger-204 compatible rollback plan before the controlled release.
Before testing, check the remaining attempt budget for the approved staff
number. A clean first request can consume ten outbound attempts. Do not
reset counters. General client access requires a separate rollout.
