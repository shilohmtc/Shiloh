# Shiloh OS — Reconciliation — Imported Contact Book vs Canonical CRM Identity


> Historical record. As of 14 October 2026, automated WhatsApp routing is retired and the dormant language/onboarding/booking-gate modules mentioned below are removed. Retained canonical identity helpers still support My Shiloh and current booking flows. Use [SHILOH_PLATFORM_HANDBOOK.md](SHILOH_PLATFORM_HANDBOOK.md) for current runtime boundaries.
Date: 2026-08-22
Owning audit/implementation workstream: **CRM & Identity**
Required shared-contract consumer: **Booking & Admin UX**
Production evidence observer: **Production & DevOps**
Shared-state owner: **Control & Reconciliation**
Status: **AUDIT COMPLETE / IMPLEMENTATION AUTHORIZED / APPLICATION DEFECT OPEN**
Risk: **HIGH — identity integrity / privacy / historical-record association / consent**

## Scope

This reconciliation closes the read-only production audit **AUDIT — Imported Contact Book vs Canonical CRM Identity**, ratifies the shared verified-client authority contract, and opens the bounded implementation gate for CRM & Identity.

It does **not** implement the schema/application repair and does **not** authorize bulk production CRM remediation, deletion, merge, rename, archive, trust backfill, or manual alteration of the four `verified_at` proxy/anomaly records.

## Newer authority preserved

The handoff's repository baseline was stale. Independent Control verification established current GitHub `main` before this reconciliation as `ed35cf92e426737f5de91c18c8f279cc029e459f`, the documentation-only PR #412 merge.

Current accepted application behavior before this reconciliation is **PR #409 / `696a2c669a3de7b21f8119f0786c707974c30ffd`**, *Remove legacy Admin command-dump fallback*. PR #409 is unrelated to the CRM identity audit and remains preserved.

Bounded durable authorities also remain unchanged:

- PR #399 / `26ace1027e10f40e41d0f5d981e72f4a55a972c6` remains the durable authority for the migration-072 CRM onboarding `normalized_phone` ambiguity repair. Migration 072 is COMPLETE / DO NOT REDO.
- PR #395 / `485ed97d8812fc291c71493dd1bb652b5da42f05` remains durable authority for practitioner Google Calendar conflict classification.
- PR #410/#412 are documentation/reconciliation lineage for the #409 Admin fallback unit and do not alter CRM identity semantics.
- All unrelated Booking/Admin, Meta/provider, Goldie, catalogue, attendance and standing fail-closed gates remain preserved.

## Production evidence gate — COMPLETE

The earlier blocker recorded in `docs/SHILOH-OS-RECONCILIATION-2026-08-22-IMPORTED-CONTACT-BOOK-DB-EVIDENCE-GATE.md` is now closed for this audit.

Production evidence snapshot:

- `2026-08-22 11:11:35.088085 UTC`
- `2026-08-22 13:11:35.088085 SAST`

Read-only safety evidence:

- production Postgres: `shiloh-memory`;
- external source restricted by database-specific allowlist to one trusted `/32` source under PR #411 authority;
- authenticated PostgreSQL connection negotiated **TLSv1.3**;
- observation transaction explicitly verified `transaction_read_only = on`;
- CRM & Identity's approved exact Q1–Q11 evidence pack executed unchanged;
- transaction ended with `ROLLBACK`;
- no `INSERT`, `UPDATE`, `DELETE` or DDL;
- no CRM, appointment, Calendar, WhatsApp, Render configuration/environment or application mutation;
- no full normalized-phone values were recorded in audit evidence.

The project-lifetime single-IP Render PostgreSQL allowlist remains governed by PR #411: keep it narrowly restricted to one trusted source address, keep TLS mandatory, and remove/verify closure at final Shiloh OS project closure. Audit completion does not itself revoke that separately approved project-lifetime access rule.

## Current production findings

The approved production evidence pack established:

- **794** active clients with `clients.source='goldie_import'`.
- **776** have at least one current mobile/WhatsApp phone.
- **553** have no appointment history; all 553 have a phone.
- **241** have appointment history, covering **530** appointment rows.
- Derived: **223** have both a phone and appointment history.
- Derived: **18** have appointment history but no current mobile/WhatsApp phone.
- **776** imported-origin normalized-phone groups resolve to exactly one active canonical client.
- **0** imported-origin normalized-phone groups resolve to more than one active canonical client.
- **3** imported clients currently carry a WhatsApp contact.
- **4** imported clients have `verified_at` contact proxy/anomaly evidence.
- **0** imported clients have `client_onboarding_sessions.state='complete'`.
- Q11 found no durable identity/onboarding/contact/claim/registration audit action for this cohort; the only observed action was unrelated `admin.demo_booking_verified_for_cleanup`.
- Latest Goldie import batch is **ID 3 / completed**; requested aggregate metadata fields are absent and must not be manufactured.

### Linda boundary

The Linda exact-phone trace remains **BLOCKED — NO PHONE ANCHOR**.

No `Linda Dr` or display-name lookup was performed or authorized. A personal address-book label is not an identity key and must not be used to infer canonical name, identity, registration, consent, DOB, gender, guardian status or ownership.

The Linda-specific trace remains an evidence gate only for that case; it does not block implementation of the system-wide verified-client authority repair proven necessary by the completed cohort audit and current application inspection.

## Authoritative interpretation

Control ratifies the CRM & Identity audit interpretation:

1. `goldie_import` / contact-book provenance is **not verified Shiloh identity**.
2. Exact-phone uniqueness is candidate selection and duplicate/conflict protection; it is **not** proof of identity, completed registration, consent, canonical name, DOB, gender or guardian status.
3. The **553** active imported records with phone and no appointment history form the current imported-contact-only/no-history cohort under this evidence snapshot.
4. The **223** phone-bearing imported records with history are historical imported clients that require safer identity reconciliation; appointment history must be preserved but is not identity proof.
5. The **18** imported records with appointment history and no current mobile/WhatsApp phone have no ordinary phone-claim path and require separate stronger/human verification if identity work is later required.
6. **Zero** imported-origin records are authoritatively proven by current durable evidence to have completed genuine WhatsApp onboarding. This does not prove what happened historically; unknown historical reality must not be inferred.
7. The four `verified_at` records are proxy/anomaly evidence only and must **not** be grandfathered into verified-client authority merely because the timestamp exists.
8. `clients.source`, contact type, profile completeness, display name, DOB/gender, `verified_at`, and appointment history are each insufficient by themselves to establish verified client identity.

## Current application defect — independently confirmed on current main

Control inspected current `main` and confirmed that live application logic still violates the newly ratified authority:

### `identityOnboardingGuard`

- `findImportedUnverifiedClient()` treats an imported row with an existing WhatsApp contact as `verified`.
- imported client DOB/gender are copied into a new onboarding session by `startImportedClientClaim()`.
- `guardActiveNameConfirmation()` compares claimant input against existing `clients.display_name` through `namesCompatible()`.
- a successful imported-name match can promote a mobile contact to WhatsApp and set `verified_at` through `persistVerifiedWhatsAppClaim()`.

This incorrectly allows a personal address-book label/demographic record to participate in identity proof and claim promotion.

### `clientIdentityOnboarding`

- `resolveClientByWhatsApp()` resolves active mobile/WhatsApp contacts by exact normalized phone.
- `profileComplete()` treats name + mobile + DOB completeness as registration completeness.
- `processClientIdentityMessage()` returns `matched_complete` for one exact-phone client whose profile is complete.

This incorrectly conflates unique-phone/profile completeness with verified-client authority.

### Booking & Admin UX consumers

`clientBookingIdentityGate.bookingIdentityStatus()` independently accepts `identity.status === 'unique' && profileComplete(identity.client)` as booking-ready `matched_complete`.

`clientBookingCommit.resolveCommitContext()` independently uses the same unique-phone + profile-complete condition before appointment creation.

The identity-authority repair is therefore cross-workstream by contract: CRM & Identity owns the resolver and schema semantics; Booking & Admin UX must consume the same verified-client resolver and must not retain an independent weaker rule.

## Ratified verified-client authority contract

Control approves the following shared contract as Shiloh OS authority for implementation:

1. Preserve `clients.source` and all original import evidence in `import_batches`, `external_records`, `external_client_records`, reconciliation history and other existing provenance/audit surfaces. Provenance is immutable evidence, not verification authority.
2. Add durable **explicit client/contact verification evidence** using the repository's actual schema/conventions in the next available forward migration. Do not edit migration 072 or any historical applied migration.
3. Centralize one verified-client resolver owned by CRM & Identity. CRM onboarding and Booking/Admin must consume the same resolver/contract rather than independently infer authority.
4. `imported_contact_unverified` behavior:
   - exact phone may select one candidate while preserving duplicate/conflict protection;
   - do not disclose or compare the imported address-book label as identity proof;
   - do not seed imported DOB/gender into claimant onboarding;
   - collect canonical registration data afresh from the claimant;
   - preserve the same canonical client ID and original import provenance when a guarded claim can be completed safely.
5. Historical imported clients:
   - appointment/history is not identity proof;
   - preserve all history and canonical linkage;
   - use stronger independent/human verification when identity cannot be established safely without relying on imported attributes.
6. Ambiguous phone ownership, conflicting verification evidence or unresolved historical identity fails closed for human review.
7. No match follows normal new-client registration.
8. Preserve exact-phone duplicate/conflict protection. The repair changes what constitutes **verified authority**; it does not permit uncontrolled duplicate client creation.
9. `verified_at`, `contact_type`, profile completeness, `clients.source`, display name, DOB/gender and appointment history alone must never be sufficient verified-client authority.
10. Do not infer identity, consent, guardian status, canonical name, DOB or gender from Christel's/personal imported address book.
11. Do not bulk delete, merge, archive, rename, rewrite or backfill trust during the first implementation unit.
12. Do not manually alter or grandfather the four `verified_at` proxy/anomaly rows under this approval.

## Authorization decision

**APPROVED — Shiloh OS verified-client authority change.**

Imported personal-phone/contact-book data, `clients.source`, display name, DOB, gender, appointment history, profile completeness, contact type and `verified_at` alone are not sufficient verified identity authority.

Preserve exact-phone uniqueness as candidate-selection and duplicate/conflict protection. Add durable explicit client/contact verification evidence in a forward migration; collect imported claimants' canonical registration data afresh without comparing against or seeding imported labels/demographics; preserve existing canonical client IDs and all original import provenance; fail closed on historical or conflicting identity where independent verification is insufficient; require Booking & Admin UX to consume the same verified-identity resolver.

This approval authorizes the bounded **application/schema implementation, focused tests, full applicable non-mutating regression, CI, PR, merge and normal Render deployment verification** by CRM & Identity, with Booking & Admin UX as a required shared-contract consumer.

This approval explicitly **does not authorize**:

- bulk production CRM record remediation;
- deletion, merge, archive or rename of imported clients;
- mass rewriting of names/DOB/gender/contact records;
- trust backfill/grandfathering based on current fields;
- manual alteration of the four `verified_at` proxy/anomaly rows;
- Linda-specific record mutation or display-name identity resolution;
- weakening duplicate/conflict protection.

Any later cohort remediation/data-cleanup plan is a separate production-data mutation unit requiring its own evidence, design and authorization.

## Implementation priority and ownership

Priority: **DO NOW**, ahead of further onboarding expansion and lower-priority CRM catalogue/drafting work.

Why: the current live code can grant registered/booking authority from imported personal address-book data using name/demographic/profile-completeness signals that are not verified identity. That is a direct identity-integrity/privacy risk at both onboarding and booking boundaries.

Owning implementation workstream: **20 — CRM & Identity**.

Required consumer/dependency: **10 — Booking & Admin UX** must adopt the centralized verified-client resolver for booking identity gate and final commit. Booking/Admin must not create a parallel or weaker identity rule.

Production & DevOps: deployment/runtime observer only unless a genuine production capability gate appears.

Control & Reconciliation: shared-contract reconciliation and final cross-workstream authority observer; not implementation owner.

## Required implementation boundary

CRM & Identity should execute one bounded unit:

`current authority → schema/verification-evidence design using actual conventions → forward migration → centralized verified-client resolver → CRM onboarding integration → Booking/Admin consumer integration → focused regressions → full non-mutating regression → CI → merge → exact Render deploy/startup verification → safe production verification → Tracker/Master reconciliation → final checkpoint`

Minimum regression coverage should prove:

- imported unique-phone/profile-complete record is not automatically `matched_complete`/booking-ready;
- imported address-book display name is not disclosed/compared as claim authority;
- imported DOB/gender do not seed claimant onboarding;
- exact-phone candidate selection and duplicate/conflict guards remain intact;
- guarded claim preserves the same canonical client ID and provenance when verification completes;
- historical imported records preserve appointment/history and fail closed when stronger verification is required;
- explicit durable verification evidence is the positive authority source;
- `verified_at`, contact type, profile completeness, source or history alone cannot grant authority;
- Booking/Admin gate and final commit use the same centralized resolver;
- ordinary already-verified clients retain the existing-client journey;
- no match retains normal registration;
- controlled Juvan identity/reset/rebind semantics and migration 072 protections remain intact.

Do not manufacture a real Linda claim, real client registration, booking, Calendar event or provider mutation merely for verification if bounded automated/production-safe evidence can prove the contract.

## Completed / do not redo

- Read-only imported-contact cohort audit and Q1–Q11 evidence collection are complete.
- Production TLS/read-only evidence gate for this audit is complete.
- Do not rerun Q1–Q11 merely for reconciliation.
- Do not reuse the old 2026-08-16 counts.
- Do not redo migration 072 / PR #399.
- Do not redo PR #395 Calendar conflict classification.
- Do not resolve Linda by display name.

## Remaining gates

- **System-wide verified-client implementation:** authorized and ready; owned by CRM & Identity.
- **Linda exact-phone trace:** remains blocked until a legitimate exact-phone anchor is supplied. This is not permission to search by display name.
- **Bulk cohort remediation:** not authorized by this decision; separate future unit if needed after the live authority defect is repaired.
- **Project-lifetime Postgres `/32` allowlist removal:** mandatory at final Shiloh OS project closure under PR #411 authority.

## Final routing

Next specialist: **20 — CRM & Identity**.

CRM & Identity owns the authorized schema/application repair. Booking & Admin UX is a mandatory contract consumer for the booking identity gate/final commit. Return durable verified implementation evidence through the normal specialist reconciliation protocol; escalate to Control only for contradictory authority, material scope/risk expansion, or cross-workstream contract dispute.