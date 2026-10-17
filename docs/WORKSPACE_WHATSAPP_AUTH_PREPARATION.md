# Workspace WhatsApp authentication preparation

Status: isolated, unmounted implementation draft; not an activation-ready integration.
Owner direction recorded 17 October 2026: prepare BOTH staff sign-in and passkey
setup/recovery. Passkeys remain preferred; WhatsApp is an optional alternative.
The owner subsequently agreed to include SMS as a proposed backup. This authorizes
design and synthetic implementation, not SMS activation or any security cutover.

## Evidence and boundaries

- Base inspected: `91f34953415c28a19aba72bc5a344f140f316cc5` (main).
- Owner reports Meta business verification complete and template
  `shiloh_workspace_verification`, English, Copy code approved/live on 17 October.
  These are owner reports, not authenticated provider readback. Exact language,
  components, expiry/TTL, account ownership and status remain unverified.
- `staffAuthTemplateDefinition.js` describes the historical
  `shiloh_staff_auth_otp_v1/en_US`. It cannot supply this template's language or
  component contract. Its historical send gate stays disabled.
- `whatsapp.js` and `metaSignInOnly.js` reject generic sends; the mounted staff
  browser session router supplies no challenge dispatcher. Those remain intact.
- `RUNTIME_ENVIRONMENT_CONTRACT.md` records removal of automated Meta credentials.
  This task has not inspected secret values or independently read production
  environment configuration. No access, credentials, sends, spend, migrations,
  deployments or UI changes are included.

## Implemented preparation

`workspaceWhatsAppTemplate.js` validates an explicitly reviewed, account-bound
template against an injected provider inventory, requiring one exact approved
language variant and exact components. Missing language has no default. It
supports only a single Copy code button and a single body code parameter. The
payload contains the same code in body and button. Unsupported/mismatched expiry
fails closed. The sender rechecks inventory immediately before each attempt;
provider exceptions and uncertain responses cannot leak raw request data or
cause automatic retries. No HTTP client or credential lookup is supplied.

`workspaceWhatsAppAuth.js` implements purpose-bound issuance and verification
through a transactional store contract. Both modules require explicit dependency
injection and opt-in; neither is imported by any production entry point. Setting
an old or new environment flag cannot activate this draft.

Synthetic coverage exercises the actual core and payload builder, with a
transactional in-memory test double. It is not proof of PostgreSQL locking,
provider delivery, a browser ceremony or a real device. No test store is shipped
as a production fallback.

## Proposed authority model — requires cutover approval

| Purpose | Proof required | Permitted result |
| --- | --- | --- |
| Ordinary sign-in | Single eligible existing staff account at the canonical recorded mobile, valid browser-bound WhatsApp code | Ordinary `whatsapp_otp` session, fixed eight hours; preserve other sessions and all capabilities/scopes; never recent passkey assurance |
| Passkey enrollment through WhatsApp | A different active administrator with `staff_auth:reset`, `all_business` / `all_services` scopes and a live recent passkey session explicitly confirms identity, plus staff phone code | Five-minute, single-use, browser/identity/approval-bound `enroll` grant; later WebAuthn ceremony may add a credential, not replace existing ones |
| Passkey recovery through WhatsApp | Same independent administrator proof and phone verification, explicitly selecting recovery | Separate `recover` grant; replacement may occur only after successful WebAuthn verification and final authority revalidation |

The administrator's canonical session is looked up by the store, not accepted
from request JSON. At issuance it must be authenticated with a passkey within
the existing ten-minute recent-auth window. It must remain live and authorized
at code verification and at the future WebAuthn completion. A WhatsApp or details
session cannot approve recovery. No public staff registration, CRM-to-staff
binding, automatic role grants or mobile changes are allowed.

Existing details sign-in and optional own-account passkey enrollment retain
their current rules. The new alternative does not require codes globally.
Existing passkey sign-in remains preferred. A phone code proves possession of a
channel at that time; it is not passkey assurance.

Codes use unbiased cryptographic six-digit generation and expire within five
minutes, bounded by the explicitly reviewed template. Requests use 256-bit
opaque tokens. Only keyed hashes bind request, code, purpose, browser and staff
identity; no plaintext code/token/mobile enters challenge or audit storage.
Five wrong attempts revoke a challenge. Reissue invalidates the previous code
for the same purpose. Consumption and the resulting session/grant must commit
atomically. Failed/uncertain delivery revokes the challenge; provider acceptance
is not reported as delivery or reading.

Issue limits are shared across purposes: 3 per identity, 10 per browser, 30 per
server-derived network and 100 clinic-wide per ten minutes, plus 500 per day.
These are synthetic draft ceilings, **not an authorized spending budget**.
Activation must set an owner-approved smaller testing cap. Verify limits also
apply per network and clinic. Unknown, inactive, ambiguous and throttled targets
return the same acceptance shape with unusable decoy tokens. An eventual HTTP
boundary must prevent timing enumeration and apply request/body/IP limits before
any authenticated provider inventory call.

## Transactional adapter contract and remaining implementation

No new schema or migration is included. Existing SMS tables must not be renamed
or reused as WhatsApp records; legacy OTP rows lack purpose/approval bindings.
A separately authorized migration/persistence implementation is required.

`store.transaction(callback)` must provide a transaction-scoped adapter and
rollback all writes if the callback throws. Operations below must use the same
transaction; no external provider request may execute inside it:

- `takeRate(buckets, current)`: atomically reserve all keyed limits, using a
  deterministic lock order across workers; count failed sends conservatively.
  Persist windows across restarts; bound expiry cleanup.
- `adminsByMobile(mobile)`: canonical staff accounts including inactive
  collisions, with current linked staff state and persisted permissions/scopes.
- `admin(id)` and `session(id)`: lock/revalidate current staff and canonical
  session state. Session results include `ok`, `adminId`, `authMethod`,
  `authenticatedAt`, `expiresAt`, `revokedAt`, `recoveryRequired`.
- `insertChallenge`, `challenge`, `saveChallenge`, `revokeChallenges`: unique
  request hash; row/advisory locks must prevent concurrent resend, verify and
  approval changes from racing. States are pending, ready, consumed, revoked;
  a late send result must never revive a superseded challenge. Persist every
  field supplied by the core, including identity revision and approval session.
- `audit`: write only the explicit non-secret event fields to canonical staff
  security audit, with operator and subject; never pass provider exceptions.
- `issueSession`: issue canonical opaque HttpOnly/Strict staff credentials in the
  same transaction, honoring `preserveExistingSessions`, eight-hour deadline,
  current capabilities, and identity revision validation. Do not call the legacy
  WhatsApp session helper unmodified: it rotates other sessions. Do not add
  `whatsapp_otp` to strong-auth methods.
- `issuePasskeyGrant`: persist a separate hashed one-time grant; it is **not** a
  credential replacement or authenticated session. The later WebAuthn adapter
  must verify origin/RP/user verification and challenge, recheck browser,
  identity, approval/session and permissions, then consume atomically. Only
  successful recovery completion revokes prior credentials/sessions and issues
  a passkey session. Enrollment preserves them. Any failure preserves access.

Still required before this can become a working end-to-end integration:
PostgreSQL store/schema and real transactional concurrency tests; canonical
session integration/revision invalidation; passkey grant consumption and actual
WebAuthn completion; same-origin/CSRF/no-store routes; and reviewed UI. For
setup/recovery, bind administrator approval to an intent created on the staff
browser. Do not bind it to the administrator's browser or let a client supply
an arbitrary approval session ID. None of these adapters are implied by the
synthetic test results. They must preserve the authority model above and receive
the required implementation/cutover approvals before production use.

## SMS readiness and fallback

Read-only source evidence on the base commit:

- `clientSmsAuth.js` still implements SMSMessenger send and balance HTTP calls.
  The owner confirms SMS was already set up and identified `sms1.smsmessenger`;
  the existing source verifies the full configured endpoint host as
  `sms1.smsmessenger.co.za`. Reuse this existing provider integration where
  suitable, rather than provision a new account. No endpoint was called here.
  Gateway configuration requires `SMSMESSENGER_ACCOUNT_EMAIL` and
  `SMSMESSENGER_API_TOKEN`; service enablement separately requires
  `MY_SHILOH_SMS_AUTH_ENABLED`. Presence of code or historically retained keys
  does not establish operational readiness or current billing.
- `myShiloh.js` returns HTTP 410 from SMS start/complete endpoints. Older handbook
  entries describing September SMS production success are historical, not proof
  that current client SMS sign-in is active.
- `staffSmsDeviceSetup.js` and `staffPasskeyDeviceBootstrap.js` explicitly disable
  staff SMS bootstrap when details authentication is enabled. The bootstrap
  router also returns 410 for the retired setup paths in that mode. This is
  supervised device setup, not an enabled ordinary staff SMS login alternative.
- Runtime documentation retains SMS configuration, but current non-secret key
  presence, flag state, account balance and provider billing have not been read
  back. No recurring charge or price is established by repository evidence.
  The credit-balance API and quota code establish credit accounting, not whether
  the account has monthly fees, minimum commitments or expiring credits. A
  read-only billing statement/provider account review is needed; never fetch or
  paste credential values for that review.
  The owner believes the API key is already configured in Render. Available
  Render tools expose no environment-key-name/presence-only read action, so this
  task cannot safely verify that belief under the no-secret-read constraint.
  No environment update/readback workaround or credential replacement was used.

Proposed hierarchy: passkey preferred; explicit WhatsApp alternative; SMS backup
only after separate implementation, readiness tests and activation approval.
Do not automatically send both channels or retry an uncertain send through SMS.
Any fallback must invalidate the superseded challenge, share identity/purpose
and combined rate/spend limits, and provide clear channel selection. No fallback
code is activated or implemented by this draft.

For a WhatsApp outage with phone/SIM access, approved SMS backup could help. For
a lost phone or lost number, SMS to that same number is not independent recovery.
Use another already enrolled passkey/device or preserved valid session where
authorized. Otherwise require a separately reviewed supervised recovery process
with independent identity proof and a different authorized passkey administrator;
do not accept a new phone number plus a code as proof of the old identity. If no
authorized administrator remains available, escalate to the owner through that
controlled process; never bypass authentication. That lost-number process is
not introduced here.

Retain existing SMS settings during transition. Decommission only after an
explicit owner decision, current dependency/traffic audit, reliable physical
device sign-in and recovery/outage tests, a proven independent recovery route,
and review of actual fees, credits, cancellation and rollback consequences.
Do not remove shared client/staff credentials based only on WhatsApp readiness.

## Release and bounded owner acceptance

1. Obtain non-secret authenticated readback of the template/account and review
   exact language/components. Business verification alone does not verify the
   template contract or sending permissions. Pin the reviewed contract. The
   public Meta documentation fetch was rate-limited during preparation; verify
   the send payload against current official documentation before activation.
2. Approve the proposed authority model, migration/persistence work and final
   session/WebAuthn integration. Complete synthetic database, HTTP, enrollment
   and recovery tests, including rollback, mobile changes and revoked approval.
3. Review new UI in Storybook and desktop/phone Playwright with accessibility
   evidence. Passkeys should be the preferred action; details access remains.
4. Obtain explicit separate authority for exact credential/access configuration,
   any migration execution, deployment and security cutover. Keep live transport
   disabled until prerequisites and exact-head checks pass. Never request secrets
   in chat. No historical generic/client/bulk sender may be re-enabled.
5. Separately authorize one existing owner test identity, one intended recipient
   and a time-limited send/spend cap (proposed maximum three WhatsApp messages:
   sign-in, enrollment and supervised recovery). Another existing authorized
   administrator must approve setup/recovery; no self-approval exception.
   Use a disposable test passkey for replacement and confirm the implications
   for that account before recovery. Verify existing details/passkey entry first.
6. Check actual receipt, Copy code, successful sign-in, one-use rejection, add
   behavior and supervised replacement on a physical device. Use synthetic
   tests for abuse/expiry/provider-failure coverage rather than extra live sends.
   Stop on wrong recipient, unexpected charge, mismatch or access regression.
   Disable only the new channel and verify details/passkey access. Record
   provider accepted/delivered/read and owner acceptance separately.

No implementation in this draft implies approval to send, spend, migrate, release,
turn off SMS or change the production recovery policy.
