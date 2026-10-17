# Workspace WhatsApp authentication draft

Status: implemented for isolated review and synthetic testing; **unmounted,
not approved for production activation**. No live provider adapter, credentials,
spending, automatic migration or deployment is included.

## Accepted direction and open decisions

On 17 October 2026 the owner requested BOTH staff sign-in and passkey
setup/recovery. WhatsApp was the original intended code channel; SMS worked
while Meta verification was pending, and repeated-send cost concerns led to
CRM/staff-details matching. The desired shared approach now covers both apps:
WhatsApp as the main code method, passkeys as a convenient stronger option, and
bounded SMS fallback. Client code sign-in must be obvious and understandable
without knowing what a passkey is. Passkeys must not be a prerequisite.

This PR implements the **Workspace staging slice only**. The shared client
architecture below is planned, not implemented or activated. Staff and client
identities, sessions, authorization and recovery remain separate.

The owner approved the staff replacement safeguard on 17 October: another
authorized administrator approves the replacement and the staff member proves
access to their recorded phone with a code. If that phone is lost, recovery goes
through the owner or Christel after an identity check. This accepts the safeguard,
not an automatic lost-phone bypass or production activation. The owner has not
approved a mandatory cutover, retirement of existing details sessions, a financial
spend cap, credential changes or any live send. Keeping current details-only entry
working during preparation is a transition constraint, not a decision to retain
it permanently as a bypass. Final cutover must address that bypass explicitly.

## Implementation

- `workspaceWhatsAppTemplate.js`: explicit reviewed name/language/components,
  authenticated inventory dependency, exact approved-variant gate and Copy code
  payload. No language fallback, credential lookup or built-in HTTP sender.
  Rechecks the template before sending; never retries an uncertain send or exposes
  raw provider exceptions. Accepted is not delivered/read.
- `workspaceWhatsAppAuth.js`: separate sign-in/enrollment/recovery challenges;
  browser-bound setup intents; authenticated administrator review/approval;
  phone verification; grant-bound WebAuthn start/finish using the existing real
  attestation verifier. Staff identity, mobile, active state, collisions,
  administrator authority and session state are rechecked at each boundary.
- `workspaceWhatsAppStore.js`: explicit PostgreSQL dependency, transactions,
  canonical staff/session/credential records, durable hashed challenges and rate
  buckets. New-channel advisory serialization plus canonical row locks prevent
  concurrent mutation within the channel. Session issuance/credential changes,
  one-use consumption and audit commit together. No in-memory production fallback.
- `workspaceWhatsAppIdentity.js` and a narrowly scoped session-validator branch:
  new `workspace_whatsapp` sessions use a canonical identity revision and fixed
  eight-hour lifetime, preserve existing sessions and never qualify as recent
  passkey authentication. Mobile/details changes invalidate the new session.
  Existing session methods retain their behavior. Only the review migration
  admits the new method; production code issues none today.
- `workspaceWhatsAppAuth.js` router: unmounted, explicitly enabled composition;
  same-origin JSON, server-issued HttpOnly/Strict browser cookie, persistent HTTP
  quotas, canonical staff-session/CSRF checks for administrative approval,
  no-store responses and sanitized errors. Client-supplied approval session IDs
  are ignored. The staff browser creates the intent; the administrator approves
  that intent through their own session. Grant/code tokens stay out of URLs.
- `workspaceWhatsAppUx.js` and Storybook: staff sign-in, code entry, setup
  reference, administrator identity review and passkey saving. No existing
  sign-in screen or app navigation imports the new UI. Browser code stores
  transient tokens only in memory; no localStorage persistence. Unsupported or
  cancelled passkey creation preserves old access and needs fresh setup.
- `docs/proposed-migrations/workspace_whatsapp_auth.sql`: review-only additive
  records/rate schema and session-method constraint expansion. Deliberately
  outside `migrations/`, so startup cannot apply it. Synthetic databases apply it
  only after the real prerequisite migration files. Promotion/number assignment
  and production execution require separate authorization.

No files from PR #1475 are edited. Generic WhatsApp, client/bulk messaging and
historical staff OTP sender remain retired. No environment flag alone can mount
this flow or supply its missing live transport.

## Accepted replacement safeguard and draft enrollment policy

The replacement safeguard and supervised owner/Christel lost-phone escalation
are owner-approved. Applying the same administrator gate to ordinary additional
passkey enrollment remains the conservative draft design; the approval of
replacement must not be treated as approval for every enrollment-policy choice.

| Purpose | Required proof | Result |
| --- | --- | --- |
| Sign-in | Unique eligible canonical staff identity at recorded mobile, valid browser-bound WhatsApp code | Ordinary Workspace session; existing capabilities/scopes; no passkey assurance |
| Add a passkey through this flow | Staff-created intent; different authorized administrator's recent passkey session and explicit identity confirmation; staff phone code; successful WebAuthn ceremony | Add credential, preserve previous credentials/sessions, issue passkey session |
| Recover through this flow | Same separate administrator and phone proof, explicitly selecting recovery; successful revalidated WebAuthn ceremony | Replace old credentials and revoke old subject sessions only in the successful completion transaction; administrator session unaffected |

The implementation maps an authorized approver to active canonical identity, `staff_auth:reset`,
`all_business` calendar scope and `all_services` service scope. Self-approval,
details-session approval and code-session approval are denied. At approval and
code issuance the administrator must have a passkey authentication within the
existing ten-minute recent-auth window; their session and authority must remain
valid through code verification and WebAuthn completion. Enrollment and recovery
are not interchangeable. A code alone never replaces a credential.

No public staff registration, copying CRM identities, permission grants or mobile
changes occur. Existing details-based optional enrollment keeps its current
rules until a separately approved cutover changes them. Losing access to the
recorded number is outside this same-number phone-proof route.

Codes are unbiased cryptographic six-digit values with at most five-minute
validity, bounded by the reviewed template expiry. Opaque tokens carry 256 bits
of randomness. Request/code/browser bindings are keyed hashes; persisted identity
revisions are hashes of canonical staff fields. No plaintext code, request,
grant or mobile enters challenge/audit records. Five wrong attempts revoke the
challenge; reissue revokes the previous challenge for that purpose. Failed or
uncertain delivery cannot yield a usable challenge. Failed attestation consumes
the grant while preserving credentials/sessions; transaction failure rolls all
changes back.

## Verification and remaining engineering gates

The synthetic suite exercises the core with both a transactional test double
and the actual SQL adapter on PGlite and an isolated PostgreSQL 17 container,
using real prerequisite migration files and the review SQL. Tests cover canonical sessions and identity-change invalidation,
real WebAuthn attestation for add/recover, failed proof and revoked approver,
rollback on audit failure, HTTP same-origin/CSRF/cookie protections and a full
HTTP setup/approval/code/registration sequence. Existing details, passkey, SMS
and Meta-retirement regressions remain required.

The Playwright proof exercises phone/desktop code errors, setup references,
verification, explicit administrator confirmation, Storybook and axe checks.
The browser proof uses mocked transport and does not claim native physical-device
passkey creation. SQL tests use real WebAuthn response verification. PGlite is
single-connection. The same suite also runs against a local, synthetic-only
PostgreSQL database with up to eight connections: concurrent verification
issues one session, concurrent requests respect the shared send quota, and a
locked canonical mobile change prevents stale verification. This does not prove
every possible interaction with production administrative workflows. Exact-head workflow `Workspace WhatsApp draft proof` repeats the SQL,
regression, Storybook and browser checks and uploads screenshots.

Before live readiness, still required:

1. Authenticated template/account readback and current official Meta payload
   documentation verification. Provider inventory/read/send composition must
   enforce timeouts, exact account/phone binding and sanitized logging. The
   public documentation fetch was rate-limited during initial inspection.
2. Review query plans, bounded cleanup/retention and operational contention.
   Multi-connection race tests cover consumption, quota and a canonical identity
   mutation; assess additional legacy administration contention during release
   review. The global new-channel lock favors safety over throughput for this
   small staff population.
3. Review response timing/queue design before public exposure: generic response
   shapes alone do not prevent timing enumeration, because provider I/O can
   differ by eligibility. HTTP quotas run before provider reads but are not a
   substitute for timing protection or a durable delivery queue.
4. Resolve ordinary enrollment policy and approve cutover/session handling.
   Preserve the now-approved replacement safeguard. Final
   production composition must wire this router explicitly, provide the live
   sender securely and pass approved budget/configuration. Neither `app.js` nor
   any existing UI does so in this draft.
5. Review the interaction with existing SMS retirement gates: simply turning off
   details authentication can make historical SMS-bootstrap conditions true.
   A future cutover must deliberately preserve or replace that gate, not revive
   old recovery implicitly.
6. Physical-device acceptance, independent lost-number recovery, rollback and
   reviewed deployment/migration execution authority. Do not merge as a shortcut
   to activation.

## SMS readiness and cost evidence

The owner confirms existing SMS setup and historical successful use, naming
`sms1.smsmessenger`. The existing `clientSmsAuth.js` adapter verifies the actual
host `sms1.smsmessenger.co.za` and contains send/balance calls. Reuse this adapter
where suitable; no new provider account is presumed necessary. No endpoint was
called during this task.

Gateway configuration requires `SMSMESSENGER_ACCOUNT_EMAIL` and
`SMSMESSENGER_API_TOKEN`; enablement separately requires
`MY_SHILOH_SMS_AUTH_ENABLED`. Current `myShiloh.js` SMS start/complete routes
return 410. `staffSmsDeviceSetup.js`, `staffPasskeyDeviceBootstrap.js` and their
router disable/retire staff setup when details auth is enabled. Installed code,
retained keys and historical success are not proof of currently active login.

The owner believes the key is in Render. Available Render tools expose no
key-name/presence-only read, so that belief remains unverified under the
no-secret-read constraint. No workaround, replacement or settings change occurred.
Actual balance, recurring fees, minimum commitments and credit expiry are unknown;
credit accounting in code does not establish the billing contract. A non-secret
billing/account review is needed before cost or cancellation recommendations.

Owner suggestion: SMS once or twice daily. Parent proposal: two sends per account
per day plus device/IP throttles and an overall spend cap. These are not activated
limits; the monetary cap is undecided. Draft WhatsApp test ceilings likewise are
not spending authorization. Fallback must require explicit channel choice,
invalidate the superseded challenge, share combined identity/purpose and budget
limits, and avoid sending both channels or retrying uncertain delivery blindly.
SMS fallback implementation/activation is not part of this Workspace slice.

For a WhatsApp outage with phone/SIM access, SMS may help. SMS to the same number
cannot solve a lost phone/number. Another enrolled passkey/device or preserved
valid session may provide authorized access; otherwise the accepted escalation
is to the owner or Christel after an identity check. The exact evidence, audit
and credential-rebinding procedure still needs review; this draft deliberately
provides no lost-phone bypass. A new phone plus a code must
never prove ownership of the old identity. Do not create an authentication bypass
if all administrators lose access. Retain existing SMS settings until explicit
retirement approval follows dependency/traffic/billing review, reliable device
and outage tests, and an independent recovery route.

## Shared My Shiloh architecture — staged plan only

Clients should see a large, plain-language **Send me a WhatsApp code** action,
readable instructions and six-digit code entry with paste/autofill. Offer saved
passkeys as an optional quicker method, without jargon or a forced setup step.
Keep accessible labels, 48px controls, clear errors and help for older or less
experienced users. Do not show administrative staff recovery controls to clients.

Reuse transport contract validation, code lifecycle concepts and abuse controls,
not staff tables/sessions/grants or permissions. Use a distinct client template
contract/account-approved usage, purpose namespace, browser cookie, challenge
store, session assurance and recovery policy. The Workspace template is not
implicitly authorized for client sends.

CRM remains canonical for record association, clinical data and booking authority;
names/DOB are not sufficient authentication proof in the target design. Phone
possession must not silently link arbitrary existing CRM records. Before client
implementation, decide and test:

- Existing clients with a verified, unambiguous current binding: preserve that
  binding and require the new authentication proof without broadening data access.
- Duplicate, archived, unverified, changed or potentially recycled numbers:
  refuse automatic linkage and route to supervised identity resolution; never
  expose another person's records based only on a code to a matching number.
- First-time registration versus existing-record claiming: explicit separate
  authority and conflict checks, with no accidental account/record merges.
- Mobile change: independent proof of the existing account, new-number
  verification, collision checks, pending challenge/session revocation and
  an auditable notification/recovery policy.
- Migration of existing details sessions: explicit expiry/re-authentication and
  grace-period decision; do not silently preserve a permanent details-only bypass
  or unexpectedly lock people out before a tested alternative exists.

Implement a separate client draft after these binding/recovery decisions, with
synthetic CRM conflict/recycled-number tests, HTTP and accessible phone/desktop
proof, then bounded owner device testing. No live client change is authorized
by the shared architecture agreement alone.

## Approvals and bounded owner acceptance

Security cutover must approve required authentication proof, handling of old
details sessions and ordinary enrollment policy, while preserving the accepted
replacement safeguard. Specify the supervised lost-phone identity-check and
audit procedure before introducing a technical recovery path. Separately
approve migration promotion/execution, exact credential/access configuration,
deployment, and a named/time-limited live-send/spend budget. Never request secrets
in chat. Business verification does not prove template approval or sending access.

After synthetic/CI and device prerequisites pass, propose one existing owner test
identity and recipient, another authorized administrator, and no more than three
WhatsApp messages (sign-in, enrollment, supervised recovery). Confirm recovery's
credential/session consequences first; use a disposable test passkey. Verify
existing access first, actual receipt/Copy code, one-use rejection, add behavior,
then replacement. Use synthetic tests for expiry/abuse failures. Stop on wrong
recipient, unexpected charge, contract mismatch or access regression; disable
only the new channel and verify rollback access. Record provider acceptance,
delivery/read evidence and owner acceptance separately. No live SMS fallback
send or shutdown is included.
