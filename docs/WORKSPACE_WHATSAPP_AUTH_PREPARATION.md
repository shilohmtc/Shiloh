# Workspace WhatsApp authentication draft

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
1114297824590105, sender 1310303435498156 (+27 83 683 5433), and APPROVED template
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
