# Booked-client tablet preparation — 11 November 2026

Status: **draft feature-source preparation; neither feature deployment nor activation
is authorised**. Current live source after No charge release #1581 is
`eacd82c93a5d6422712b4790b4f806e9402fd62a`. Migration 202 was completed
by the separate recovery-only release #1583 and must not be reapplied.
This preparation performs no further production migration, setting change, provider
send or client-record mutation.
Walk-ins are a separate later stage. This branch preserves the released No charge
eligibility explanation and all financial recording safeguards unchanged.

## Intended experience

Paired clinic tablet → enter recorded mobile → explicitly request WhatsApp code →
verify → explicitly choose one of today's own appointments → outstanding required
forms in canonical version order → backend-confirmed signed completion → clear.
No default visit is selected, even for one result. Missing bookings, conflicting
canonical owners or historical phone contacts, missing assignments, needs-review
forms, changed identity/booking, or unavailable proof go to Reception's existing
staff-assisted handover. No new client/booking is created. A family guest without
an independently recorded number uses staff handover. Unrecorded social sharing
cannot be detected; phone possession must not be represented as proof of legal
identity or permission for another person's forms.

## Existing authorities, not a retired channel

`client_auth_otp` in the generic message registry is the retired historical path;
it remains retired. The separately reviewed current client runtime is
`clientCodeProduction` → `clientCodeRelease` → `clientCodeRuntime`, using
`src/config/clientWhatsAppManifest.json` (`shiloh_client_verification`).
See `docs/WORKSPACE_WHATSAPP_AUTH_PREPARATION.md` and released #1578/#1580.
The parent confirmed the live R10 ceiling and the current English AUTHENTICATION/Copy code template with a 15-minute expiry. The runtime supplies that reviewed TTL unchanged; synthetic tests also retain five-minute compatibility. No live manifest was read/edited here.

The proof-only adapter must receive the **same** private provider, HMAC key,
reviewed budget and TTL from that runtime. HMAC namespaces for client reservations
are unchanged: R1 estimated unit cost, current configured daily allowance, 3 per
person, 50 clinic-wide, 60-second cooldown, South African midnight. Existing
uncertain-send protection stays shared. SMS, passkeys, persistent My Shiloh sessions,
profile verification/registration and recovery are not tablet capabilities.

`phoneProofOnly` defaults off. Its queue/consumption is isolated from normal client
proofs while counters remain shared. Pending requests bind to an active device and
grant; revoked/cancelled/replaced/expired grants cannot start a send or consume proof.
An already in-flight provider send cannot be unsent. The public My Shiloh service
cannot begin or consume the tablet purpose. No proof-only service is constructed unless the new reviewed activation setting is explicitly enabled.
Shutdown closes the shared client runtime's sender/HTTP readiness gate and
aborts its ordinary worker before waiting for the tablet worker to drain. A
pending readiness read cannot start a subsequent provider send after shutdown.

## Temporary access boundary

The existing device must pass fresh clinic-wide client, form and booking preparation
authority. A visit grant is a separate, random, HttpOnly/SameSite-Strict cookie scoped
to `/check-in/booked`; production requires Secure. The router expires existing staff
and My Shiloh browser cookies and never creates those sessions. No phone, OTP,
clinical answers or canonical form bearer token appears in URLs or browser storage.
A browser-bound CSRF proof and same-origin checks cover every POST. Repeated start requests reuse the same server-derived grant and never enqueue another code; a changed number requires explicitly clearing and starting again. Private/no-store,
no-referrer and frame/CSP restrictions apply. Cancel/start, back-cache restoration
and inactivity clear the page. Heartbeats maintain only active visible use and never
extend the fixed maximum.

Reuse existing bounds: fixed 40-minute grant, five-minute inactivity expiry.
Only today's scheduled/confirmed canonical appointments in the active clinic
relationship are selectable; cancelled/no-show/completed/legacy bookings are not
self-selected here. Multiple appointments require explicit selection. Linked
appointments remain separate canonical appointment selections; no guest's forms
are inferred from an organiser's number. All returned choices share one canonical
client. Visit/client revision is rechecked before every form operation.
The encrypted grant also retains the verified mobile and canonical ownership
snapshot. Choices, form opens, submissions and live-grant heartbeats recheck the
same shared identity authority, including new canonical owners or historical
contacts. The canonical mobile advisory key is reused before assignment/identity
row locks. A bounded transaction-level shared lock on the legacy contact table
prevents a new legacy match racing that check; it can briefly delay historical
contact writes and requires production privilege/contention review. It does not
change the normal My Shiloh locking or authentication outcomes.

Canonical required mappings plus existing assignments are reused, including missing
assignments (staff help), and completion requires an actual signed submission.
The tablet holds an encrypted server-side canonical token for exactly its current
assignment. Direct `/forms/f/...` URLs are never rendered. Existing prepared/claimed staff handovers are not replaced; assignment advisory locks share the existing staff ordering, and a unique active-assignment constraint prevents two tablets rotating each other’s form. Form submission,
next-form issuance and grant progress share one transaction; a lost reply is resolved
by reading backend progress. Old-step replay never submits to a later form.
An explicitly identified stale form POST reopens authorised backend progress
without discarding the recovery cookie or copying the old answers into the next
form. Other invalid grants still fail closed. The welcome page has no live-grant
heartbeat; active typing survives the first 30 seconds while its separate
inactivity reset remains in place.
Validation still uses the canonical form service, including encrypted answers and
immutable consent/form snapshots. No client profile update is performed.

## Applied schema; lifecycle activation still requires approval

Migration `202_clinic_tablet_booked_grants.sql` was applied by #1583. Its unchanged
SHA-256 is `40c37de7579056fcf88352419af18f87d33b8d2ad1500d341abc9d954d12d56d`.
Read-only postflight confirmed 202 matching source files/ledger rows, expected
constraints and five valid/ready indexes (four explicit plus the primary-key index),
and zero grants. This feature branch introduces no additional migration and must not
request another controlled migration marker. The table references existing paired devices.
The assignment reference is bounded operational metadata used to enforce one active form grant; answers remain in the canonical encrypted submissions. Payloads use AES-256-GCM with a separate HKDF context from the existing private client
proof key, device/hash AAD and random IV. No new key value or credential is requested.
The table stores access state only, never answers. Completion/cancel wipes identity
and form-token state; signed clinical submissions retain their existing policy.

A reviewed lifecycle must run bounded cleanup at least once per minute: expired or
idle grants are deleted, and matching form tokens are expired before deletion.
Cleanup covers revoked devices and fails visibly if encrypted state cannot be read.
During a database outage or while this feature is disabled, cleanup cannot run;
expired grants still fail closed, but deletion waits for the reviewed lifecycle to
resume. Disabling the feature is not a substitute for verifying final cleanup.
Existing security-event infrastructure records device/state transitions, without
phone/code/answers or a staff member impersonated as the client actor. Do not log
provider payloads, exceptions with request data, hashes or tokens.

## Held production actions

1. Reconcile current main and preserve ordinary/tablet queue and revocation
   separation. Keep recovery ledger/checksum/idempotency/quota regressions; replace
   the obsolete recovery-only assertion that tablet source files are absent with
   executable flag-off preparation, route and CTA coverage. Ordinary HTTP verification
   must reject even a valid tablet proof without consuming it or issuing a session.
2. Run required exact-head checks and review the reconciled source before requesting
   a separate feature-source deployment with tablet access off. Shared ordinary
   authentication purpose validation, store/identity refactoring, canonical form
   transaction support and shutdown hooks change even while the flag is false.
   Verify a marker-free startup against the already applied ledger 202; do not rerun
   the migration. Retain the exact healthy feature-off build and its effective config.
3. Separately review and approve the new proof-only purpose, device/visit/form
   boundary, cookie/CSRF/cache behavior, encrypted grant storage and short-lived
   retention/cleanup policy. Review a composition using the current client runtime's private
   provider/key/budget, its proof-only worker, the cleanup lifecycle and protected
   route. Activation reads `SHILOH_CLINIC_TABLET_BOOKED_ENABLED`, default off, and
   requires existing check-in/forms flags and a ready client runtime. While off, the
   reserved path returns 404, no tablet component/worker is prepared/started and no
   CTA appears. The router independently defaults off and denies production
   construction without explicit approval. Preparation failures remain contained to
   this feature with a fixed, non-sensitive warning. No real-code acceptance test,
   new allowance, security setting or client-record test mutation is authorised here.
4. Before planned disabling or rollback, quiesce new tablet use while cleanup is
   still available, finish/cancel temporary access and drain in-flight work. Verify
   final grant deletion and matching tablet-owned form-token invalidation, preserving
   signed submissions and newer staff-handover tokens. Only then disable or select
   the reviewed compatible feature-off build. An outage may prevent cleanup; stop
   for a specifically reviewed recovery/cleanup decision rather than improvising
   deletions. Started provider sends cannot be recalled. Do not drop the table,
   rewrite the ledger, reset counters or restore production as a test.
5. Run all required checks on the final exact production composition. Issue #1198 still tracks physical privacy/reset and separate staff-account acceptance. Signed-in
   physical tablet acceptance and real WhatsApp receipt are separate owner-authorised
   milestones; synthetic tests do not prove them.

The new activation setting requires specific approval before it is set. Feature-off
deployment and later authentication/access/retention activation are separate
decisions; preparation approval authorises neither. Keep this PR draft.

## Recovery checkpoint and configuration limits

The original recovery-only deployment `dep-dbq64o5g1s2s739i6n6g` at
`b1256a51` applied migration 202 and passed its read-only postflight. Its saved
marker was removed with Save only; its retained artifact can still restore the
original marker configuration.

Current live deployment `dep-dbqardnavr4c739sn9t0` is No charge release #1581 at
`eacd82c93a5d6422712b4790b4f806e9402fd62a`, live at 18:03:46 UTC on
11 November. Its new-instance startup at 18:03:40 UTC reported read-only mode,
controlled migration action disabled, filename null, 202 matching files/ledger
rows and no pending, unknown or mismatched entries. This establishes marker-free
startup for this source; it does not establish the full tablet feature-off checkpoint.
Render confirmed the exact source live with `/health` readiness configured; the
existing mounted My Shiloh HTTP proof passed. No real payment/client test mutation
or message was performed. Saved tablet access remains false and was not changed.
Verify the effective configuration and retained-artifact availability again before
any specifically approved backout; do not infer later configuration from saved values.

The recovery-only artifact has no tablet composition or cleanup worker and is
bounded to recovery before tablet activation. Its ordinary verification does not
explicitly whitelist purposes: a matching ready tablet record plus exact bindings
and valid code could reach session issuance. Do not use it as a general post-activation
backout. The feature source closes that purpose boundary. Prefer a verified healthy
full-feature/off checkpoint with marker absent once separately released. Saved
settings alone do not rewrite any retained artifact's configuration.

## Walk-ins, later

Do not add self-registration or treatment-request persistence to this release.
The later workflow must distinguish interest from a confirmed appointment: verified
phone/details if new, treatment choice/help request, Reception confirms practitioner,
time and price and creates the canonical booking, then the same scoped required
forms. Client/profile/booking creation and its identity rules need their own reviewed
implementation. Existing staff handover remains available throughout.
