# Booked-client tablet preparation — 11 November 2026

Status: **draft preparation, not authorised for production activation**. No production
migration, setting, credential, provider send or client record was changed.
Walk-ins are a separate later stage. No charge PR #1581 remains held independently.

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

Canonical required mappings plus existing assignments are reused, including missing
assignments (staff help), and completion requires an actual signed submission.
The tablet holds an encrypted server-side canonical token for exactly its current
assignment. Direct `/forms/f/...` URLs are never rendered. Existing prepared/claimed staff handovers are not replaced; assignment advisory locks share the existing staff ordering, and a unique active-assignment constraint prevents two tablets rotating each other’s form. Form submission,
next-form issuance and grant progress share one transaction; a lost reply is resolved
by reading backend progress. Old-step replay never submits to a later form.
Validation still uses the canonical form service, including encrypted answers and
immutable consent/form snapshots. No client profile update is performed.

## Schema and lifecycle proposal requiring approval

Prepared migration `202_clinic_tablet_booked_grants.sql` adds **one table and four explicit
indexes**, no existing-table/record changes. It references existing paired devices.
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

1. Review the new proof-only purpose, device/visit/form boundary, cookie/CSRF/cache
   behavior, encrypted grant storage and short-lived retention/cleanup policy.
2. Specifically approve additive migration 202. Before applying it: exact source and
   checksum inventory, fresh recovery evidence, lock/availability assessment, tested
   transaction rollback and backup/recovery limitations. No migration is run by app
   startup unless the existing controlled release procedure explicitly permits it.
   Proposed marker: `SHILOH_CONTROLLED_RELEASE_MIGRATION=202_clinic_tablet_booked_grants.sql`.
3. Review a production composition using the current client runtime's private
   provider/key/budget, its proof-only worker, the cleanup lifecycle and protected
   route. Prepared activation wiring reads `SHILOH_CLINIC_TABLET_BOOKED_ENABLED`, default off. It also requires existing check-in/forms flags and the client runtime to be ready. While off, the reserved path returns 404, no worker is created/started and no CTA appears. No setting was changed. The router independently defaults off and denies production construction without explicit approval. Preparation failures are contained to the feature with a fixed, non-sensitive warning.
4. Use a compatible rollback version that understands the isolated tablet purpose.
   Disable the new route/workers and invalidate only new tablet grants/proofs before
   rollback. Do not revert to an older worker that can claim unknown purposes, drop
   the new table as a reflex, change ordinary client counters, or restore production
   as a test. Table/index creation can take catalog locks; failure before commit must
   roll back. No old record backfill is proposed.
5. Run all required checks on the final exact production composition. Issue #1198 still tracks physical privacy/reset and separate staff-account acceptance. Signed-in
   physical tablet acceptance and real WhatsApp receipt are separate owner-authorised
   milestones; synthetic tests do not prove them.

The new activation setting itself requires specific approval before it is set. No migration, authentication/access activation or new retention configuration may
be released under routine-UI standing approval. Keep this PR draft until those
specific decisions and all preflight evidence are resolved.

## Walk-ins, later

Do not add self-registration or treatment-request persistence to this release.
The later workflow must distinguish interest from a confirmed appointment: verified
phone/details if new, treatment choice/help request, Reception confirms practitioner,
time and price and creates the canonical booking, then the same scoped required
forms. Client/profile/booking creation and its identity rules need their own reviewed
implementation. Existing staff handover remains available throughout.
