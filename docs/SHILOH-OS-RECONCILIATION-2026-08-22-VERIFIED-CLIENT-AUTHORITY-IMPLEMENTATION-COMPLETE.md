# Shiloh OS — Reconciliation — Verified-Client Authority Implementation Complete


> Historical record. As of 14 October 2026, automated WhatsApp routing is retired and the dormant language/onboarding/booking-gate modules mentioned below are removed. Retained canonical identity helpers still support My Shiloh and current booking flows. Use [SHILOH_PLATFORM_HANDBOOK.md](SHILOH_PLATFORM_HANDBOOK.md) for current runtime boundaries.
Date: 2026-08-22
Owning implementation workstream: CRM & Identity
Required shared-contract consumer: Booking & Admin UX
Production/deployment observer: Production & DevOps
Shared-state owner: Control & Reconciliation
Status: COMPLETE / VERIFIED LIVE
Risk class: HIGH — identity integrity / privacy / historical-record association / consent

## Authoritative completion

The verified-client authority contract ratified by PR #413 is implemented and live through **PR #416 — Implement verified-client identity authority**.

- implementation base: `02d375b3a9bd271806d499fcff7f576283f37c8b`
- implementation merge / application authority: `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`
- PR #414 remains superseded/closed unmerged; do not reopen
- PR #399 / migration 072 remains durable normalized-phone ambiguity repair authority
- PR #395 remains durable practitioner Google Calendar conflict-classification authority
- PR #411 bounded project-lifetime PostgreSQL observation exception remains unchanged
- Q1–Q11 imported-contact production audit remains authoritative and must not be rerun merely for reconciliation

## CI

Initial PR #416 CI #1268 exposed one stale source-shape assertion in the migration-072 regression. The correction did not weaken authority; the regression was updated to assert the new stronger exact-phone locking behavior.

Final CI #1269:

- workflow run: `32571765659`
- job: `97028094203`
- Node: `24.14.1`
- tests passed: **881**
- failed: **0**
- cancelled: **0**
- skipped: **0**

This is the accepted regression gate for PR #416.

## Forward schema authority

PR #416 adds forward migration:

`migrations/074_client_identity_verification_authority.sql`

Migration 074 creates durable explicit client/contact verification evidence in `client_identity_verifications` and adds onboarding authority-version evidence.

Explicit exclusions:

- no trust backfill;
- no existing imported client grandfathering;
- no conversion of existing `verified_at` proxy/anomaly values into verified-client authority;
- no edit/replay of migration 072;
- no edit to historical applied migrations.

Production startup independently verified:

- event: `client_identity_verification_schema_verified`
- filename: `074_client_identity_verification_authority.sql`
- `appliedNow=true`
- `checksumVerified=true`
- applied at `2026-08-22T12:00:38.253Z`

This migration is schema/evidence creation only. It is not cohort remediation.

## Centralized verified-client authority

PR #416 adds:

`src/services/clientVerifiedIdentity.js`

One centralized resolver now owns verified-client authority for CRM onboarding and Booking/Admin consumers.

Authoritative contract:

1. Exact-phone uniqueness is candidate selection plus duplicate/contact-conflict protection. Exact phone is not identity proof.
2. Explicit verification evidence is verified-client authority.
3. A valid persisted controlled-Juvan binding remains an independent explicit authority; drift/conflict fails closed.
4. `goldie_import` without independent authority/history resolves to `claim_required`.
5. Historical imported clients without explicit authority resolve to `historical_unverified` / stronger or human verification rather than silent claim.
6. Provisional records remain unverified.
7. Multiple active clients on an exact phone are ambiguous and fail closed.
8. No match follows normal registration.
9. Imported source/name/DOB/gender/history/profile completeness/contact type/`verified_at` alone are not verified-client authority.

## CRM onboarding contract

The old imported-contact name-verification path is retired.

For an imported exact-phone candidate the live contract now:

- preserves the existing canonical client ID;
- preserves `clients.source` and all import/reconciliation provenance;
- does not disclose or compare imported address-book `display_name`;
- does not seed imported DOB or gender;
- collects canonical registration data afresh;
- creates explicit verification evidence only after successful governed onboarding;
- re-resolves old pre-authority onboarding sessions under the new authority so previously seeded imported values cannot silently become authority;
- locks and inspects all matching mobile/WhatsApp contacts before completion;
- records explicit `client_identity_verifications` evidence, sanitized evidence reference, `client.identity_verified` audit evidence, and onboarding authority version on successful governed completion.

Historical imported clients lacking sufficient independent authority fail closed to stronger/human verification.

## Booking & Admin UX shared-contract consumption

Booking/Admin is now a required consumer of the CRM resolver rather than a parallel identity authority.

The compatibility entry point `resolveClientByWhatsApp` returns legacy `status='unique'` only after the centralized resolver establishes `verified_client` authority.

Therefore both:

- `clientBookingIdentityGate`
- `clientBookingCommit`

inherit the same centralized verified-client decision.

The transition welcome also consumes the centralized resolver, removing another unique-phone/profile-completeness trust path.

No parallel profile-completeness identity rule is authoritative after PR #416.

## Controlled Juvan preservation

Existing controlled-Juvan semantics remain intact.

Production startup independently reverified migration:

`072_client_onboarding_controlled_demo_phone_ambiguity.sql`

with:

- `applied=false`
- `checksumVerified=true`
- binding state `bound`
- current pointer preserved
- approval contract preserved as assigned practitioner Primary + Jean-Pierre Backup + first terminal decision wins.

PR #416 does not weaken or replace the controlled-Juvan identity lifecycle.

## Production deployment verification

Render auto-deploy:

- deploy: `dep-da4ouhdckfvc73cnn8hg`
- trigger: `new_commit`
- exact commit: `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`
- status: `live`
- finished: `2026-08-22T12:00:51.449682Z`

No manual duplicate deploy was triggered.

Bounded startup/runtime evidence independently confirms:

- checkout of exact `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`;
- Node `24.14.1`;
- `npm ci` completed and reported zero vulnerabilities;
- build successful;
- migration 074 applied/checksum-verified;
- migration 072 remained checksum-verified and unapplied;
- controlled Juvan remained bound;
- Google Calendar provider health check passed;
- `Shiloh started` logged successfully;
- repeated `/health` HTTP 200 from the new instance;
- bounded post-cutover error-level log query returned no error logs.

No genuine onboarding, booking, CRM identity mutation, Calendar event, or WhatsApp journey was manufactured merely for verification.

## Completed / do not redo

The following are complete and must not be repeated merely for evidence:

- PR #416 implementation;
- CI #1269 / 881-pass regression;
- migration 074 production application/checksum verification;
- Render deploy `dep-da4ouhdckfvc73cnn8hg` verification;
- Q1–Q11 imported-contact audit;
- migration 072 repair / PR #399;
- PR #395 Calendar conflict classification;
- controlled-Juvan revalidation in the #416 startup window.

Also do not:

- bulk remediate the 794 Goldie-import cohort;
- bulk delete/merge/archive/rename/rewrite imported clients;
- trust-backfill historical records;
- manually alter the four `verified_at` proxy/anomaly rows;
- perform a Linda display-name lookup or mutation;
- weaken exact-phone duplicate/contact-conflict protection;
- rerun Q1–Q11 merely for reconciliation;
- manufacture appointments, Calendar events, onboarding sessions, or WhatsApp journeys for proof.

Linda exact-phone trace remains `BLOCKED — NO PHONE ANCHOR` and is outside this completed unit.

## Historical remediation boundary

Do **not** perform bulk historical verification remediation now.

The accepted strategy is prospective: genuine governed onboarding creates explicit verification evidence under the new authority.

Any future proposal to remediate/backfill historical imported clients is a separate Control decision requiring new evidence, explicit scope, risk analysis, and authorization.

## Reconciliation result

The implementation is accepted as **COMPLETE / VERIFIED LIVE**.

The former `CRM-VERIFIED-CLIENT-AUTHORITY — READY / AUTHORIZED` state is superseded by this completion evidence and should be represented as **VERIFIED LIVE / COMPLETE** in the shared ledgers.

Current overall application authority at this completion boundary is PR #416 / `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`, while PR #399 and PR #395 remain durable bounded authorities for their own behavior.

Unrelated newer work, including open PR #415 for the Goldie exact-source-first description policy, is not part of this reconciliation and must remain untouched.

## Next owner

**None — controlled unit complete.**

Future natural onboarding may create new explicit identity-verification evidence under normal business operation. That is not a project gate and must not be manufactured for verification.