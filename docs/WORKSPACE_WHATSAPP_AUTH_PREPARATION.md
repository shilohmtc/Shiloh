# Workspace WhatsApp authentication

## Accepted immediate client-details retirement — 20 October 2026

After the read-only eligibility audit, the owner initially selected a phased
transition, then explicitly changed the decision to: **“switch off details
sign-in for all clients immediately, leaving WhatsApp and saved passkeys as the
only ways in.”** This supersedes the phased transition and earlier details-first
client standard. The owner was told that clients without either ready alternative
may need Reception's help. Do not preserve a hidden biographical fallback or
silently verify, claim, merge or overwrite those records to manufacture access.
Keep SMS and recovery off and the approved **separate R5 estimated daily client
allowance**. Staff configuration, proof keys, permissions and counters stay intact.

Existing client sessions retain their original fixed 30-day deadline. Existing
saved keys stay valid; native first-key enrollment from a valid remembered session
keeps its current own-account authority without extending expiry or upgrading
phone verification. Registration still collects name, surname, birth date and
gender as canonical profile data after phone proof, never as sign-in secrets.

### Verified client contract and runtime

PR #1485 deployed disabled preparation and a temporary read-only preflight. The
private Meta API readback confirmed `shiloh_client_verification`, id
`1990004245004579`, exact language **`en`**, `APPROVED`, `AUTHENTICATION`,
`message_send_ttl_seconds:300`, security recommendation, five-minute footer and
Copy code URL button. The reviewed contract is now versioned in
`src/config/clientWhatsAppManifest.json`. Never substitute the Workspace template.
Startup rechecks the WABA's sending-phone membership and exact live template;
each delivery checks inventory again. Drift/unavailability closes the channel.

One production composition supplies mount, readiness, worker and graceful stop.
It is inert unless explicitly enabled with the reviewed client manifest and a
separate random 32-byte client HMAC key stored only in Render. An explicit
`MY_SHILOH_CLIENT_WHATSAPP_CREDENTIAL_SOURCE=workspace_business` reference reuses
the established business sender credential inside the process only when WABA,
sending phone and API version exactly match both manifests. It neither reads
secrets back into chat nor copies, rotates or alters staff credentials. Independent
client credentials remain supported. Never log token/key values or customer data.

`client_code_rates` atomically reserves the conservative R1 estimate per attempt
against R5 per South African day, alongside the existing 50-code clinic,
three-code person and 60-second cooldown limits. R5 therefore permits at most
five estimated attempts daily, across people, purposes, concurrency and restarts.
Uncertain attempts consume the reservation. These are app estimates, not a Meta
invoice guarantee. No counter reset, automatic SMS fallback or recovery activation.

Codes admit only one active, registered, already phone-verified canonical client
with unique phone ownership and no historical contact conflict. New numbers must
prove possession before canonical registration. Imported, unverified, archived,
shared or conflicting records require existing Reception/Christel/JP handling;
code possession cannot upgrade them. Current account authority is rechecked at
proof consumption; existing session/key checks and protected-action freshness stay.

`MY_SHILOH_CRM_AUTH_RETIRED=true` closes the complete CRM entry subtree before
session/identity/database work and disables issuing in the old service. Pages
remove details forms and offer saved passkeys plus the ready WhatsApp channel.
An unavailable provider omits WhatsApp and offers human help; no old fallback is
restored. Cached old requests receive private/no-store 410 responses.

### Controlled migration and cutover

The current database is available on paid Render Postgres Basic, PostgreSQL 18;
Render documents continuous managed PITR for paid instances, with a minimum
three-day window depending on workspace plan. This is provider recovery
availability, not a newly performed restore rehearsal or exported backup. The
client migration is additive and its transaction rollback/forward recovery is
rehearsed on isolated PostgreSQL 18. Never restore production as a rollout probe.

Migration `198_my_shiloh_client_code_auth.sql` is additive: one nullable session
revision field, client proof/queue and quota tables/indexes, and the shared
invitation table only if absent. It changes no client verification, account,
permission, session deadline, key, staff counter or invitation row. Five-second
lock and thirty-second statement limits bound execution. Transaction rollback
must leave both schema and ledger unchanged on failure.

1. Freeze the exact reviewed source and migration inventory; verify the existing
   paid Render Postgres recovery boundary and prior running source. Pass native
   PostgreSQL, repository, Storybook, phone/desktop accessibility and every
   applicable exact-head release workflow. Do not mistake green builds for a
   handset receipt or authenticated production journey.
2. Before the tested merge, save only
   `SHILOH_CONTROLLED_RELEASE_MIGRATION=198_my_shiloh_client_code_auth.sql` and
   disabled client settings. Main's automatic deployment invokes the established
   controlled single-file executor. Unexpected pending files/checksum drift fail
   closed. Verify 198 ledger/file checksums and physical readiness; clear the
   temporary execution flag after success. Never invoke the broad migrator.
3. Start the reviewed client runtime, check approved Meta readiness and preserved
   staff/client paths, then activate client details retirement. Record exact
   deployed commit, startup state and health after traffic moves. The owner's
   immediate retirement decision replaces the earlier all-client readiness wait;
   physical client receipt, native key save and re-entry remain human acceptance,
   not implied by synthetic tests. Do not initiate a client message as a probe.

Recovery after migration must retain file 198 and its ledger/schema in every
restartable release. Disable only the new client channel or revert the retirement
flag if a real release fault requires rollback; do not delete records, reset
quotas, change verification or enable SMS/recovery. An older artifact lacking 198
cannot pass migration verification after the additive migration commits.

Status: production activation candidate under test. Client delivery and retirement
remain off until this release's exact-head checks and runtime readiness pass.
Release and remaining human acceptance evidence belong on its dedicated PR.

## Accepted staff-details retirement — 18 October 2026

The owner requested retirement of name/surname/date-of-birth sign-in through
implementation. After confirming only Christel and JP had tested their saved
passkeys, the owner explicitly instructed: "but it doesn't matter you can continue
with the retiring". This supersedes the earlier all-staff device-acceptance gate
for this cutover. It does not claim the other four staff completed device testing.
The existing six active accounts passed WhatsApp eligibility/readiness at rollout;
recorded-mobile WhatsApp remains their alternative. Preserve the R5 shared
staff-code app reservation allowance and counters, SMS/recovery off, existing
passkeys and active sessions. A code allowance may run out; it is not a guarantee
of provider billing. No extra messages, budget increase or lost-number bypass.

`SHILOH_STAFF_DETAIL_AUTH_RETIRED=true` is a separate, explicit retirement switch.
It overrides the old enabled/key settings, closes the complete details router
(including cached JS, setup and sign-in POST) with private/no-store 410 responses,
and stops service-level issuance before database work and again before issuing.
Name/DOB fields and historical records are retained; no destructive data cleanup
or migration is part of this release. Existing details sessions retain their
original eight-hour deadline and identity/revocation checks. They retain their
already-authorized own-account key rights until expiry; saving a key does not
upgrade assurance or extend the session. Protected administrator changes continue
to require their existing passkey confirmation.

Own-passkey compatibility is independent of details issuance, so retirement
cannot reopen legacy SMS, private bootstrap, replacement or rename endpoints,
even if the old flag is disabled or absent. Existing saved-passkey owners no
longer need obsolete biographical fields to manage their own keys. WhatsApp
sessions retain the separate purpose/browser/session/identity-bound enrollment
flow; they are not admitted to legacy mutation methods. Sign-in, account, Staff
access and onboarding surfaces point to saved passkeys/recorded-mobile WhatsApp,
with no obsolete details form, edit link, SMS or private-setup instructions.

Release after exact-head gates: deploy source with retirement off, verify the
six-account WhatsApp channel is healthy, then save only the retirement flag true
through a merging Render environment update. Verify the same deployed source,
private `detailsSigninRetired` readiness, unchanged migration ledger and health.
Rollback is that one flag false, restoring only the prior details behavior;
never reset counters, delete records, rotate credentials or revive SMS/recovery.
Only Christel/JP physical device acceptance is confirmed. Additional-staff device
checks remain outstanding under the owner's explicit cutover instruction.

Status: implemented locally; 80 PostgreSQL integration regressions and the
retirement phone/desktop browser and Storybook proof passed with zero axe
violations. Repository-wide and exact-head release gates precede cutover;
retirement is not live yet. Release evidence will be recorded on the dedicated
retirement PR.

## Accepted ongoing staff rollout — 18 October 2026

This section supersedes the Christel-only pilot scope below. The owner confirmed
saved-passkey sign-in and JP sign-in worked, then requested access for everyone.
"Everyone" here means existing active Workspace accounts with their established
permissions, active linked Staff when applicable, and a unique valid recorded
South African mobile. It does not grant roles, provision accounts, or include CRM
clients. Staff details, installed apps, saved passkeys and existing sessions stay
working. SMS, recovery and administrator-mediated setup remain off; authenticated
staff can add their own passkey using fresh bound proof.

The owner chose **R5 estimated app allowance for the whole clinic per 24 hours**,
reserving R1 per WhatsApp attempt. Preserve the existing anchored 24-hour spend
bucket and its usage on cutover/restart; do not reset it or rotate the HMAC key.
The existing ten codes per South African calendar day across the clinic and ten
per person remain additional ceilings. Thus R5 permits at most five new reserved
attempts in a fresh spend window; earlier pilot reservations count too. It is not
a guarantee of Meta's invoiced charges. No automatic live test messages or retries.
Saved-passkey sign-ins consume no WhatsApp allowance. Staff sessions currently
expire eight hours after authentication, not 30 days; the 30-day setting belongs
to My Shiloh client sessions. This release does not change session lifetimes.

Implementation is default off. `SHILOH_WORKSPACE_WHATSAPP_STAFF_ENABLED=true`
selects the strict `SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST`, containing `staff`
with `audience: active_workspace_accounts`, a stable scope ID and an explicit
zoned `startsAt`, plus the reviewed template, sender/API and budget fields.
There is no pilot end time in this ongoing mode. Both pilot and staff flags true
fail closed before database/provider work. Preserve the existing secret/token.
Startup checks schema, canonical eligibility and fresh authenticated Meta template
and sender inventory. Ineligible accounts are reported privately by ID/name/reason
without full phones or authentication material; eligibility is revalidated for
every send and continuation. New eligible canonical accounts need no static list.

After exact-head checks and deployment, atomically save the staff manifest and
staff flag true with pilot flag false, using a merging Render environment update.
That API save can trigger its own deployment: follow it rather than triggering a
duplicate. Verify deployed SHA, private startup readiness, unchanged migration
ledger, health and preserved public entry paths. No migration is needed. Owner
initiates any actual code/passkey check. Any blocked account needs correction of
its existing canonical record by established authorities, never a new access grant.

Records/queues/grants are bound to the selected mode's scope. Staff workers ignore
pilot/legacy queue rows, and neither mode can complete the other's challenges or
grants. Pilot mode alone accepts legacy unscoped pilot records. Daily quota,
cooldown, uncertain-send and spending keys remain shared and unchanged. Rollback:
disable staff flag to close only WhatsApp; retain schema migration 197, existing
sessions/credentials, stable scopes and all counters. A reviewed pilot reversion
must still satisfy its original expiry and lifetime caps; never replay staff
queue rows through it or reset allowances.

**Status:** implemented locally; 12 ongoing-staff regressions and 47 existing
pilot/release/integration tests pass. Phone/desktop production-backed Storybook
and navigation proof passed for two synthetic accounts with no automatic sends
or ceremonies, and axe accessibility checks passed. Exact-head release checks
are pending; wider staff access is not yet deployed or activated. Device acceptance above is owner-reported
pilot evidence, not proof that all staff have completed enrollment.

## Authorized staff release — 18 October 2026

This section supersedes earlier draft-only execution boundaries and readiness
statements below. The owner instructed “please continue until live” and delegated
the pilot window/cap with “sounds good just continue.” This authorizes necessary
implementation, exact-head checks, merge, secure setup, controlled staff migration
and deployment within the following scope. It is not production acceptance.

- Christel is the staff tester; JP is the separate administrator. Canonical IDs,
  active account status and Christel’s unique valid recorded phone must be read
  from production before enabling. Names never grant permissions. No permissions
  are added. Recovery and SMS are forcibly off in the production composition.
- At most three WhatsApp attempts in one hour starting when activation is ready.
  The stable scope survives restarts and purpose changes. R5 total estimated app
  allowance, with R1 reservation per attempt, is a conservative operational bound,
  not a Meta invoice guarantee. No automatic sends, retries, client/bulk/marketing
  sends or new infrastructure purchase are authorized. Owner initiates the device
  tests. Stop after allowance, expiry or any recipient/access/contract discrepancy.
- Existing staff details, passkeys, sessions and client paths remain available.
  Client code runtime/schema remain unmounted/unmigrated pending its own template.
  Staff-details retirement and recovery revocation acceptance remain separate.

The production adapter now shares canonical sessions and a small dedicated database
pool. Its default is disabled. It mounts the bounded staff router, starts only
after schema and fresh authenticated Meta inventory/sender checks, and drains its
worker before shutdown. Missing configuration or failed readiness closes only the
pilot. Successful saved-passkey entry offers optional invitations only for the
pilot subject; a hook failure preserves ordinary Workspace entry.

Protected Render keys (never record values here):
`SHILOH_WORKSPACE_WHATSAPP_PILOT_ENABLED`,
`SHILOH_WORKSPACE_WHATSAPP_PILOT_MANIFEST`,
`SHILOH_WORKSPACE_WHATSAPP_META_ACCESS_TOKEN`, and
`SHILOH_WORKSPACE_WHATSAPP_AUTH_KEY` (a dedicated random 32-byte hex key).
The bounded manifest contains only pilot IDs/scope/window/caps, reviewed template,
WABA/sender/API version and explicit ZAR budget reservations. Token/key values do
not belong in the manifest or Git. The owner must enter the permanent Meta token
securely in Render using Save only; connected tools cannot retrieve/provision a
Meta production token. Never send a password, token or verification code in chat.

The first deployment keeps the pilot disabled and temporarily enables
`SHILOH_WORKSPACE_WHATSAPP_PILOT_INSPECT=true`. Its private deployment log selects
only candidate canonical identities, active statuses/scopes and last four phone
digits plus uniqueness count. It does not select credentials or full phones and
does not grant account IDs. Set inspection false after resolving the explicit IDs.
External Render database inspection failed because of its existing access policy;
do not widen that policy. Use this bounded internal read-only diagnostic instead.

Migration `197_workspace_whatsapp_pilot.sql` is the sole authorized pending
migration. Before the tested merge, save
`SHILOH_CONTROLLED_RELEASE_MIGRATION=197_workspace_whatsapp_pilot.sql` through
Render’s merging environment update. API configuration saves do not deploy by
themselves; main’s automatic deploy runs the existing controlled executor against
this exact file. It transactionally preserves the old session constraint expression
and adds staff proof/rate/queue and invitation tables, with five-second lock and
thirty-second statement limits. Do not run the broad migrator or client SQL. Clear
the flag after successful ledger verification. Unexpected pending/checksum state
must fail startup and retain the previously running service.

**Rollback must retain migration 197.** After its ledger row exists, the old
7d3dec artifact cannot pass startup inventory verification because it lacks that
file. Disable the pilot and redeploy this schema-compatible release; any reviewed
forward revert must retain 197 and the additive auth methods. Do not delete ledger
rows/tables or narrow constraints, replay claimed sends, reset scope/quota, or
re-enable recovery to repair access. The old running process remains compatible
with the additive migration, but it is not a restartable rollback artifact.

Local release rehearsal: all 60 isolated PostgreSQL 18 tests and 26 focused
release/pilot/retirement tests passed. Lint, Storybook, staff/client browser proofs
and the saved-passkey pilot phone/desktop proof passed with zero axe violations;
the resulting screenshots were inspected. The complete repository suite and
exact published-head workflows must finish before merge. No production mutation
or live message has occurred at this checkpoint. Synthetic tests and API
acceptance never prove physical receipt, passkey device acceptance or recovery.
The first owner acceptance uses sign-in and ordinary self-enrollment only; retain
all existing keys/sessions. Leave the third attempt unused unless needed inside
the same allowance. No recovery acceptance is implied.


## Reconciled owner decisions — 17 October 2026, 21:35 SAST

This section supersedes conflicting proposals and undecided-policy statements
below. Those earlier sections describe the original draft implementation and its
historical evidence; acceptance of a policy is not evidence of implementation.

| Area | Accepted behavior |
| --- | --- |
| Primary channel | WhatsApp code; saved passkey is the convenient optional sign-in method. |
| SMS | Explicit fallback after confirmed WhatsApp failure or expiry, never an automatic second send. Uncertain delivery must not duplicate an active attempt. Expired/superseded WhatsApp codes must be unusable before fallback. |
| Staff ceiling | 10 codes per clinic per South African calendar day across WhatsApp and SMS, all staff purposes combined. At most 2 SMS per staff member per day. |
| Client ceiling | Separate 50-code daily client allowance across both channels; at most 3 codes per client per day, of which at most 1 is SMS. Registration and recovery must count too. |
| Resend | At least 60 seconds between code requests/sends for a person; channel or purpose changes cannot reset it. Passkey entry works when a code ceiling is exhausted. |
| Invitations | After each successful sign-in, show optional passkey and notification invitations until the corresponding feature is enabled. Not now dismisses for that sign-in only. Never automatically open a credential or notification permission ceremony; blocked permission shows settings guidance. Do not prompt on every navigation or refresh. |
| Staff enrollment | A valid current own-account session plus existing-passkey confirmation or a fresh code to the recorded number may add a passkey without administrator approval. Bind proof to account, session, browser and enrollment purpose; recheck canonical identity at completion. |
| Staff recovery | Lost/stolen-phone replacement remains supervised by Christel/JP. Preserve administrator approval, recorded-phone proof where available, atomic replacement and revocation of old sessions. No-code lost-number recovery needs a separately reviewed identity-check procedure; no automatic bypass. |
| Staff cutover | Keep current details entry during the pilot; retire it after successful code sign-in, passkey setup and recovery acceptance. Explicitly decide old details-session expiry/re-authentication before cutover; do not revive retired legacy SMS/setup endpoints. |
| Client registration | Verify the number, collect existing required profile fields and create through canonical CRM registration after conflict checks. Never create public staff accounts. |
| Client exceptions | Duplicate profiles, shared/changed numbers and lost-account recovery go to Reception, Christel or JP. No automatic CRM merge, record claiming by code alone, or extra email-recovery flow. |
| Client sessions | Preserve the accepted fixed 30-day client session policy. Staff retain their separate existing session lifetime and permission model. |
| Release | Build and draft review are authorized. This is not production migration, credential provisioning, deployment or live-message authorization. |

### Implemented continuation — isolated draft only

Staff self-service enrollment now requires a canonical current own-account session
and either a recent own passkey session or a fresh code to the canonical recorded
phone. The HTTP entry requires session validation and CSRF. The resulting grant
binds account, session, browser, purpose and identity revision; the session and
identity are rechecked through real WebAuthn completion. Ordinary enrollment adds
a key and preserves access. Supervised recovery retains its independent recent
passkey administrator, phone proof, atomic replacement and old-session revocation.
No public staff registration or lost-number bypass exists.

Code dispatch reserves the accepted audience/day/person/channel ceilings in SQL.
Daily boundaries use Africa/Johannesburg. A durable notBefore schedule preserves
queued requests through the 60-second cooldown; a restart does not reset it.
An explicitly requested SMS follows a definite no-send result or an expired code.
The old code is revoked before SMS dispatch, both sends count, and a pending or
uncertain delivery cannot create a second active code. Claimed sends are never
reclaimed. Provider calls are bounded and never automatically retried.

Both staff and client code sign-ins lead to optional invitations. Invitation visits
are keyed to the issued session: refreshing or navigating does not repeat them,
while a new sign-in can show them again. Passkey state comes from canonical keys;
notification state is checked for this account and browser subscription. No visit
opens a native ceremony. Not now continues; blocked permission explains phone or
browser settings. Existing app notification controls perform permission changes.
The welcome endpoints can also be used as the success destination of existing
passkey sign-in at activation; current production passkey navigation is unchanged.

The separate client composition implements WhatsApp-first sign-in and new-client
registration with its own cookie, HMAC namespace, encrypted queue, SQL records,
quotas, sessions and authorization. Its public intake does no identity lookup or
provider work. A code may sign in only an active registered canonical CRM client
with one verified mobile owner. Unverified, archived, duplicate and historical
contact collisions fail closed for Reception/Christel/JP resolution. Code possession
never upgrades or claims those records.

New-client registration verifies the phone first, then accepts the existing first
name, surname, birth-date and gender fields. It rechecks all conflicts and creates
through the canonical CRM registration service inside the same transaction as
proof consumption and session issuance. It never updates/merges an existing
profile. Profile grants are one-use and browser/purpose bound. Client sessions
retain their fixed 30-day deadline; the new sessions bind a canonical identity
revision so mobile/profile drift invalidates them. Existing sessions are preserved.

`clientCodeRuntime.js` requires an explicitly reviewed distinct client template;
the Workspace contract cannot silently authorize client sends. That client
contract has not yet been supplied, so client live readiness remains blocked.
Both compositions are unmounted and workers start only through explicit calls.
No production entrypoint imports either runtime. SQL remains review-only in
`docs/proposed-migrations/`, outside automatic migrations. PR #1475 files are
untouched. No credentials, live messages, spending, migration or deployment occur.

### Provider evidence and operational boundaries

Authenticated Graph API v26.0 readback on 17 October verified WABA
1114297824590105, sender 1310303435498156 (canonical business sender; full number omitted), and APPROVED template
2270342923759541 / shiloh_workspace_verification / exact language en. The non-secret
fixture retains BODY, FOOTER, URL button, examples and 300-second message TTL.
The URL carries otp_type=COPY_CODE and code_expiration_minutes=5; no separate
button otp_type property is required. Every send rechecks exact authenticated
inventory and sender membership. Fixed HTTPS hosts, bounded bodies/timeouts,
no redirects and sanitized errors remain enforced. Acceptance is not delivery.

Meta's calculator displayed USD 0.0095 per delivered South African authentication
message, before tax/FX. SMSMessenger displayed 460 credits and purchase offers of
R0.29 (50–499), R0.27 (500–1000), R0.25 (1001–5000), excluding 15% VAT; the price
paid for existing credits was not shown. Daily count ceilings are the accepted
primary cost control. R20 remains an earlier proposal, not a forecast or activated
money cap. The old SMS credential entries remain; inspected Render configuration
had no Meta API credential entry. No secrets were read, copied or provisioned.

### Verification and release gates

Synthetic tests cover transactional one-use consumption, real WebAuthn,
canonical changes/revocation, concurrent requests, cooldown/restart/expiry,
uncertain outcomes, shared ceilings, registration conflicts, cookie/CSRF/origin
boundaries and session-scoped invitations. Both SQL suites run on isolated
PostgreSQL 17 as well as PGlite; no production database is used. Storybook and
phone/desktop Playwright/axe checks cover both audiences and invitation screens;
actual screenshots must be inspected. Tests do not prove physical-device or live
delivery acceptance. Exact published-head CI remains required before review.

Before activation: review operational query plans/contention/cleanup and worker
hosting; approve/configure the distinct client template; securely provision the
reviewed provider/key configuration; promote/execute reviewed SQL; wire all
successful sign-in destinations to invitations; approve details-session transition
and supervised lost-number evidence/audit procedures; and authorize deployment
with a rollback plan. Keeping current details entry during the pilot does not
retain a permanent bypass. Do not revive retired SMS/bootstrap/generic senders.

Proposed owner acceptance uses one designated staff identity and another authorized
administrator, a disposable passkey, and at most three WhatsApp messages (sign-in,
add, supervised recovery), after explicit recipient/time/spend authorization.
Confirm existing access first and replacement consequences before recovery.
SMS and client sends require separately bounded allowances. Verify actual receipt,
Copy code, one-use rejection, passkey addition and supervised replacement. Stop
on wrong recipient, contract mismatch, unexpected cost or access regression;
disable the new channel and verify rollback access. Record provider acceptance,
actual receipt and owner acceptance separately. No live send is authorized here.

## Staff pilot release plan — prepared 18 October 2026

### Inactive pilot adapter implementation — 18 October continuation

Owner's subsequent instruction to continue authorizes the staged adapter build.
`workspaceWhatsAppPilot.js` now supplies explicit mount/start/stop composition;
production entrypoints still do not import it. No environment variables, process
listeners, provider requests or database queries are created by construction.
Application call sites, protected configuration and authorized deployment remain
release work. Earlier prerequisites below are the release sequence, not a claim
that the pilot has been activated.

Configuration must select Christel's verified canonical subject ID and JP's
verified independent administrator ID; names are never matched automatically.
An explicit stable scope ID, zoned start/end timestamps, at most three messages,
and a positive conservative monetary reservation cap are required. Values are
not supplied by this draft. Recovery defaults off and SMS is forcibly disabled
for this WhatsApp-only adapter. Existing broader staff/client compositions are
unchanged; the client runtime remains unmounted.

The selected subject is enforced before provider reads, during reservation,
verification, self-service enrollment, administrator approval and WebAuthn grant
completion. JP must still have a current independent recent passkey session and
the canonical recovery permissions. A configured name/ID cannot manufacture those
permissions. The total pilot message/spend reservations use the existing locked
SQL rate authority and expire only at the configured pilot end; process restarts,
purpose changes and the daily reset cannot replenish them. Reservations are
conservative attempts, not proof of delivery or the provider invoice. Keep the
scope and dedicated key stable throughout the window; do not rotate either to
regain allowance.

Start coalesces concurrent callers, checks schema before opening intake, and
manages one abortable worker. Stop synchronously closes the new HTTP channel and
grant use, waits for bounded started work to settle, and cannot restart the same
instance. A stop during preparation cannot reopen the channel. Window expiry or
loss of eligibility disables the new channel; existing session/passkey/details paths
are untouched. Temporary queue/transaction failures resume polling automatically
under the 22 October reliability standard below. Started provider calls may still
settle, and are never replayed.
The runtime gates each actual provider HTTP request, so stopping or expiring during
an inventory read cannot start a subsequent message POST.

### Accepted 22 October 2026 — automatic worker continuity in both apps

Workspace and My Shiloh share one worker implementation. A failed queue poll must
not permanently remove either app's WhatsApp sign-in. Keep the existing entry and
queue, expiry, eligibility, rate and spend authorities. Resume queue polling with
abortable exponential backoff (one second initially, capped at thirty seconds in
production), without requiring a manual restart or a new user recovery flow.
Only one worker loop and one dispatch may run at a time. Disabled configuration,
lost eligibility, expired pilot windows and explicit shutdown still close intake;
automatic polling must never reopen them or bypass readiness.

This resumes normal claims, never a failed message send. A committed claim or an
uncertain/started provider call remains ineligible for replay. Existing reserved
allowances are not reset and no SMS fallback is added. A request already expired
retains the existing fresh-code action. Provider outages may prevent delivery;
the application must recover when the dependency recovers rather than stay stuck.

Private production logs record sanitized worker_recovering, worker_recovered and
worker_disabled transitions for both apps, with counters and bounded retry delay.
Persistent failures report at each tenth failed poll. Release status includes the
worker state; overall HTTP/database health alone is not proof of sign-in readiness.
Never log underlying exceptions, numbers, tokens or code material in these events.
Synthetic acceptance covers repeated failures, capped backoff, shutdown, lost
eligibility, independent staff/client production compositions and a SQL-proven
post-acceptance transaction failure that cannot replay a send. Release and actual
device/provider acceptance remain separate milestones.

Clean Change: reuse the existing shared worker, SQL claims, account eligibility,
provider contracts and bounded production pools. Extend the worker loop rather
than add a queue, sender, scheduler, service or user-facing recovery screen. Source,
regressions and this standard are permanent; diagnostic logs/screenshots stay out
of the release tree. This small lifecycle policy is worth maintaining to prevent
both apps losing entry after one failed poll. **REPLACES NOW:** the exit-on-first-
queue-error branch; no identity, message or provider authority is replaced.
Shutdown must stop/drain the adapter before closing the shared database pool;
closing a pool does not reliably cancel an acquisition already in progress.
`passkeySuccessDestination(token)` validates the canonical session and returns the
welcome destination only for the selected subject's saved-passkey sign-in while
the pilot is running; all other callers retain the calendar destination. Wiring
that hook into the existing success call site is still part of activation.

Synthetic regression coverage includes alternate participants/operators,
canonical permission changes, a valid real WebAuthn response rejected under a
different pilot subject, lifetime count/spend reservations across restart/day
reset/purpose, expiry, stop during readiness/preparation/in-flight delivery,
single-start behavior, default-off/missing-schema operation and worker failure.
The same pilot tests are included in the isolated PostgreSQL 17 workflow. These
checks do not authorize live sends, migration execution, configuration or cutover.

Status: proposed execution plan, not activation authority. Owner authorized this
readiness work after the completed inactive draft. Work mode is appropriate.
The client runtime, staff-details retirement and lost-number bypass are excluded
from the first staff pilot. Accepted policies above remain authoritative.

### Current readiness evidence

- Connected GitHub inspection: PR #1476 remains open, draft and unmerged at
  `0ff24924bd0e5a0d1fad96db6b06c885a29efae5`. Its exact implementation head passed
  all fourteen workflows previously recorded; this plan does not replace those
  tests with a claim of production acceptance.
- Fresh read-only Render inspection in the owner-confirmed My Workspace:
  service `srv-d9qbfmk9v7es73emgam0` is a single-instance Node web service,
  `npm ci` / `npm start`, health path `/health`, automatic deployment on main
  commits, and no PR previews. Latest deploy `dep-db9u4761egvs73d65e0g` is marked
  live at `7d3dec8841be6f1f1edcb242f49ff1df77feacb2` (installation-guide PR #1478).
  Fetched main matches that commit. No authenticated journey or direct health
  response was verified in this inspection; Render live status alone is not proof.
- Source inspection confirms explicit runtime construction and `prepare()`, no
  production mounting/import, abortable worker, and proposed SQL outside migrations.
  Merely merging the draft would not make the channel usable. An activation adapter
  and its tests are still required. Main has advanced since the draft base, so
  reconcile with current main and rerun required exact-head checks before release.
- No credential values, environment-variable inventory, production database data,
  account billing or provider send endpoints were accessed for this plan.

### Implementation and operational prerequisites

1. **Bound the pilot in the application.** Add a default-off activation adapter
   around the existing runtime. Permit only the named canonical staff account and
   its independently authorized recovery administrator. Enforce the subject bound
   on the server before dispatch and grant completion, including alternate intake
   paths; an unpublished URL or hidden button is insufficient. Keep generic public
   responses and current identity/permission checks. Nonparticipants retain current
   access. Keep the client runtime unmounted and all retired senders retired.
2. **Wire the existing authorities.** Inject the canonical database/session/CSRF
   services, verified origin and WebAuthn relying-party settings; mount only the
   staff router. Connect successful pilot code/passkey entry to the welcome
   invitations. Preserve existing production passkey routes and details entry.
   Missing config/schema must disable only the new channel, not existing access.
3. **Secure configuration manifest.** The explicit constructor requires reviewed
   template components, WABA/sender IDs, API version, provider token, a dedicated
   random key of at least 32 bytes, canonical database/session services and an
   explicit enabled setting. SMS additionally requires its existing account/token
   and a deliberate fallback enable setting. Use protected platform secret entry;
   record only presence, owner and rotation date. Do not reuse a temporary Explorer
   token, log secrets, or invent environment variable names as if already wired.
   Decide production Meta credential ownership/lifecycle and minimum permissions
   before provisioning. Re-read exact approved template/account/sender facts via
   authenticated inventory immediately before activation.
4. **Cost configuration.** Supply explicit positive integer ZAR minor-unit values
   for `dailySpendMinor`, `whatsappCostMinor`, `smsCostMinor`,
   `smsAccountDailyLimit` and `smsClinicDailyLimit`. These are constructor fields,
   not established Render variable names. Reconfirm current rates/tax/FX and choose
   conservative cost reservations with the owner. Staff ten-code/two-SMS limits
   still apply. A configured estimate is not a guarantee of the provider invoice;
   neither R20 nor a new purchase is authorized. Keep SMS disabled for the first
   WhatsApp-only stage unless a separate bounded SMS test is authorized.
5. **Review and rehearse the staff migration.** Assign a unique migration number
   only after checking current main/schema. Review the existing staff-session
   constraint, preserve every currently valid auth method, and apply the new tables,
   indexes and invitation table transactionally through the controlled migration
   authority. Rehearse old/new application compatibility, lock timeouts, failed
   migration recovery and rollback in isolated PostgreSQL 17. Obtain backup/restore
   readiness evidence from the authorized operator. Do not promote or execute either
   proposed SQL file as part of this planning task; client SQL is not needed here.
6. **Worker and retention.** Prefer evaluating one explicitly managed loop in the
   existing web process for the small pilot, avoiding a new paid worker service.
   Test this recommendation before choosing it: one start after successful prepare,
   abort on shutdown, await bounded in-flight calls, no claimed-send replay after
   restart, and no overlapping application loops. Record sanitized worker state,
   queue age, uncertain outcomes and quota reservations without codes/numbers/tokens.
   Review query plans and lock contention using synthetic representative data.
   Dispatch cleanup occurs during claims; rates/records cleanup during reservations
   is batched and records remain until at least a day past expiry. It is not a
   guaranteed wall-clock retention service when idle. Agree a bounded cleanup/audit
   retention schedule and test it before activation; never delete active proof or
   reservations to regain quota. No new infrastructure purchase is assumed.

### Ordered release and acceptance sequence

| Stage | Required evidence before advancing |
| --- | --- |
| Synthetic activation rehearsal | Tester allowlist enforced across all purposes; disabled/misconfigured/schema-failure paths preserve old access; graceful shutdown/restart; migrations old/new compatibility; quota, expiry, uncertain dispatch, passkey and invitation regressions. Any UI change gets Storybook, phone/desktop Playwright, axe and actual screenshot review. |
| Release review | Activation diff reconciled with current main; every applicable workflow passes on the exact published head; named release operator, test identity, independent administrator, test window, message/spend caps and rollback target recorded. Owner explicitly authorizes secure setup, staff-only migration and deployment. |
| Disabled deployment | Capture current live commit/deploy and eligible rollback artifact immediately before release. Apply only authorized staff migration through the controlled runner. Deploy exact reviewed source with pilot disabled; verify migration checks, `/health`, existing staff-details/passkey access and critical client paths. Do not infer health from deploy status. |
| Staff-only enablement | Secure configuration and fresh Meta contract readback verified; successful prepare; pilot subject bound enforced; worker observable. Owner explicitly authorizes bounded sends before the worker can deliver any queued request. Existing access is verified first. |
| Device acceptance | Use the bounded sequence below; record actual receipt separately from API acceptance. Stop on any access, recipient, contract, duplicate-delivery or spend discrepancy. |
| Pilot observation | Confirm no unexpected sends or accumulating queue, quotas survive restart, invitations follow sign-in policy and existing access remains available. Agree observation period and acceptance with owner before wider rollout. |

Proposed live allowance: one designated staff account, another independently
authorized administrator, at most **three WhatsApp messages total**, no automatic
retries and no SMS/client messages. Recipient, time window and maximum monetary
spend are still unset and must be explicitly approved; do not infer them from the
clinic-wide daily ceiling. Stop once the allowance is consumed even if a test is
incomplete. A failed/uncertain send must not trigger an extra message.

1. Confirm both people's existing access and the tester's recorded number through
   the authorized application. With the tester's device, request one sign-in code;
   confirm actual recipient/receipt, Copy code, successful ordinary session and
   rejection of re-use. Save only sanitized acceptance results, never the code.
2. Request one fresh own-account enrollment code; add a disposable passkey, verify
   the existing key still works, and sign in using the new key without another
   message. Check optional invitations, Not now, refresh behavior and denied
   notification guidance without forcing native permission prompts.
3. Recovery is a separately acknowledged consequential step within the pilot:
   replacement revokes all old keys/sessions for that subject, including existing
   non-test credentials. Prefer a designated noncritical test staff identity with
   the required real canonical permissions and recorded phone. Do not assume a
   disposable key isolates recovery effects. If the owner accepts the named
   subject's consequences, use the independent administrator and third code to
   replace access, verify old keys/sessions fail and the replacement works. If not,
   leave recovery acceptance pending; synthetic recovery is not device acceptance.

SMS fallback remains synthetically verified until a separately approved recipient,
time, one-SMS allowance and spend cap exist. Do not manufacture a production
WhatsApp failure to test it. A client pilot requires its distinct approved template
and a separate client acceptance/release plan.

### Stop and rollback procedure

On wrong recipient, unexpected/uncertain duplicate, contract drift, quota/spend
breach, failed health or an existing-access regression: close new pilot intake and
stop worker claims first. Let already-started bounded provider calls settle as
accepted/uncertain; do not resend or reclaim them. Disable the new composition,
verify no further dispatch, and preserve sanitized evidence and rate reservations.
This kill-switch path must be implemented and rehearsed before enablement.

If code rollback is needed, an authorized release operator deploys the captured
compatible prior artifact or reviewed revert, monitors the resulting deploy to
terminal live state, and independently verifies health and preserved access. Keep
additive tables/new auth methods compatible with existing issued sessions; do not
drop tables, narrow the session constraint or reset quotas as an automatic rollback.
Messages, spend and recovery revocations cannot be reversed by a code rollback;
recovery access repair must use an independently authorized supervised procedure.
Inspect the resulting automatic-deploy setting and deliberately control subsequent
main deployments so a rollback is not immediately replaced.

Current Render references were checked using their HTML fallback after Markdown
retrieval failed: [deployment behavior](https://render.com/docs/deploys),
[health checks](https://render.com/docs/health-checks) and
[rollback scope](https://render.com/docs/rollbacks). Rollback artifact availability
and deployment settings must be rechecked at execution time.

### Owner inputs and distinct execution authority still needed

- Owner selected **Christel as staff tester and JP as the separate recovery
  administrator** on 18 October. Verify their canonical accounts, current access,
  recorded number and JP's independent required permissions before the pilot;
  names alone do not establish authorization in the application. Confirm whether
  Christel can safely undergo full recovery revocation. Verify numbers
  through the application, not secret/code exchange in chat.
- Agree a test window and total monetary cap, with at most three WhatsApp messages;
  keep SMS/client sends out unless separately bounded.
- Authorize the reviewed activation implementation and, after its evidence is
  complete, protected credential configuration, controlled staff migration and
  exact-source deployment. Approval of this plan alone is not those live actions.
- After successful pilot acceptance, separately decide details-session transition,
  lost-number evidence/audit procedure and wider staff rollout. Details retirement
  is not required to run this pilot safely and must not be bundled into it.


### Workspace sign-in entry (18 October 2026)

Owner requested the WhatsApp option inside Workspace after the bounded pilot opened. The normal `/calendar/staff` sign-in page now offers **Sign in with WhatsApp**, linking to the existing staff code page only when the production channel reports enabled at render time. The state is checked on each uncached page request; disabled, unavailable and expired channels omit the link. Navigation never starts the pilot or sends a code. Staff-details and saved-passkey entry remain available. The existing backend still owns participant eligibility, the original pilot window and durable limits. This interface change does not extend the pilot, activate clients, SMS or recovery, or establish physical-device acceptance.


### WhatsApp-session passkey navigation correction (18 October 2026)

Owner confirmed physical code delivery and successful WhatsApp sign-in, then reported Forbidden from My passkeys. Production request d2cbdc29-de2e-4dd7-8837-82595a4dff44 matches GET `/calendar/staff-auth/passkeys/manage` returning 403 at 13:06:22 UTC. The legacy optional-key authority intentionally accepts staff-details/passkey sessions, not the new code session; it must not be broadened to bypass fresh enrollment proof.

While the live pilot reports enabled, My passkeys now redirects a valid, non-recovery WhatsApp session to the existing `/calendar/staff-auth/whatsapp/enroll` flow. The destination remains fixed, private and uncached. Disabled/expired pilots, unavailable lookups, invalid sessions, SMS sessions and recovery-required sessions retain existing guards. No legacy mutation authority changes. Enrollment still requires the canonical own session, CSRF, fresh proof, browser/purpose/identity binding and explicit native passkey ceremony, within the original current pilot allowance/window. No codes are sent on navigation. Existing keys and sessions remain intact. Passkey device acceptance remains pending; this fix does not extend the pilot or replenish codes.
