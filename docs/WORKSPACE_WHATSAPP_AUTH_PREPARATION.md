# Workspace WhatsApp authentication draft

Status: implemented for isolated review and synthetic testing; **unmounted,
not approved for production activation**. Injectable provider adapters and explicit runtime/worker composition are implemented;
no live credentials, spending, automatic migration or deployment is included.

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
  payload. No language fallback or credential lookup; the separate provider adapter supplies bounded HTTP.
  Rechecks the template before sending; never retries an uncertain send or exposes
  raw provider exceptions. Accepted is not delivered/read.
- `workspaceWhatsAppProviders.js`: fixed Meta/SMSMessenger HTTPS endpoints,
  explicit API version, locale/components/account/sender contract, injected fetch
  and credentials only; sender membership plus template inventory readback;
  bounded response size/time; no redirects, pagination following, balance probe,
  automatic send retry or raw provider exceptions. Uses the existing
  SMSMessenger gateway through its additive five-minute Workspace-code method.
- `workspaceWhatsAppRuntime.js`: explicit opt-in composition, read-only schema
  readiness, inactive-until-prepared router, and bounded stoppable worker.
  Import/construction never starts delivery. `app.js` does not import it.
- `workspaceWhatsAppAuth.js`: separate sign-in/enrollment/recovery challenges;
  browser-bound setup intents; authenticated administrator review/approval;
  phone verification; explicit safe SMS fallback; grant-bound WebAuthn start/finish using the existing real
  attestation verifier. Staff identity, mobile, active state, collisions,
  administrator authority and session state are rechecked at each boundary.
- `workspaceWhatsAppStore.js`: explicit PostgreSQL dependency, transactions,
  canonical staff/session/credential records, durable hashed challenges and rate
  buckets. New-channel advisory serialization plus canonical row locks prevent
  concurrent mutation within the channel. Session issuance/credential changes,
  one-use consumption and audit commit together. No in-memory production fallback.
- `workspaceWhatsAppIdentity.js` and a narrowly scoped session-validator branch:
  new `workspace_whatsapp`/`workspace_sms` sessions use a canonical identity revision and fixed
  eight-hour lifetime, preserve existing sessions and never qualify as recent
  passkey authentication. Mobile/details changes invalidate the new session.
  Existing session methods retain their behavior. Only the review migration
  admits the new methods; production code issues none today.
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
this flow or configure its provider/runtime dependencies.

## Accepted replacement safeguard and draft enrollment policy

The replacement safeguard and supervised owner/Christel lost-phone escalation
are owner-approved. Applying the same administrator gate to ordinary additional
passkey enrollment remains the conservative draft design; the approval of
replacement must not be treated as approval for every enrollment-policy choice.

| Purpose | Required proof | Result |
| --- | --- | --- |
| Sign-in | Unique eligible canonical staff identity at recorded mobile, valid browser-bound WhatsApp code or explicitly selected, safely admitted SMS fallback | Ordinary Workspace session; existing capabilities/scopes; no passkey assurance |
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
   documentation verification. Injectable transport now enforces bounded calls,
   exact account/phone binding and sanitized outcomes synthetically. Official
   Meta documentation retrieval still returned HTTP 429 on 17 October; live API
   compatibility and exact locale remain unverified.
2. Review query plans, bounded cleanup/retention and operational contention.
   Multi-connection race tests cover consumption, quota and a canonical identity
   mutation; assess additional legacy administration contention during release
   review. The global new-channel lock favors safety over throughput for this
   small staff population.
3. Durable dispatch now repairs the confirmed provider-latency disclosure in this
   unmounted draft. Public intake performs no identity lookup, inventory read or
   send. Eligible, unknown, inactive and ambiguous identities use the same queue
   insertion path, subject to input-based quotas. The worker alone resolves
   eligibility and approval. Test operational contention before public exposure;
   this is not a claim of constant-time database execution.
4. Resolve ordinary enrollment policy and approve cutover/session handling.
   Preserve the now-approved replacement safeguard. Final
   production activation must explicitly mount the prepared composition and start
   its worker with securely supplied, approved configuration and budgets. Neither
   `app.js` nor any existing UI does so in this draft.
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
SMS fallback is now implemented and synthetically tested in this isolated
Workspace slice. Its activation is not authorized; client fallback remains planned.

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

### Durable dispatch repair (17 October 2026, draft only)

`begin` persists an intake ticket and returns generic acceptance before delivery.
The separate `dispatchOne` worker is neither scheduled nor mounted. The proposed
SQL adds a dedicated intake table outside the production migrations directory.
Queued phone numbers use AES-256-GCM with a domain-separated key and request-hash
associated data; browser and intent references are hashes. Neither plaintext
phone numbers, request tokens nor OTPs are stored in this queue. The worker keeps encrypted phone input through a claim so an explicit SMS
request can follow a proven pre-send failure; it erases the ciphertext on
accepted/uncertain completion or final SMS completion. Expired records are
removed by bounded worker cleanup. Claimed records are never automatically reclaimed. Queued work expires within five minutes and
cleanup is bounded. Rate reservations include decoys and failed deliveries and
remain conservative draft ceilings, not an approved monetary budget.

A claim commits before provider I/O and cannot be reclaimed after restart. Codes
are generated only in worker memory, persisted as keyed hashes bound to the
request hash and purpose, and become usable only after confirmed provider
acceptance. Unknown acceptance, worker crash or failed completion never triggers
automatic retry or SMS fallback on uncertainty. A fresh owner request is required; this trades
some delivery reliability for avoiding duplicate/uncertain sends. Existing codes
superseded during delivery cannot be revived by a late provider response.

Synthetic tests cover the public path with identity reads forbidden and provider
readiness stalled, same acceptance under throttling, encrypted persistence,
concurrent claims, restart after an uncertain send, queue expiry, approval
revocation, superseded sends, and real PostgreSQL authentication transactions.
Transport timeouts and an opt-in worker are implemented and synthetically tested.
Operational worker configuration, key provisioning/rotation, approved costs,
account/template verification and production activation remain release prerequisites.
No live transport or worker was activated.

### Provider, runtime and SMS phase (17 October 2026)

Owner screenshots establish template `shiloh_workspace_verification`, ID
`2270342923759541`, Authentication, Active – Quality pending, plain English,
Copy code, security recommendation, and a displayed five-minute expiry. They do
not establish exact API locale/components, delivery TTL, WABA/sender membership
or successful delivery. None is inferred from the screenshots or historical
`en_US` configuration. Test fixtures use fabricated IDs/version/locale only.

The isolated runtime requires an explicit reviewed template, WABA and sending
phone IDs, API version, injected credential values/fetch/database/session service,
HMAC/encryption key, and budgets. Missing configuration or review schema leaves
its router at 404 and worker disabled. `prepare()` only checks database readiness;
it does not verify providers or send. `worker.runOnce()` processes a bounded batch;
`worker.run({signal})` is explicitly started/stopped by a future reviewed host.
No startup entrypoint, schedule, Render service or live configuration was added.

SMS is requested explicitly from the existing browser-bound intake, never by
supplying a new phone number. Before a worker claims WhatsApp, that choice can
switch the queued attempt to SMS. During preflight it records the preference,
which proceeds only after a confirmed no-send result. A claimed/accepted/uncertain
send never causes a second-channel send. Pending or uncertain challenges also
block other requests for the same staff account until expiry. Both channels
share intake limits and atomic daily ZAR-minor-unit spend reservations; SMS adds
per-account and clinic daily counts. Reservations are not refunded on failure.
No monetary default is enabled: costs and cap must be explicitly supplied after
owner/provider review. Two SMS per account per day appears only in synthetic
configuration as the proposed policy, not an approved production default.

Both channels preserve five-attempt, one-use, browser/purpose/identity binding,
existing staff permissions, optional passkeys and administrator-supervised
recovery. SMS sessions use `workspace_sms`, never recent strong authentication.
Retired client/staff SMS routes and legacy generic WhatsApp senders stay retired.
The additive SMSMessenger method does not change existing send methods.

Tests cover provider contract drift/missing locale, sender membership, fixed
hosts, redirects/pagination, response-size/time bounds, uncertain responses,
explicit fallback races, cross-request uncertainty, shared monetary reservations,
the proposed daily SMS cap, canonical SMS sessions and recovery revocation.
Phone/desktop live-router and Storybook screenshots include the SMS choice and
request acknowledgement; axe checks must remain clear. All provider fetches use
synthetic responses; database integration uses isolated local PostgreSQL only.

The smallest next client phase is a separate My Shiloh draft for existing clients
with an already verified, unique canonical binding. First decide which records
qualify, supervised handling of duplicate/unverified/recycled numbers, and the
old details-session transition. Keep first-time registration, record claiming,
mobile changes and lost-number recovery separately authorized. Reuse bounded
transport mechanics, never staff sessions/entitlements/recovery controls. Client
UI, client challenges/session assurance and client template usage remain unimplemented.
