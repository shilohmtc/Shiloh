# Shiloh OS — Master Project Status

Updated: 2026-09-19
Purpose: permanent current-state source of truth. Historical implementation detail remains in Git history and dated reconciliation files; do not redo accepted or superseded work.

## Current Shiloh-first baseline — 2026-09-19

This short-form baseline supersedes older wording that calls an earlier pull request “current”. The detailed August ledger below is preserved as historical evidence and must not be discarded or replayed.

- **Shiloh-first operating model:** WhatsApp is the front door, My Shiloh is the client home, and Shiloh AI is the shared experience backbone. Canonical services remain the authority for identity, bookings, availability, forms, payments, permissions and audit history.
- **Current application baseline before this reconciliation:** PR **#1042** / `b781a5a6b4ea94387b5bb4803cecbd8ca074159d`, *Add authenticated My Shiloh consultation-form action*.
- **Production:** Render deploy `dep-dan3k817lnhs73dr1f10` reached **LIVE** on that exact application commit. The relevant GitHub workflows passed, all 137 tracked migrations matched the production ledger, and the bounded post-deploy window showed no application errors.
- **My Shiloh verified live:** PWA foundation (#1032), WhatsApp-backed sign-in (#1034), website entry points (#1035), shared authenticated context/orchestrator (#1037), in-app Shiloh conversation (#1038), five typed read tools (#1039), confirmed cancellation (#1040), confirmed reschedule request (#1041), and authenticated consultation-form action (#1042).
- **Typed read tools actually live:** `get_my_next_appointment`, `get_my_upcoming_bookings`, `get_my_form_status`, `get_my_payment_status`, and `find_available_slots`. Package-status and voucher tools remain planned; documentation must not describe them as live before implementation and verification.
- **Confirmed actions:** AI may prepare; the authenticated client UI requires explicit confirmation where consequential; canonical domain authority revalidates and executes. Reschedule requests do not move the appointment until practitioner approval. Linked/group cases continue to fail closed where the existing authority does not safely support them.
- **Consultation forms:** secure assignment, delivery, reminder, client completion and protected staff review are live. The exact Meta form and reminder templates are APPROVED / UTILITY / duplicate-free.
- **Payments:** the provider-independent ledger, ordinary and linked/group balances, split payments, discounts without a mandatory reason, manual cash/card/EFT capture, refunds, verified callbacks, return pages and WhatsApp payment receipts are implemented. Ozow production callback configuration and a controlled low-value live transaction remain the next provider proof. Apple Pay/Google Pay depend on separate Ozow Card Payments activation; they do not invalidate the provider-independent foundation.
- **Next controlled sequence:** reconcile governance documents and clearly superseded PRs; complete a real normal-account My Shiloh acceptance journey; then run the controlled low-value Ozow production proof. After that, add contextual WhatsApp → My Shiloh actions before expanding package/voucher tools.

## Authority and continuation protocol

Operational truth is GitHub `main`, Render production, Shiloh CRM/Postgres, Google Calendar, Meta/WhatsApp provider evidence, and explicit real WhatsApp/human evidence. Never infer provider approval, attendance, approval decisions, CRM identity, Calendar state or handset behaviour.

At the beginning of each new Shiloh OS chat: read this Master + `docs/SHILOH-OS-PROJECT-TRACKER.md` + the latest reconciliation, currently `docs/SHILOH-OS-RECONCILIATION-2026-08-22-VERIFIED-CLIENT-AUTHORITY-IMPLEMENTATION-COMPLETE.md`, plus `docs/SHILOH-OS-ENGINEERING-GOVERNANCE.md`, on current GitHub `main`; verify production/provider/CRM/Calendar/human evidence that could have changed; preserve newer authority; then continue only the owned controlled scope.

Earlier dated reconciliations remain durable where not superseded. Preserve in particular `docs/SHILOH-OS-RECONCILIATION-2026-08-22-VERIFIED-CLIENT-AUTHORITY-IMPLEMENTATION-COMPLETE.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-22-IMPORTED-CONTACT-BOOK-CANONICAL-CRM-IDENTITY-AUDIT.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-22-IMPORTED-CONTACT-BOOK-DB-EVIDENCE-GATE.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-22-CRM-ONBOARDING-NORMALIZED-PHONE-AMBIGUITY.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-21-PRACTITIONER-CALENDAR-CONFLICT-CLASSIFICATION.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-21-GOLDIE-DESCRIPTION-BUSINESS-APPROVAL.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-CLIENT-COUPLES-AND-PACKAGES.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-ABIGAIL-JAW-RELEASE-MAPPING.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-ADMIN-UX-STANDARDIZATION.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-BOOKING-ADMIN-JUVAN-PRIMARY-BACKUP-AND-MANAGE-CANCEL.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-CONTROLLED-JUVAN-DEMO-IDENTITY.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-DUMMY-TEST-BOOKING-CLEANUP.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-ADMIN-BLOCK-TIME.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-CRM-DUMMY-RESET-COMPLETION.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-CURRENT-MAIN-356.md`, the Christel service-catalogue correction, specialist-workstream and Control-routing reconciliations, booking-confirmation-v2 controlled submission, Juvan booking approval/v1 handset proof, client-welcome repair, booking-update activation/stale suppression, Meta booking-update approval and all explicit fail-closed gates.

Obtain explicit approval before the first new substantial controlled action. After that approval, continue the approved controlled unit through normal engineering/deploy/verification/reconciliation boundaries. Stop for material scope/risk expansion, contradictory authority, or a genuine fail-closed human/provider/evidence/safety/capability gate.

## Historical production baseline — 2026-08-22 (preserved)

Current accepted **application** code is **PR #416 / `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`**, **Implement verified-client identity authority**. It implements the PR #413 ratified verified-client contract across CRM onboarding and Booking/Admin, while preserving PR #409 Admin presentation behavior, PR #399 CRM normalized-phone ambiguity repair, PR #395 practitioner Calendar conflict classification, PR #388 guarded Juvan booking cleanup, PR #387 provider-log redaction, PR #385 Meta-template reconciliation, PR #383/#384 booking-confirmation-v2 activation/evidence, PR #382 reschedule-template activation and the accepted #380 Couples Massage lineage.

- Final PR #416 GitHub Actions CI **#1269**, workflow run **32571765659**, job **97028094203**, passed on Node **24.14.1** with **881/881** tests, **0 failed**, **0 cancelled** and **0 skipped**. Initial #1268 exposed one stale source-shape assertion in migration-072 regression coverage; the test was updated to assert the new stronger exact-phone locking behavior without weakening authority.
- PR #416 production auto-deploy **`dep-da4ouhdckfvc73cnn8hg`** reached **LIVE** on exact merge SHA `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`, finishing `2026-08-22T12:00:51.449682Z`. Startup applied/checksum-verified migration 074, left migration 072 checksum-verified/unreplayed, preserved controlled Juvan BOUND state and approval semantics, logged **Google Calendar provider health check passed**, logged `Shiloh started`, and returned repeated `/health` HTTP 200. The bounded post-cutover error query returned no error-level logs.
- Migration **074_client_identity_verification_authority.sql** is production-applied/checksum-verified and creates explicit client/contact verification evidence plus onboarding authority-version evidence. It performs **no trust backfill**, does not grandfather imported clients, does not convert existing `verified_at` proxy/anomaly rows into authority, and does not edit migration 072 or historical applied migrations.
- #416 changes verified-client authority at CRM/Booking identity boundaries. It does not alter #409's unrecognized authenticated Admin presentation rule: the legacy raw command dump remains replaced with `I didn't recognise that admin request. Send *Menu* to open Shiloh Admin.` Existing guarded Admin commands, authorization, audit and active booking/date routing remain unchanged.
- No real client onboarding, booking, CRM identity, Calendar event or WhatsApp journey was manufactured merely for #416 verification.
- PR #399 / `26ace1027e10f40e41d0f5d981e72f4a55a972c6` remains the durable authority for the migration-072 CRM onboarding normalized-phone ambiguity repair. Its CI #1236, 860/860 regression and exact deploy `dep-da4me5qd0e5s73bobfm0` remain accepted evidence for that bounded repair; #416 does not alter it.
- PR #395 / `485ed97d8812fc291c71493dd1bb652b5da42f05` remains the durable authority for practitioner Google Calendar conflict classification. Its CI #1228, focused **30/30**, full **856/856**, and production deploy `dep-da4a75lckfvc738ghpmg` remain accepted evidence for that bounded rule; #416 does not alter it.
- Provider credential rotation is complete. The post-revocation verification deploy `dep-da47v6n40ujc73d1qeug` reached LIVE on documentation-only PR #389 / `ae3825925277205512a4db0d9e13964fb3e79ea5`; the dedicated Meta system user `Shiloh` owns the final production-only token with exactly `whatsapp_business_management` and `whatsapp_business_messaging`; all former generic `Employee` tokens are revoked. Root/health and Meta provider checks passed in that verified window, which contained zero errors and zero credential values. #416 does not reopen credential rotation.
- Production migration **070_couples_massage_self_service.sql** applied and checksum-verified.
- Production service **#66 `Couples Massage`** is active in canonical Massage at **90 minutes / R1080**, with no hidden processing/extra-time buffer.
- Exact Couples Massage practitioner mappings are **Abigail staff #1 + Christel staff #3**, both active/client-bookable; unexpected extra mappings fail closed.
- Appointment companion contact authority is `booking_backup` with `marketingConsent=false`; this does not establish a general CRM contact identity or marketing consent.
- Migration 069 remained checksum-valid; service #31 `Upper Back, Neck & Jaw Release` remains active, Abigail remains `abigailMapped=false`, Christel remains the active/client-bookable mapping, and 13 linked appointments remain preserved.
- #416 startup reverified migrations 065/066/067/068/072 as checksum-valid and Juvan controlled identity as **BOUND** to the current canonical pointer, presently client **845**, display `Juvan Botha`, controlled phone suffix **1564**, Jean-Pierre admin **4**. Migration 072 was not replayed; historical client 845 remains a current pointer rather than a permanent identity key.
- Current Juvan approval contract remains `assigned_practitioner_primary_jean_pierre_backup_first_decision_wins`.
- Practitioner-approved client rescheduling is **enabled in production** through configuration-only activation deploy `dep-da433gbncjis73aucgv0`; startup verified `featureEnabled=true`, both exact template names configured, migration 064 checksum-valid and its required request-table indexes present. No application-code change was required.
- The previously completed Dummy Test booking cleanup remains complete and `CRM_DUMMY_APPOINTMENT_CLEANUP_ON_START=false` remains the normal inert state.

Relevant accepted runtime lineage remains:

- **#337** — universal client-welcome repair, genuine handset-proven.
- **#338 / merge `31d49d27a74c570fb439bee62c9647275bf97f6b`** — historical hardened multi-test-client reset safeguards used by the completed Dummy Test reassignment; reusable multi-target eligibility is superseded by #364.
- **#350** — persisted Juvan→Jean-Pierre booking-approval policy that supplied the verified pre-#364 canonical anchor.
- **#352** — genuine booking #585 proves the historical JP-sole Juvan approval behavior, one final v1 confirmation after approval and matching shared/Christel Calendar mirrors.
- **#353** — specialist-chat lifecycle operating convention.
- **#354** — client self-service reschedule start-boundary guard.
- **#355** — practitioner-approved reschedule success confirmation with durable retry/claim/suppression.
- **#356** — exact Meta approval-request/decline transport contracts and fail-closed runtime gate. The 2026-08-21 provider approval and production activation closed its former external block without changing application code.
- **#358** — historical CRM reset structured-interaction language-boundary repair used in the completed Dummy Test journey.
- **#359** — documentation/reconciliation of completed CRM Dummy Test reassignment and genuine fresh-identity handset proof.
- **#360** — guarded practitioner Block time / Blocked time workflow using canonical `calendar_blocks`.
- **#362** — exact archived/reset Dummy Test booking cleanup, default-off one-shot with CRM/Calendar proof and no client messaging.
- **#364** — reusable-demo identity authority: exact phone-anchored Juvan controlled identity, JP-only reset, transactional UNBOUND state and normal-onboarding rebind to the current canonical client/policy pointer.
- **#366 / `53b5e0c4027f9910291f75c05ec13d9c55528118`** — current Juvan booking approval semantics: assigned practitioner Primary, Jean-Pierre Backup, atomic first decision wins; JP-only Reset Juvan menu presentation; CI #1164 passed 796/796; migration 068 production-applied/checksum-verified.
- **#367 / `9219bdef30e5452bc225a86d4f644d76149b528d`** — first-class guarded Cancel booking action inside Manage booking, delegated to the canonical cancellation state machine; CI #1166 passed 800/800. #380 later hardens the same cancellation owner for multi-staff appointments without removing reason/confirmation gating.
- **#370 / `b6a72b1e1bc02cc484805285b3b7cb2d3961088c`** — bounded execution / anti-thrashing governance: preserve already completed inspection, stop redundant read-only loops, and move directly to the artifact/result or a specific proven blocker.
- **#371 / `75f58950c86b2afbcc0bdb25240c4b4eeac1a188`** — Admin UX standardization layer, Body Treatments presentation grouping, concise action/section copy and `Cancel new booking` for the new-booking escape path.
- **#372 / `3e945a1d7ede45b82bb16c92cc5c8c73b11381c0`** — completes `Cancel new booking` presentation at the final pending-new-booking confirmation without changing existing-appointment cancellation.
- **#373 / `afbd6cde6bd338422bca6a9223c7a2a023b660d9`** — keeps `Shiloh Admin 🌿` and personalized welcome while replacing redundant landing prompts with `What would you like to manage today?`; CI #1177 successful; presentation authority remains current beneath later catalogue/navigation changes.
- **#375 / `6337ba701f1bc3e534219ec20c5dd20d5dce837b`** — guarded migration 069 for the exact Abigail/service #31 practitioner-mapping correction; CI #1181 successful.
- **#376 / `5e187c6b531881d82ea1bfe1840b0b891d11518f`** — checksum-tracked startup application and explicit post-state verification of migration 069; CI #1183 successful.
- **#378 / `aa7f692b35bc7acaafbea74d45f752c2b99a886d`** — established current Couples & Packages client navigation and preserved the canonical Sports Massage Package authority; its assisted-only Couples placeholder is superseded by #380.
- **#380 / `2e387e5f1000774d97046a516c1c7d19e93cd947`** — accepted Couples Massage lineage: canonical service #66, 90 min/R1080, exact Abigail+Christel simultaneous availability and atomic booking, appointment-scoped companion backup contact/no marketing, dual-practitioner Calendar safety and multi-staff cancellation hardening; CI #1196 successful.
- **#387 / `8e124ec8a06183576db67ce6e3b27eca28b7d85e`** — provider credential log redaction; CI #1212 passed 835 tests. The former external rotation gate is now closed by the verified dedicated-system-user rotation and old-token revocation.
- **#388 / `e4833a743945db63b8cce3731d593f76c9f17921`** — optional JP-only guarded Juvan booking cleanup before identity reset: exact current-pointer preview, canonical non-final cancellation/history/audit, related-state terminalization, no customer messaging, shared/all-practitioner Calendar cleanup, partial-state retry and identity-release gating; CI #1214 passed.
- **#395 / `485ed97d8812fc291c71493dd1bb652b5da42f05`** — durable practitioner Google Calendar conflict classification: unrelated practitioner events no longer act as clinic-wide conflicts; shared/clinic-wide and relevant assigned-practitioner conflicts remain blocking; focused tests 30/30, full regression 856/856 and CI #1228 passed. PR #396 / `9bd3251122475d9b2b36fffa2408b8e95d442bfc` is the documentation-only dated reconciliation; CI #1230 passed.
- **#399 / `26ace1027e10f40e41d0f5d981e72f4a55a972c6`** — durable CRM onboarding normalized-phone ambiguity repair. Forward migration 072 repairs the migration-067 PL/pgSQL `normalized_phone` identifier collision without editing checksum-authoritative migration 067 or weakening controlled Juvan/contact guards; CI #1236 passed 860/860 plus four focused cases; exact Render deploy `dep-da4me5qd0e5s73bobfm0` reached LIVE with migration 072 applied/checksum-verified and bounded post-cutover zero-match evidence.
- **#409 / `696a2c669a3de7b21f8119f0786c707974c30ffd`** — bounded Admin presentation authority. Removes only the legacy raw command-dump presentation for genuinely unrecognized authenticated Admin text, preserving guarded Admin commands, authorization, audit and active booking/date routing. Workflow run 32567694026 passed 868/868; exact Render deploy `dep-da4njtlckfvc73cmnk0g` reached LIVE. #416 supersedes it only as overall application baseline.
- **#410 / `560099cdb55260ae045ffa6a2a3cb2cfdb51017b`** — documentation-only reconciliation of #409. Render `dep-da4nrhgjo6nc73fee4sg` reached LIVE with Google Calendar provider health passed, repeated `/health` 200 and root 200; this superseded the earlier transient provider-warning observation without changing application behavior.
- **#416 / `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`** — current overall application baseline. Implements migration 074 + centralized verified-client authority shared by CRM onboarding and Booking/Admin. Final CI #1269 passed 881/881; exact Render deploy `dep-da4ouhdckfvc73cnn8hg` reached LIVE with migration 074 applied/checksum-verified, migration 072 preserved, Juvan BOUND, Calendar health passed, repeated `/health` 200 and no bounded post-cutover error logs.

PR #357 and #359 were documentation/shared-authority reconciliations and did not broaden unrelated application behaviour.

## Engineering governance — 🟢 AUTHORITATIVE

Engineering Governance on current `main` includes:

- **#340** mandatory copy-ready specialist-to-specialist handoffs, direct specialist continuation when ownership/authority are clear, and preservation of fail-closed gates.
- **#353** specialist chat lifecycle convention: no fixed turn threshold; rotate based on practical chat health and preferably at controlled-unit boundaries.
- **#370** bounded execution / anti-thrashing: preserve already completed inspection, stop redundant read-only loops, and move directly to the artifact/result or a specific proven blocker unless a concrete dependency requires further inspection.

Control & Reconciliation coordinates shared state, priorities, ownership, architecture/governance and reconciliation. It does not become a second implementation queue.

The controlled-work sequence remains:

`inspect authoritative state → implement → test/full applicable regression gate → repair until green → merge → verify Render/production/provider → reconcile Project Tracker → reconcile Master when durable state changed → final specialist checkpoint`

## Specialist workstream reconciliation — 🟢 ADOPTED

Reconciliation from specialist branches is part of the same controlled unit, not optional cleanup. Every owning specialist workstream must verify current authority, implement within scope, run the applicable compile/regression gate, repair until green, merge, verify production/provider truth, reconcile the Project Tracker, reconcile the Master when durable foundational state changed, and issue the final specialist checkpoint. A specialist branch must not stop merely because code was merged or deployed. Control & Reconciliation reads reconciled current `main`, not unreconciled specialist-chat narrative.

## Control checkpoint workstream routing — 🟢 ADOPTED

Control checkpoints must identify the owning workstream, exact specialist chat, why that workstream owns the next boundary, dependencies/observers, Proceed or Blocked status, and a self-contained copy-ready continuation. Routing context is never a substitute for independently re-reading authoritative state. Blocked work remains with the appropriate monitoring/provider workstream rather than being routed to implementation, and existing approved fail-closed gates remain binding.

## Provider credential rotation — 🟢 VERIFIED COMPLETE

Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-21-PROVIDER-CREDENTIAL-ROTATION.md`.

The credential exposed in historic Render logs was the Meta WhatsApp Cloud API bearer secret stored as `WHATSAPP_TOKEN`. Legitimate runtime ownership is bounded to the single `shiloh-whatsapp-bot` Render service and its WhatsApp transport/template-verification modules. No credential value is recorded in GitHub, chat or reconciliation evidence.

PR #387 repaired the root logging defect before replacement installation by preventing nested Axios `config`, `request` and `response` objects from being serialized while preserving safe code/status evidence. CI #1212 passed all 835 tests, including frozen PR #385 Meta-template contracts.

Durable provider authority is now:

- Meta business `406573210678288`;
- production app `Shiloh_MTC`;
- production WABA `4002592316709920`;
- dedicated Employee-access system user `Shiloh`, ID `61593365711509`;
- only the production app and production WABA assigned; Test WABA excluded;
- final never-expiring token permissions exactly `whatsapp_business_management` and `whatsapp_business_messaging`;
- only Render secret `WHATSAPP_TOKEN` updated; and
- all tokens belonging to former generic system user `Employee`, ID `61593165503862`, revoked after replacement verification.

Post-revocation Render deploy `dep-da47v6n40ujc73d1qeug` reached LIVE on the then-current documentation-only `main`, PR #389 / `ae3825925277205512a4db0d9e13964fb3e79ea5`. Root and health probes returned 200. Booking-update, cancellation, staff-finalization and booking-confirmation provider checks remained APPROVED, including configured booking-confirmation v2. That verified window contained zero errors and zero Authorization, Bearer, Meta-token-like or `WHATSAPP_TOKEN` values. No real customer message or booking was created. #416 does not reopen credential rotation.

Historic retained log entries were not destroyed. Render exposes no supported individual-entry deletion control; they remain subject to the provider's retention window. Preserve required audit evidence and do not attempt unsupported destructive cleanup.

## Admin practitioner Block time — 🟢 VERIFIED LIVE

Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-ADMIN-BLOCK-TIME.md`.

PR #360 establishes a dedicated WhatsApp Admin availability-blocking capability using the existing canonical `calendar_blocks` primitive rather than manufacturing appointments.

The authority contract is explicit and separate from broad booking entitlement:

- Christel may block **Myself** or **Abigail**.
- Abigail may block **herself only**.
- Marietjie may block **herself only**.
- Jean-Pierre and other Admin identities have **no Block time authority**.
- Missing or ambiguous practitioner identity fails closed. Christel must not guess Abigail when canonical Abigail identity is ambiguous.

The workflow requires date, start time, duration, reason and final review before create. At mutation time it re-resolves authority and rejects overlap with an existing canonical appointment or `calendar_blocks` interval before write. Future Shiloh-created blocks can be viewed, edited and removed; imported/Goldie blocks are not opened to this edit/remove UI.

Existing authoritative availability already excludes overlapping `calendar_blocks`, so committed blocks automatically remove those intervals from both client and Admin slot discovery. Block time does not create or mutate client identity, treatment, appointment, attendance, payment or revenue truth and does not send a client WhatsApp message.

The initial #360 CI run exposed a stale parity regression that assumed Jean-Pierre must always match Christel's Appointments menu except finalization. That test was corrected to preserve the new explicit second exception: Jean-Pierre has neither finalization nor Block time authority. Final CI #1148 passed.

No real block was manufactured for proof; future natural business use may provide handset/CRM evidence without creating artificial operational data.

## Admin Manage booking cancellation — 🟢 VERIFIED LIVE

Authoritative reconciliations: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-BOOKING-ADMIN-JUVAN-PRIMARY-BACKUP-AND-MANAGE-CANCEL.md` and `docs/SHILOH-OS-RECONCILIATION-2026-08-20-COUPLES-MASSAGE-SELF-SERVICE.md`.

PR #367 adds **Cancel booking — Cancel this appointment safely** to the canonical Manage booking menu immediately before Back.

The action is appointment-scoped and restart-safe. Selecting Cancel booking does **not** cancel immediately. The canonical flow requires a reason and explicit `Confirm cancellation` before mutation. While a cancellation intent is pending, its reason/Confirm/Back continuation takes precedence over the still-open Manage booking session.

The new-booking presentation separately calls its discard action **Cancel new booking** through #371/#372; this does not overload existing-appointment cancellation.

#380 extends cancellation safety for the new legitimate multi-practitioner appointment shape. At final mutation the Admin cancellation owner loads every assigned practitioner, obtains stable-order advisory locks for all assigned staff, rechecks the appointment, commits the canonical cancellation/history/audit state, then removes the shared Google event and all practitioner Calendar mirrors. It does not weaken the #367 reason/confirmation boundary.

Client cancellation of a multi-staff appointment is also intercepted at explicit final confirmation, locks all assigned practitioners and clears shared + practitioner mirrors. Ordinary single-staff client cancellation remains on the pre-existing canonical path.

No genuine appointment was cancelled merely for #380 proof.

A proposed context-aware post-cancellation return to the same selected Manage Client screen is **not part of #367/#371-#373/#378/#380** and is not current production behavior unless separately authorized and implemented.

## Admin UX presentation standardization — 🟢 VERIFIED LIVE

Authoritative reconciliations: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-ADMIN-UX-STANDARDIZATION.md` and `docs/SHILOH-OS-RECONCILIATION-2026-08-22-ADMIN-LEGACY-FALLBACK-CLEANUP.md`.

PRs #371-#373 standardize only Shiloh-owned WhatsApp Admin presentation while preserving provider-native typography, role/permission boundaries, menu/action IDs and booking mutation semantics.

Current presentation authority:

- stable header: **Shiloh Admin 🌿**;
- personalized greeting: **Welcome back, <Admin> 👋**;
- landing prompt: **What would you like to manage today?**;
- `New booking` instead of `Make a booking`;
- `Manage booking` instead of `Manage a booking`;
- concise standardized section/action descriptions and back-navigation copy;
- `Cancel new booking` for abandoning a pending new-booking journey;
- existing-appointment `Cancel booking` remains the canonical #367 reason + explicit confirmation flow;
- genuinely unrecognized authenticated Admin text uses #409 compact recovery: `I didn't recognise that admin request. Send *Menu* to open Shiloh Admin.` rather than the legacy raw command dump.

The Admin new-booking category previously presented as `Massage & Body` is presented as **Body Treatments**. `Neo Pelvic Therapy`, `Vaginal Tightening & Rejuvenation`, and `Ozone & Far Infrared` are explicitly grouped into Body Treatments using the authoritative service rows already loaded for the Admin booking scope. Existing massage/body services remain in that presentation family. No CRM service rows, service IDs, prices, durations, practitioner mappings, entitlements or public-catalogue authority were changed by #371-#373 or #409, and no second catalogue source was created.

#409 preserves all guarded Admin commands, authorization and the existing `admin.whatsapp_unrecognized_command` audit. Active Admin booking routing remains before the generic fallback, so natural date input during an active booking flow is not converted into an unrecognized-command response. Workflow run 32567694026 passed 868/868; exact application deploy `dep-da4njtlckfvc73cmnk0g` reached LIVE on `696a2c669a3de7b21f8119f0786c707974c30ffd`. #416 does not alter this bounded presentation authority.

## Couples Massage self-service — 🟢 VERIFIED LIVE

Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-COUPLES-MASSAGE-SELF-SERVICE.md`.

#378 remains the navigation lineage: **Couples & Packages** is the first special option inside **Massage Treatments**, with **Couples Massage**, **Sports Massage Package**, then **Back**. #380 supersedes only the earlier assisted-only Couples Massage placeholder.

Current Couples Massage business authority is exact:

- canonical service #66 `Couples Massage`;
- canonical key `shiloh_special / couples-massage-v1`;
- category Massage;
- active;
- 90 minutes;
- R1080 / client display R1,080;
- required practitioners Abigail staff #1 + Christel staff #3, both active/client-bookable;
- one registered lead Shiloh client plus companion name + South African mobile;
- companion mobile is appointment-scoped `booking_backup`, `marketing_consent=false`, and is not inserted into `client_contacts` merely because it was supplied.

The client sees **90 min • R1,080 • Abigail & Christel** before date selection. Shiloh computes the exact future intersection of Abigail and Christel's 90-minute availability. Existing availability owners are reused: clinic hours, authoritative staff schedules/exceptions, CRM appointment conflicts, `calendar_blocks`, shared Google Calendar and each practitioner's Google Calendar.

Review shows service, duration, price, therapists, time, lead client, companion and backup number. Existing Shiloh Booking Policy & Terms acceptance remains mandatory before appointment creation.

Final commit creates one parent appointment, one Couples service snapshot and two `appointment_staff` allocations: Abigail position 1, Christel position 2. It takes stable-order advisory locks for both practitioners and rechecks both immediately before mutation. If either practitioner is no longer available, neither side of the booking is created and the client must select another time.

On success the shared Calendar event and both practitioner Calendar mirrors are created. Calendar side effects are compensated if the guarded commit fails after an external write. Existing booking approval remains authoritative after creation; position-1 Abigail remains the ordinary Primary, and standing Juvan Primary + JP Backup + first-decision-wins authority is unchanged.

The companion number is captured/stored for booking-specific fallback contact only. **#380 does not define or claim an automatic WhatsApp fallback-send trigger when the lead client is unreachable.** Any future automatic fallback messaging requires separately defined trigger, consent and provider semantics.

Existing client self-service reschedule already fails closed when `staff_count != 1`; therefore Couples Massage rescheduling remains assisted until a separately authorized multi-practitioner reschedule design exists. Cancellation is multi-staff safe as described above.

Migration 070 was production-applied/checksum-verified. Final CI #1196 passed. Render `dep-da3l8gtbedkc73dn51e0` reached LIVE on exact #380 SHA, Google Calendar health passed and repeated `/health` returned 200. No real Couples Massage appointment, companion, Calendar event or handset journey was manufactured for proof.

## Client Couples & Packages presentation — 🟢 VERIFIED LIVE LINEAGE

Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-CLIENT-COUPLES-AND-PACKAGES.md`.

PR #378 established the bounded client navigation layer inside **Massage Treatments**. The first special option remains **Couples & Packages**, whose submenu order remains **Couples Massage**, **Sports Massage Package**, then **Back**. Existing ordinary massage treatments remain on their established Massage Treatments pages.

The old #378 assisted-only Couples Massage response is superseded by #380. The canonical Couples Massage service row is intentionally suppressed from ordinary single-practitioner WhatsApp massage lists so the client uses the coordinated Couples & Packages entry path rather than accidentally treating the service as a one-practitioner treatment.

Sports Massage Package continues to use the established canonical package owner:

- slug `sports-massage-monthly`;
- package-session service #65;
- 4 sessions;
- R1400 package price;
- 30-day validity;
- 24-hour cancellation notice;
- existing entitlement, enquiry/status and package-session booking flows.

The submenu derives package summary data from the active canonical package record. If the package is missing/inactive, the Sports package row is omitted rather than fabricated. #380 does not alter Sports package rules.

## Abigail Jaw Release practitioner mapping — 🟢 VERIFIED LIVE

Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-ABIGAIL-JAW-RELEASE-MAPPING.md`.

The business-approved correction is practitioner-scoped: **Upper Back, Neck & Jaw Release must not be offered under Abigail's services**. The canonical treatment itself remains active.

PR #375 added exact guarded migration 069 targeting Goldie external ID `b5c96105-f534-406d-89ec-68e78c65cf8b` and exact canonical name `Upper Back, Neck & Jaw Release`. PR #376 added the checksum-tracked startup application/verification path after the established Christel catalogue bootstrap.

Production evidence establishes:

- migration `069_remove_abigail_jaw_release_mapping.sql` applied and checksum-verified;
- service ID **31** remains active;
- Abigail staff ID **1** has `abigailMapped=false`;
- Christel staff ID **3** is the remaining active/client-bookable practitioner mapping;
- linked appointment count remains **13**;
- canonical service metadata, non-Abigail mappings and appointment-history count were verified unchanged across the correction transaction.

#416 startup reverified this state unchanged. Do not re-add Abigail to service #31 unless a later explicit business decision supersedes this authority.

The sanctioned Render Postgres read-only connector remains blocked by its known SSL/TLS transport defect. No direct pre-change SQL row state is inferred from that failed surface; guarded production startup transactions and explicit post-state are accepted authoritative evidence.

## Dummy Test operational booking cleanup — 🟢 VERIFIED LIVE / COMPLETE

Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-DUMMY-TEST-BOOKING-CLEANUP.md`.

The earlier CRM #835 number-reset deliberately preserved appointment history. The later user-authorized cleanup therefore used a separate exact-client one-shot rather than deleting rows or replaying the reset.

Before any mutation, #362 requires exact client ID **835**, accepted Dummy Test name, inactive status, completed `test_client_reset=true` marker and zero WhatsApp/mobile bindings. The one-shot is default-off behind `CRM_DUMMY_APPOINTMENT_CLEANUP_ON_START`.

Production execution established:

- newly cancelled: **appointment #582** (Abigail) and **appointment #583** (Marietjie);
- preserved as already cancelled: **#561, #565, #566, #574**;
- preserved finalized historical truth: **#564 remains `no_show`**;
- **3** appointment lifecycle rows were terminalized;
- pending booking approvals changed: **0**;
- pending/failed reschedule requests changed: **0**;
- pending/failed customer-change notifications suppressed: **0**;
- all shared/practitioner Calendar cleanup operations completed with `unresolvedCalendarIds=[]`.

Independent 2026-wide searches after execution returned **zero `Dummy Test` events** on the shared booking calendar, Abigail calendar, Marietjie calendar and primary/Christel calendar.

The one-shot flag is now **false** and final #362 deploy `dep-da3dk36k1f9s73em616g` completed the cleanup lineage. Do not re-enable the cleanup merely to reproduce evidence. No client cancellation message was created by this controlled unit.

## CRM Dummy Test number reassignment — 🟢 VERIFIED HISTORICAL / HANDSET-PROVEN / COMPLETE

Authoritative completion reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-CRM-DUMMY-RESET-COMPLETION.md`.

The #338/#358 safeguards remain authoritative **historical evidence for the completed Dummy Test reset**, but #364 supersedes the old reusable multi-target reset eligibility. Chenique and Dummy Test / CRM Dummy Test are no longer active reusable reset identities.

The completed Dummy journey proved:

- pre-confirm actual CRM display name, CRM ID and phone presentation;
- shared-active-client conflict checking before Confirm and transaction-time recheck;
- phone-bound temporary state cleanup;
- WhatsApp/mobile-only release with zero-residual postcondition;
- archive/inactivate rather than delete;
- preservation of appointments and CRM/audit history;
- atomic reset audit;
- genuine post-reset fresh/new-client handset behavior.

A genuine first Confirm attempt at 11:45 SAST exposed an interactive-language routing defect and did **not** execute the reset. PR #358 repaired only that transport boundary and passed full CI 773/0.

After #358 was LIVE, a fresh authorized preview showed exactly:

- **Dummy Test**
- **CRM #835**
- **WhatsApp +27 71 674 2646 — primary**

At **11:59:23.746 SAST**, production received the genuine interactive confirmation. At **11:59:24.417 SAST**, Shiloh sent the reset-complete response after the transaction committed. The committed result archived CRM #835, released exactly one WhatsApp/mobile contact record, cleared the bounded temporary phone state, preserved appointment/audit history and wrote the reset audit event.

At **12:01:27.486 SAST**, the legitimately reassigned number sent a real `Hi` from masked suffix `2646`; at **12:01:28.537 SAST** Shiloh responded with the unregistered/new-client registration branch. The handset response carried no inherited Dummy Test name, CRM #835 identity, booking intent, onboarding continuation, policy state or prior conversation-session context.

No appointment or booking was manufactured. **Do not reset CRM #835 again or replay the reassigned number merely to reproduce proof.** #362 subsequently cleaned only the preserved operational bookings while retaining appointment/audit history and #564 no-show truth.

The Render read-only Postgres connector still fails before SQL execution at the known SSL/TLS boundary. Do not infer direct row evidence from that failed connector; the accepted completion evidence is the guarded transactional runtime semantics, post-commit success response, genuine post-reset first-contact behaviour and the later guarded #362 cleanup startup evidence.

## Controlled Juvan reusable demo identity — 🟢 VERIFIED LIVE FOUNDATION

Authoritative foundation reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-20-CONTROLLED-JUVAN-DEMO-IDENTITY.md`. Current Booking/Admin approval semantics are reconciled separately in the Booking/Admin reconciliation and remain preserved through #380, #399 and #416.

PR #364 makes **Juvan Botha the only reusable controlled CRM demo identity**. The business-controlled physical WhatsApp/mobile number is the durable identity anchor; a display name is not an identity key.

The canonical structure is:

- one active `controlled_demo_identities.demo_key='juvan_botha'`;
- one exact normalized controlled phone identity;
- nullable `current_client_id` pointing at the **current** canonical Juvan CRM client while registered;
- persisted Juvan booking-approval policy whose nullable `client_id` must move with the same current pointer;
- exact Jean-Pierre business-admin authority as the reset operator.

Production migration bootstrap deliberately started from the already-persisted and previously verified Juvan approval-policy/client relationship, then required one exact phone and zero shared-active-client conflict. New-instance startup after #380 reverified, PR #399 startup preserved, and #416 does not alter:

- binding state **BOUND**;
- current canonical pointer presently **845**;
- display `Juvan Botha`;
- controlled phone suffix **1564**;
- backup/admin authority **Jean-Pierre admin 4**;
- migrations 065/066/067/068/072 checksum verified;
- migration 072 not replayed under #416; and
- approval contract **assigned practitioner Primary + Jean-Pierre Backup + first decision wins**.

The reset contract remains Juvan-only and JP-only. Preview resolves the durable current pointer and displays actual client name, CRM ID and controlled phone. UNBOUND state, pointer drift, extra phone identity and shared-active-client conflict fail closed. Confirmation re-resolves/locks the demo row, client, contacts and policy and repeats the identity checks.

A successful reset clears bounded phone-linked booking intent/onboarding/booking-policy/conversation/legacy-profile/universal-welcome delivery state, releases only WhatsApp/mobile contacts, requires zero residual bindings, archives the old client, preserves appointments/audit history, writes `admin.controlled_demo_reset`, and atomically sets both the controlled current-client pointer and Juvan policy `client_id` to `NULL`. The controlled identity is then intentionally **UNBOUND**.

PR #388 adds a separate Booking/Admin choice before that unchanged identity reset: **Clean bookings and reset**, **Reset identity only**, or **Cancel**. Identity-only still delegates to the exact PR #364 path. The clean path previews the current phone-anchored profile and all non-final appointments with appointment/status/service/practitioner/date-time and known shared/practitioner Calendar mirrors, then binds explicit Jean-Pierre confirmation to the current pointer and appointment-state digest.

On clean confirmation, only non-final operational appointments are cancelled through appointment status history and CRM audit handling. Completed, no-show, already-cancelled and all appointment rows remain preserved. Pending approvals, reschedule requests, lifecycle/reminder and customer-change notification state are terminalized; no Juvan cancellation message is sent. Stored/current deterministic shared mirrors and every recognized assigned-practitioner mirror are removed independently. Provider failure, disabled Calendar, unknown practitioner mapping or audit failure reports a partial state, retains the identity binding and provides a safe retry. Identity release is permitted only after zero unresolved mirrors and a transaction-time no-non-final-appointment recheck. The workflow uses neither a fixed client ID nor a one-shot environment flag.

Fresh registration is deliberately the normal real WhatsApp onboarding path. A database trigger recognizes only the exact controlled phone; while UNBOUND it permits binding only to an active `whatsapp_onboarding` client and only when no other CRM binding exists. Contact attachment, controlled current-client pointer, Juvan policy pointer and `controlled_demo_identity.rebound` audit commit/rollback atomically. Ambiguous or competing identity fails closed. PR #399's migration 072 fixes only the PL/pgSQL local-variable collision in that trigger function and preserves these guards. PR #416's centralized verified-client resolver recognizes a valid persisted controlled-Juvan binding as an independent explicit authority and fails closed on drift/conflict.

The read-only resolver exposes only the current phone-anchored Juvan canonical client and fails closed on client/contact/policy/shared-active drift. **Downstream code must not permanently hard-code historical client 845 or fall back to “any client named Juvan Botha”.**

No genuine Juvan reset/re-registration occurred merely for #380, #399 or #416 proof. Production remains BOUND to the current pointer until a separately authorized real device lifecycle. The live foundation is proven; the future reset→registration transition is intentionally not claimed as handset-proven here.

The sanctioned Render read-only Postgres connector has previously failed before SQL execution at the known SSL/TLS boundary. The separate PR #411 single-IP TLS-capable observation path remains authorized until final project closure; no write-capable workaround is authorized merely for read evidence.

## Practitioner-approved client reschedule — 🟢 PROVIDER VERIFIED / PRODUCTION ENABLED

On 2026-08-21 the sanctioned provider verifier returned the complete readiness gate for both templates without submitting or editing either provider identity:

| Template | Status | Category | Language | Exact | duplicateCount | App configured |
|---|---|---|---|---|---:|---|
| `shiloh_reschedule_approval_request_v1` | **APPROVED** | UTILITY | `en` | true | 0 | true |
| `shiloh_reschedule_declined_v1` | **APPROVED** | UTILITY | `en` | true | 0 | true |

Verification deploy `dep-da4331jm8hqs73dl3h60` ran on unchanged GitHub `main` commit `d15857c65e1765faaaa22e101261323f7374bb46` with the explicit one-shot checker enabled and the feature still off. Both results were `submitted=false / reason=already_exists_exact`.

Production activation deploy `dep-da433gbncjis73aucgv0` then restored `META_RESCHEDULE_APPROVAL_TEMPLATES_PROVISION_ON_START=false`, set `WHATSAPP_RESCHEDULE_APPROVAL_ENABLED=true`, reached LIVE on the same unchanged commit, and logged `featureEnabled=true`, both template configurations true, migration 064 checksum-valid and both required indexes present. `/health` returned HTTP 200 with database `ok`; no startup provider submission, WhatsApp template send, reschedule request, appointment mutation or CRM/Calendar mutation occurred.

The provider and activation gates are closed. The deterministic kill switch remains `WHATSAPP_RESCHEDULE_APPROVAL_ENABLED=false`. Every actual send still revalidates the exact approved/configured provider contract and fails closed on drift, duplicates or provider-read failure.

Genuine client/practitioner handset delivery remains an evidence boundary, not an implementation blocker. Observe it only through natural business use; do not manufacture a Juvan reschedule, decision, appointment or CRM/Calendar mutation for proof.

## Juvan Botha booking approval — 🟢 VERIFIED LIVE PRIMARY / BACKUP

Genuine pre-#364 production identity evidence established one active canonical Juvan controlled identity, and #364 moved durable identity authority to the phone-anchored controlled resolver/current-client pointer. #366 replaced the old JP-sole runtime behavior without weakening that identity model.

Current behavior:

- assigned position-1 practitioner = **Primary approver**;
- Jean-Pierre = **Backup approver**;
- current controlled Juvan identity is resolved from the #364 controlled phone/current-client pointer;
- no permanent `client_id=845` rule and no display-name shortcut;
- Primary and Backup are authorized against current canonical identity/appointment truth at decision time;
- approval state is locked/revalidated transactionally and the first terminal decision wins;
- a second authorized decision cannot commit and receives already-decided state;
- staff-facing presentation identifies Primary, Backup and the appointment/client/service/time context;
- normal client-facing approval/decline outcome retains existing confirmation, CRM, Calendar, notification and audit safeguards.

JP-only **Reset Juvan** Admin presentation is live and delegates to the existing #364 CRM reset contract. Booking/Admin does not recreate the identity lifecycle.

For ordinary Couples Massage, Abigail is position 1 and therefore remains the assigned/Primary practitioner under the existing booking-approval machinery; Christel is position 2. #380 does not alter Juvan-specific Primary + JP Backup semantics.

Genuine booking **#585** remains historical evidence of the superseded JP-sole behavior and must not be recreated/cancelled/rebooked merely for evidence.

## Booking confirmation templates

### v1 — 🟢 LIVE / APPROVED / HANDSET-PROVEN

`shiloh_booking_confirmation_v1` remains exact, provider APPROVED and duplicate-free as the explicit single-selector rollback. #348/#352 remain authoritative historical v1 delivery-polish and genuine handset evidence; do not redo them.

### v2 — 🟢 PROVIDER VERIFIED / PRODUCTION ENABLED

`shiloh_booking_confirmation_v2` is the live production selector. Fresh provider verification on 2026-08-21 returned **APPROVED / UTILITY / en / exact / duplicateCount=0** with the frozen five-variable body and exact button order `Add to calendar` → `Manage booking` → `My appointments`. PR #383 activates only this exact contract through the centralized fail-closed gate, reuses canonical appointment-scoped handlers, suppresses redundant supplement messages, and preserves v1 as rollback. PR #384/startup migration 071 persists the accepted template name and provider message ID.

The full 18-identity production audit returned every current operational contract exact/approved/duplicate-free and ready under its active configuration; legacy `shiloh_birthday_wish_v1`, `appointment_followup` and `appointment_reminder` remain `sendable=false / ready=false`. API quality remains `UNKNOWN`; the separate WhatsApp Manager screenshot records `Active — Quality pending`. Genuine v2 handset delivery remains open for natural booking use only and must not be manufactured.

## Booking-update customer confirmations — 🟢 LIVE / ENABLED / 🟠 NATURAL DELIVERY EVIDENCE OPEN

`shiloh_booking_update_v1` remains provider APPROVED, exact, duplicate-free and production-enabled. Deterministic kill switch: `WHATSAPP_BOOKING_UPDATE_ENABLED=false`.

#332 terminally suppresses stale ended update rows. Appointment #575 / audit 674 remains terminally suppressed with `appointment_already_ended` and `sent_at=null`; never release, delete, mark sent or reuse it as delivery proof. Successful delivery evidence must arise naturally from a genuine still-future appointment change.

## Google Calendar — 🟢 VERIFIED HEALTHY / PERMANENT FAIL-CLOSED GUARD

#302's provider guard and proactive health probe remain permanent. Provider failure blocks booking writes cleanly. Genuine #570 and #585 remain accepted historical Calendar synchronization evidence. Do not mutate them merely for proof.

#395 is the current bounded practitioner-event classification authority. A busy event on practitioner A's practitioner Calendar must not, by itself, make practitioner B unavailable. A shared/clinic-wide blocking event remains clinic-wide, and an event on the relevant assigned practitioner's Calendar remains blocking. The booking flow continues to fail closed when the relevant assigned-practitioner Calendar, shared Calendar, provider health or canonical conflict evidence cannot be safely resolved. Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-21-PRACTITIONER-CALENDAR-CONFLICT-CLASSIFICATION.md`.

#399 and #416 do not alter #395's Calendar classification semantics.

The #409 inspection window contained a transient permission warning, but later reconciliation #410 superseded it and #416 provides newer clean authority: production startup for `dep-da4ouhdckfvc73cnn8hg` on exact `bcc327bc21dd1e72b6930eadcde86532f7c27a4f` logged **`Google Calendar provider health check passed`**, reached LIVE, logged `Shiloh started`, and returned repeated `/health` HTTP 200. Current Calendar provider-health status is therefore verified healthy for that bounded window; the permanent fail-closed guard remains required for future changeable provider state.

#362 separately verified deterministic cleanup of archived Dummy Test mirrors; post-cleanup 2026 searches returned zero Dummy Test events on shared, Abigail, Marietjie and primary/Christel surfaces. #380 also previously passed the Google Calendar provider health probe.

#380 Couples Massage availability reuses both shared and individual practitioner Calendar conflict checks for Abigail + Christel and rechecks both immediately before commit. A successful natural booking creates one shared event and each configured practitioner mirror. Admin/client multi-staff cancellation removes the shared event and all assigned practitioner mirrors. External Calendar side effects in the guarded creation path are compensated if the database transaction fails.

No Couples Massage or synthetic Calendar event was manufactured merely for proof. Canonical Shiloh CRM/appointment state remains authoritative; Google Calendar remains a synchronized provider/mirror subject to the standing fail-closed health guard.

## Booking/Admin durable rules — preserve

- #318 booking entitlement remains fail-closed: Christel+Abigail shared scope; Marietjie only; other linked Admins own practitioner; JP explicit unlinked business-admin exception for Christel+Abigail only; other unlinked Admins no booking catalogue.
- Block time authority is separate and narrower: Christel→Myself/Abigail; Abigail→self; Marietjie→self; JP/others→none.
- Dummy Test cleanup is an exact-client maintenance one-shot only; `CRM_DUMMY_APPOINTMENT_CLEANUP_ON_START=false` is the normal state. Do not generalize it into a broad name-based purge or re-enable it merely for proof.
- Current controlled-Juvan approval is assigned practitioner Primary + JP Backup + atomic first terminal decision wins. Historical #585 is prior-behavior evidence only.
- Manage booking cancellation must retain canonical reason/confirmation gating. Multi-staff appointments must lock every assigned practitioner and clear all assigned practitioner Calendar mirrors; do not regress to one-staff cleanup.
- Admin presentation standardization from #371-#373 and #409 must remain presentation-only: `Shiloh Admin 🌿`, personalized welcome, `What would you like to manage today?`, `New booking`, `Manage booking`, `Cancel new booking`, `Body Treatments`, and compact unrecognized-input Menu recovery may not be used to alter underlying CRM/service/permission/booking authority.
- Do not restore the legacy raw Admin command dump. Guarded Admin commands and audit remain authoritative, and active booking/date routing must remain ahead of the generic fallback.
- Existing-appointment cancellation remains `Cancel booking`; do not collapse it into the new-booking discard action.
- Client Massage Treatments must present `Couples & Packages` first, with `Couples Massage`, `Sports Massage Package`, then `Back`.
- Couples Massage authority is exact: service #66 / 90 min / R1080 / Abigail + Christel / simultaneous full-duration availability / one lead client + companion booking-backup mobile / atomic dual allocation. Do not expose it as an ordinary one-practitioner WhatsApp row.
- Companion mobile for Couples Massage is appointment-scoped `booking_backup`, not marketing consent and not automatic CRM identity. Automatic fallback messaging is not authorized by #380.
- Couples Massage client self-service reschedule remains fail-closed because it is a multi-staff appointment; clinic assistance is required until a separate multi-practitioner reschedule contract is approved.
- Sports Massage Package must resolve the canonical package owner rather than duplicate package data.
- Service #31 `Upper Back, Neck & Jaw Release` remains active, but Abigail is not an eligible practitioner; Christel is the verified current active/client-bookable mapping. Do not re-add Abigail without a later explicit business decision.
- The Admin who prepares an ordinary pending booking confirms it; do not reintroduce superseded Christel↔Abigail cross-confirm behaviour without a new requirement.
- Typed-time, clinic-hours, practitioner schedule, CRM conflicts, pending holds, shared/practitioner Google Calendar conflicts and final confirmation guards remain authoritative.
- Practitioner Calendar classification follows #395: an unrelated practitioner's event is not a clinic-wide conflict; shared/clinic-wide and relevant assigned-practitioner conflicts remain blocking.
- Provisional new-client fast path remains name + South African mobile → duplicate check → provisional canonical client → review → explicit confirm; abandoned provisional clients are removed only when no appointment exists.
- Existing full-label/hybrid WhatsApp choice presentation remains accepted.
- Returning-client authority now follows #416 centralized `clientVerifiedIdentity`; unique phone/profile completeness is no longer independently sufficient for returning-client trust.

## CRM & identity durable state

CRM is authoritative for canonical client/practitioner/staff identity. Ambiguous identity, duplicate/conflicting contact ownership, unresolved practitioner/staff identity and destructive changes lacking authority fail closed.

**CRM onboarding normalized-phone ambiguity — 🟢 VERIFIED LIVE / COMPLETE:** on 2026-08-22 three WhatsApp onboarding completions failed with PostgreSQL `42702` / `column reference "normalized_phone" is ambiguous` while `completeOnboarding()` performed the canonical `client_contacts` insert. Root cause is authoritative: migration 067's `client_contacts` trigger function declared local `normalized_phone` and compared `d.normalized_phone = normalized_phone`, creating a PL/pgSQL identifier collision. Applied migration 067 was not edited. PR #399 added forward migration 072, replacing only `guard_and_rebind_controlled_demo_contact()` with `v_normalized_phone` while preserving every standing controlled-identity/contact guard. CI #1236 passed 860/860 plus four focused cases. Exact Render deploy `dep-da4me5qd0e5s73bobfm0` reached LIVE on `26ace1027e10f40e41d0f5d981e72f4a55a972c6`; migration 072 applied/checksum-verified, 065–068 remained checksum-valid, Juvan remained BOUND, repeated `/health` returned 200, and the bounded post-cutover window through `09:09:55Z` contained zero `normalized_phone` matches. #416 preserves this repair and startup reverified migration 072 checksum-valid without replay.

**Imported contact-book provenance audit — 🟢 READ-ONLY AUDIT COMPLETE / VERIFIED-CLIENT IMPLEMENTATION COMPLETE:** production snapshot `2026-08-22 11:11:35.088085 UTC` (`13:11:35 SAST`) used authenticated TLSv1.3 PostgreSQL with `transaction_read_only=on`, executed the approved exact Q1–Q11 pack, and ended with `ROLLBACK`; no production mutation occurred and no full normalized phone was recorded. Snapshot evidence: **794** active `goldie_import` clients; **776** with mobile/WhatsApp phone; **553** phone-bearing with no appointment history; **241** with appointment history covering **530** appointment rows; derived **223** with phone + history; **18** with history but no current mobile/WhatsApp phone; **776** imported-origin normalized-phone groups map to exactly one active canonical client; **0** map to more than one; **3** imported clients currently carry a WhatsApp contact; **4** carry `verified_at` proxy/anomaly evidence; **0** have `client_onboarding_sessions.state='complete'`; Q11 found no durable identity/onboarding/contact/claim/registration audit action for this cohort. The previous DB evidence tooling gate is closed. `goldie_import`, exact-phone uniqueness, display name, imported DOB/gender, appointment history, profile completeness, contact type and `verified_at` alone are **not verified Shiloh identity authority**. Exact phone remains candidate selection and duplicate/conflict protection only. PR #416 now implements explicit verification evidence and the centralized resolver shared by CRM onboarding and Booking/Admin. Preserve canonical client IDs and all original import provenance. No bulk cohort remediation/trust backfill is authorized. Linda exact-phone trace remains blocked until a legitimate phone anchor exists; no `Linda Dr` display-name search is authorized. Authoritative completion: `docs/SHILOH-OS-RECONCILIATION-2026-08-22-VERIFIED-CLIENT-AUTHORITY-IMPLEMENTATION-COMPLETE.md`.

## Imported contact-book verified-client authority — 🟢 VERIFIED LIVE / COMPLETE

Risk remains **HIGH — identity integrity / privacy / historical-record association / consent**, but the ratified authority defect is repaired live through PR #416.

The implemented shared contract is:

- preserve `clients.source` plus all original import evidence in `import_batches`, `external_records`, `external_client_records`, reconciliation history and other existing provenance/audit surfaces; provenance is evidence, not verification authority;
- migration `074_client_identity_verification_authority.sql` adds durable explicit client/contact verification evidence and onboarding authority-version evidence; it performs no trust backfill and does not edit migration 072 or historical applied migrations;
- centralized `src/services/clientVerifiedIdentity.js` owns verified-client authority for CRM onboarding and Booking/Admin rather than parallel local inference;
- for `imported_contact_unverified`, exact phone may select one candidate, but the flow does not disclose/compare the imported label, does not seed imported DOB/gender, collects canonical data afresh, preserves the same canonical client ID and all import provenance, and records explicit verification only after governed onboarding succeeds;
- appointment/history is not identity proof; preserve history and require stronger/human verification when independent verification is insufficient;
- ambiguous phone ownership or conflicting verification evidence fails closed to human review; no match follows normal registration;
- `verified_at`, contact type, profile completeness, `clients.source`, display name, DOB/gender and appointment history alone never grant verified-client authority;
- preserve exact-phone duplicate/conflict protection; the repair changes verified authority, not duplicate creation rules;
- `resolveClientByWhatsApp` exposes legacy `status='unique'` only when the centralized resolver has established `verified_client`, so Booking/Admin booking identity gate and final commit consume the same authority;
- transition welcome also consumes the centralized resolver;
- pre-authority onboarding sessions are re-resolved so previously seeded imported values cannot silently carry forward as authority;
- all matching mobile/WhatsApp contacts are locked and inspected before governed completion;
- successful governed onboarding records explicit `client_identity_verifications`, sanitized evidence reference, `client.identity_verified` audit evidence and onboarding authority version;
- no bulk cohort remediation, deletion, merge, archive, rename, mass attribute rewrite, trust backfill, manual alteration/grandfathering of the four `verified_at` proxy rows, Linda-specific mutation, or weakening of duplicate/conflict protection is authorized.

Controlled Juvan remains a separately governed independent explicit authority when its persisted binding is valid; drift/conflict fails closed. #416 startup preserved the BOUND state and existing Primary + JP Backup + first-decision-wins semantics.

**Do not perform bulk historical verification remediation/backfill now.** The accepted strategy is prospective: genuine governed onboarding creates explicit verification evidence under the live authority. Any future historical cohort remediation/backfill is a separate Control decision requiring new evidence, exact scope, risk analysis and explicit authorization.

**Juvan is the only reusable controlled demo identity.** The exact normalized business-controlled phone is the durable anchor; `controlled_demo_identities.current_client_id` is the current canonical client pointer. A successful authorized reset intentionally makes that pointer and the Juvan approval-policy client pointer NULL; normal exact-phone WhatsApp onboarding atomically binds both to the new canonical client. Chenique and Dummy Test / CRM Dummy Test are retired from reusable reset eligibility. Migration 072 repairs only the trigger-function identifier collision and does not weaken this lifecycle.

The completed CRM Dummy Test reassignment remains do-not-redo historical evidence. CRM #835 remains archived/reset and without its former WhatsApp/mobile identity. The #362 booking cleanup did not delete the client or appointment rows; #582/#583 are cancelled, #561/#565/#566/#574 were already cancelled and #564 remains no-show historical truth.

A future controlled Juvan reset requires exact Jean-Pierre business-admin authority, current pointer/contact/policy consistency, exact phone verification, explicit confirmation and all transaction-time fail-closed guards. Do not perform one merely for proof. After reset the genuine controlled phone must complete normal new-client registration before the demo identity becomes BOUND again.

For Couples Massage, the lead client remains the canonical appointment client. `appointment_companions` stores a booking-specific companion name/mobile only; the companion mobile must not be silently inserted into `client_contacts` or interpreted as a registered CRM client/marketing consent merely because the lead supplied it.

The historical #558 attendance exception remains unresolved with historical practitioner `SHILOH MTC`. Never infer Christel, Marietjie or another practitioner; establish human/authoritative truth before correction/finalization.

## Attendance own-practitioner-only authority — 🟢 VERIFIED LIVE through #324

PR #324 remains authoritative:

- Christel finalizes Christel appointments only.
- Abigail finalizes Abigail appointments only.
- Marietjie finalizes Marietjie appointments only.
- Jean-Pierre has no attendance/finalization authority.

Exact active linked identity is required and conflicts fail closed. Historical attendance truth remains human-controlled.

## Client welcome and discovery — 🟢 HANDSET EVIDENCE PRESERVED / CURRENT PRESENTATION #380

Universal welcome routing remains repaired through #337. A real Juvan `Hi` proved welcome then registered-client branch; subsequent Browse treatments evidence proved accepted two-page category presentation and SQT virtual family. The completed CRM Dummy reset adds separate genuine evidence that a released number correctly enters the unregistered/new-client branch.

#378 established Couples & Packages first under Massage Treatments. #380 makes Couples Massage genuinely self-service under the exact 90 min / R1,080 / Abigail+Christel contract while suppressing the canonical service from ordinary single-practitioner WhatsApp rows. This runtime is regression/deploy verified but was not replayed on a genuine handset merely for proof.

#416 changes returning-client identity authority: the transition welcome now consumes the centralized verified-client resolver rather than a parallel unique-phone/profile-completeness trust path.

For the controlled Juvan demo lifecycle, #364 deliberately includes phone-level universal-welcome delivery state in bounded reset cleanup so a future explicitly authorized reset can make the exact physical number genuinely new again. This does not invalidate the earlier Juvan welcome proof and is not permission to reset/replay merely for evidence.

## Christel reviewed service catalogue — 🟢 VERIFIED LIVE through #328 + #376 mapping correction + #380 Couples service

Authoritative reconciliations: `docs/SHILOH-OS-RECONCILIATION-2026-08-18-CHRISTEL-SERVICE-CATALOGUE-CORRECTION.md`, `docs/SHILOH-OS-RECONCILIATION-2026-08-20-ABIGAIL-JAW-RELEASE-MAPPING.md`, and `docs/SHILOH-OS-RECONCILIATION-2026-08-20-COUPLES-MASSAGE-SELF-SERVICE.md`.

Preserve #328:

- service #27 Full Body Sports Massage inactive/unmapped, history preserved;
- distinct #34 Sports Massage Full Body active at 120 minutes;
- #65 Sports Massage — Package Session active at 50 minutes with existing package contract;
- reviewed canonical totals 60 / 90 / 90 for the approved three services;
- no practitioner-specific duration override.

#375/#376 changes only service #31 practitioner eligibility: `Upper Back, Neck & Jaw Release` remains active and Christel remains mapped, while Abigail is no longer mapped. Historical appointment links remain preserved.

#380 adds separate Shiloh-owned service #66 `Couples Massage` at 90 minutes/R1080 with exact Abigail + Christel mappings. It does not reactivate/remap #27, merge #27/#34, alter #34/#65 duration or package rules, or re-add Abigail to service #31.

Do not reactivate/remap #27, merge #27/#34, restore reviewed buffers, delete history, alter #34/#65 duration, re-add Abigail to #31 without explicit business authority, change Couples service #66 duration/price/practitioners without explicit business authority, or bulk-publish Goldie wording.

## Goldie description publication authority — 🟠 BUSINESS POLICY APPROVED / DRAFTING + EXTERNAL GATES

Authoritative reconciliation: `docs/SHILOH-OS-RECONCILIATION-2026-08-21-GOLDIE-DESCRIPTION-BUSINESS-APPROVAL.md`.

PR #392/#393 source and editor evidence is complete and must not be repeated. The two active lymphatic Description fields are genuinely blank, the Reset Package photo is secondary marketing evidence only, the Psoas editor/export value is exactly 1,000 characters and ends `deep physica`, and retired Full Body Sports Massage remains intentionally blank.

Durable publication rules approved on 2026-08-21:

- Preserve the two active lymphatic blanks for now and preserve the retired Sports Massage blank; future new copy requires separate exact approval.
- Never infer, autocomplete or normalize missing source text from a photo, placeholder, truncated field, corrupted wording or nearby service.
- Practitioner personal phone numbers do not belong in public service descriptions; use Shiloh's controlled clinic contact journey.
- Imported Goldie text is source evidence, not publication approval.
- Clinical or treatment efficacy, recovery, safety, outcome or duration claims require retained substantiation and qualified clinical/compliance review. Otherwise use neutral factual wording or keep the description unpublished.
- Mechanical corrections and controlled rewrites may be drafted, but exact final wording must be approved before any catalogue or production mutation.

Psoas remains unpublished pending Goldie Support's uncapped stored value/history or explicit confirmation that no longer value exists. Bamboo remains unpublished pending exact business truth for Area Specific versus Full Body. No bulk publication is authorized.

Open PR #415 — `Ratify Goldie exact-source-first description policy` — is separate policy work and is not part of PR #416 reconciliation. Until it merges and is separately reconciled, the existing D1–D11 authority above remains current on `main`.

## Public catalogue — 🟢 VERIFIED LIVE

`/book` remains the Shiloh-owned CRM-backed public service catalogue through accepted #301 state. #371's Admin Body Treatments presentation and #378/#380 WhatsApp navigation do not create a second static source of truth.

#380 establishes Couples Massage as one canonical Shiloh-owned `services` row rather than hard-coding a duplicate client catalogue. WhatsApp intentionally routes that canonical service through Couples & Packages and suppresses the ordinary one-practitioner row. Sports package data/entitlements remain owned by the canonical package service. Practitioner eligibility for Jaw Release follows #376. Do not create a second static source of truth.

## Control audit boundary — preserve

An earlier Control read-only verification mistakenly invoked Render environment update three times with an empty merge set, causing same-commit API redeploys without changing env key/value state. Preserve this as a governance/audit breach. Control must use true read-only Render tools absent explicit override.

## Google Business Profile provider access — 🟠 EXTERNAL / PROVIDER GATE

Last authoritative provider evidence remains: Google Business Profile Business Information API is enabled, the API-access application was submitted, and API-specific quota surfaces are visible. The general **Requests per minute = 0** means usable GBP read/write API access remains **not confirmed/usable** and provider approval/access is **not positively established**.

This is **not an ordinary capacity/quota-increase task**; it remains the provider API-access approval/review pathway. Existing earlier GBP scaffolding is **not evidence of provider approval** and does not authorize integration.

Do not begin or resume GBP OAuth/API integration until authoritative Google evidence establishes usable access, including a **usable general request quota greater than 0**, or another explicit Google approval/access result that proves usable API calls. Production / DevOps owns provider/config verification; Control tracks the dependency.

## Other standing gates

- Google Contacts sync remains lower priority; CRM remains authoritative.
- Ozow remains waiting for merchant configuration and explicit business rules.
- Destructive privacy execution remains fail-closed pending authority/evidence.
- Follow-up/rating and birthday delivery evidence remain genuine-journey/eligibility gated.
- Goldie source/editor recovery is complete except for the Psoas backend-history dependency. D1–D11 publication policy remains current on merged `main`; open PR #415 is separate and does not alter current authority until merged/reconciled.

## Shiloh Visual Calendar — ⏸️ DEFERRED

A future Shiloh Visual Calendar remains deliberately held. Do not implement/prototype/add it to active queue until a later explicit controlled decision. Existing Google Calendar integration remains unchanged.

## Superseded reconciliation branch

PR #351 remains superseded/closed because newer authority #352–#356 overtook it. Do not reopen or force-merge it. PR #414 also remains superseded/closed unmerged after PR #413; do not reopen it.

## Exact continuation state

**Authoritative current application state:** PR #416 / `bcc327bc21dd1e72b6930eadcde86532f7c27a4f`; final CI #1269 / run 32571765659 / job 97028094203 passed on Node 24.14.1 with 881/881 tests and 0 failed/cancelled/skipped. Exact application Render deploy `dep-da4ouhdckfvc73cnn8hg` reached LIVE. Startup applied/checksum-verified migration 074, left migration 072 checksum-valid/unreplayed, preserved controlled Juvan BOUND state, logged Google Calendar provider health passed, logged Shiloh started, returned repeated `/health` 200 and had no error-level logs in the bounded post-cutover query. PR #399 remains durable authority for the normalized-phone ambiguity repair; PR #395 remains durable authority for practitioner Calendar semantics.

**Imported contact-book identity audit + verified-client implementation:** **AUDIT COMPLETE / REPAIR COMPLETE / VERIFIED LIVE.** The `2026-08-22 11:11:35.088085 UTC` Q1–Q11 production snapshot remains authoritative and must not be rerun merely for reconciliation. Snapshot cohort evidence is 794 active `goldie_import` clients; 776 with mobile/WhatsApp phone; 553 phone-bearing/no-history imported-contact-only records; 241 with appointment history / 530 appointment rows; derived 223 phone+history and 18 history/no-phone; 776 one-active-client normalized-phone groups and 0 multi-active-client groups; 3 current WhatsApp contacts; 4 `verified_at` proxy/anomaly rows; 0 completed onboarding sessions. PR #416 / migration 074 implements explicit verification evidence and the centralized verified-client resolver shared by CRM onboarding and Booking/Admin. Exact phone remains candidate/duplicate/conflict protection, not identity proof. Imported provenance/profile data are not identity proof. No bulk cohort remediation or trust backfill is authorized. Genuine governed onboarding should create explicit verification evidence prospectively. Any historical cohort remediation/backfill requires a separate Control decision. Linda remains untraced without an exact-phone anchor; no display-name matching. Durable completion: `docs/SHILOH-OS-RECONCILIATION-2026-08-22-VERIFIED-CLIENT-AUTHORITY-IMPLEMENTATION-COMPLETE.md`.

**Practitioner Calendar classification:** #395 is verified live and do-not-redo. An unrelated practitioner's Calendar event does not, by itself, block the assigned practitioner. Shared/clinic-wide events and the relevant assigned practitioner's Calendar remain blocking, with provider-health and canonical conflict rules preserved. #416 startup logged Google Calendar provider health passed; the permanent fail-closed health guard remains authoritative for future provider-state changes.

**Provider credential security:** complete/do-not-redo. Dedicated Meta system user `Shiloh` owns the final production-only, least-privilege WhatsApp token; all former generic `Employee` tokens are revoked; only Render `WHATSAPP_TOKEN` changed. Preserve the two-scope permission boundary, production-only asset assignments and PR #387 redaction. Historic retained logs remain under Render retention and must not be destroyed by unsupported means. #416 does not reopen credential rotation.

**Client Massage Treatments:** **Couples & Packages** is the first special option. Inside: **Couples Massage**, **Sports Massage Package**, **Back**. Couples Massage is self-service under exact authority: service #66, 90 min, R1,080, Abigail + Christel required together, simultaneous full-duration availability, one lead client + companion name/mobile, Booking Policy acceptance and atomic dual-practitioner commit. Companion mobile is booking-only backup/no marketing; automatic fallback messaging is not claimed. Sports Massage Package reuses canonical `sports-massage-monthly` authority: package-session service #65, 4 sessions, R1400, 30 days, 24-hour cancellation notice, established entitlement/enquiry/session flows.

**Couples change safety:** both Admin and client cancellation lock all assigned practitioners and remove all practitioner Calendar mirrors. Client self-service reschedule remains fail-closed for multi-staff appointments, so Couples Massage rescheduling requires clinic assistance until separately designed.

**Abigail Jaw Release mapping:** service #31 `Upper Back, Neck & Jaw Release` remains active; Abigail staff #1 has `abigailMapped=false`; Christel staff #3 is the remaining active/client-bookable practitioner mapping; 13 linked appointments remain preserved. #416 startup reverified this state. Do not re-add Abigail without a later explicit business decision.

**Admin UX:** #371-#373 remain verified live presentation authority, extended only at the unrecognized-input boundary by #409. Keep `Shiloh Admin 🌿`, personalized `Welcome back, <Admin> 👋`, `What would you like to manage today?`, `New booking`, `Manage booking`, `Cancel new booking`, and `Body Treatments`. Existing appointment cancellation remains `Cancel booking`. For genuinely unrecognized authenticated Admin text, keep `I didn't recognise that admin request. Send *Menu* to open Shiloh Admin.` Do not restore the legacy command dump; do not move the generic fallback ahead of active booking/date routing. Returning-client identity now follows the centralized #416 resolver.

**Controlled Juvan identity/approval/reset:** #364 phone-anchored current-client identity foundation remains authoritative; #366 is the current approval behavior — assigned practitioner Primary, Jean-Pierre Backup, exactly one atomic first terminal decision wins. Current production pointer presently resolves client 845 / suffix 1564 / JP admin 4, but 845 is not a permanent identity key. PR #388 makes JP-only Reset Juvan offer **Clean bookings and reset**, unchanged **Reset identity only**, or **Cancel**. The clean path preserves appointment rows/history, sends no customer cancellation message, removes shared/all assigned-practitioner Calendar mirrors, retains the binding on unresolved mirrors and is safely retryable. PR #399 preserves this identity/approval contract and repairs only the migration-067 trigger identifier collision via migration 072. #416 preserves and revalidates the binding while recognizing a valid persisted controlled-Juvan binding as independently explicit authority. No genuine reset, booking cancellation or Calendar deletion occurred merely for proof.

**Manage booking cancellation:** #367 remains the reason/confirmation UX authority; #380 adds multi-staff locking and all-practitioner Calendar cleanup. Existing appointment `Cancel booking` remains appointment-scoped and restart-safe. No real appointment was cancelled merely for proof.

**Separate unimplemented UX idea:** context-aware return to the same Manage Client screen after a successful cancellation is not part of current authority and requires separate explicit implementation approval.

**Practitioner-approved rescheduling:** both required Meta templates are provider-approved, exact, duplicate-free and configured; production is enabled through `WHATSAPP_RESCHEDULE_APPROVAL_ENABLED=true`. The one-shot provider checker is off. Preserve the exact runtime send guard and deterministic `false` kill switch. Genuine handset delivery remains open for natural business use only; do not manufacture a Juvan reschedule or practitioner decision for proof.

**Goldie descriptions:** PR #392/#393 source/editor evidence is complete and must not be repeated. Existing merged D1–D11 authority remains current until separately superseded. Open PR #415 is separate exact-source-first policy work and must remain untouched by #416 reconciliation. Psoas source recovery and Bamboo treatment identity remain fail-closed; no bulk description publication is authorized by #416.

**CRM onboarding normalized-phone ambiguity:** complete/do-not-redo. The 2026-08-22 PostgreSQL 42702 incident root cause is the migration-067 trigger function's ambiguous PL/pgSQL local `normalized_phone`; migration 067 remains untouched/checksum-authoritative. Forward migration 072 replaces only the function using `v_normalized_phone` while preserving all controlled identity/contact guards. PR #399 / `26ace1027e10f40e41d0f5d981e72f4a55a972c6`, CI #1236, 860/860 regression, exact LIVE deploy `dep-da4me5qd0e5s73bobfm0`, startup checksum evidence and bounded post-cutover zero-match evidence remain authoritative for that repair. #416 does not alter it.

**Verified-client controlled unit:** **COMPLETE.** No further CRM data remediation is authorized from this unit. Historical imported-client trust remediation/backfill, if ever desired, is a separate future Control decision with new evidence and explicit authorization.

**Remaining evidence boundary:** a real Couples Massage booking should occur only through natural client use; do not create one merely for proof. A real Juvan booking cleanup/reset→new registration→new canonical rebind is also intentionally unproven and must occur only when Jean-Pierre genuinely intends that operational action on the business-controlled identity. Do not cancel or manufacture an appointment merely for verification. All other standing fail-closed gates remain preserved.