# Shiloh Production Maintenance & Rollback Runbook

Current operating rule: normal `npm start` boots the HTTP service and long-running schedulers only. Migrations, repairs, production smoke checks, rollout jobs, Goldie imports and Google Calendar reconciliations are explicit operator actions and must never be coupled to a Render restart/deploy.

## Normal deploy verification

1. Confirm the intended GitHub `main` commit.
2. Wait for GitHub Actions CI to complete successfully.
3. Confirm Render deployed the same commit and reports `live`.
4. Confirm `/health` returns HTTP 200 with database `ok`.
5. Review startup logs. Expected recurring schedulers are Goldie knowledge sync, Google Business Profile sync when configured, appointment lifecycle, and customer care. One-time repair/import/reconciliation jobs must not appear during ordinary startup.

## Running maintenance explicitly

### Software and release check — accepted 1 October 2026

The **Shiloh system maintenance check** Actions workflow provides **Run workflow** (Check now) and a daily 09:17 SAST report. This is the first phase of the accepted software-maintenance direction: dependencies, Node, Playwright, GitHub synchronization, Render alignment and recoverability. Meta/Facebook is outside this scope. Existing Dependabot and release gates remain the update and release authorities; this workflow installs no updates and performs no application/database writes.

Run locally with `npm run system:check`. It writes sanitized JSON and Markdown to `artifacts/system-maintenance/`, reporting locked packages, npm wanted/latest versions, production vulnerability counts, Node pin/runtime/workflow consistency and same-major LTS availability, locked Playwright browser revisions, current-main checks/open PRs, local dirty/ahead/behind state, Render's **live** commit and application/database health. Registry/API failures, missing credentials, missing live deployment and unavailable backup evidence remain explicitly unknown. Open PR/check lists identify truncation. Browser revisions do not prove browser installation or a passing journey; use the existing browser quality gates for that.

GitHub Actions supplies its read-only token. Automated Render alignment additionally needs the separately configured GitHub secret `SHILOH_MAINTENANCE_RENDER_API_KEY`; the connected Render session is not a credential for GitHub Actions. Never paste a key in chat or commit it. The workflow does not expose this secret to pull-request code. The optional local variables are `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `RENDER_API_KEY` and `RENDER_SERVICE_ID`. No secret values or provider error bodies are written to the report. GitHub CI only sees its checkout, not uncommitted/unpushed work on other computers. The report is evidence of checks performed, not a release approval.

`npm run system:snapshot` creates a dated Git bundle with SHA-256, verifies it, restores all included refs into a temporary bare repository, runs strict `git fsck`, compares refs and confirms the source commit exists. Full Git history is required. Scheduled/manual runs fetch current branch/tag inventory first. PR runs test the reporting code without producing a backup. The report and checkpoint are retained as GitHub artifacts for **30 days**. They are recoverable GitHub-hosted checkpoints, **not independent backups**; fetched Git history excludes GitHub issues/settings, LFS object content, database, uploads and secrets.

Recovery exercise: download a successful run's artifact, compare the bundle's SHA-256 with `code-snapshot.json`, run `git bundle verify <bundle>` inside a Git repository, then restore into an isolated bare repository with `git init --bare <restore-directory>` and `git -C <restore-directory> fetch <absolute-bundle-path> '+refs/*:refs/*'`. Run `git -C <restore-directory> fsck --full --strict` and confirm the recorded commit with `git -C <restore-directory> cat-file -e '<commit>^{commit}'`. Never restore over the working production repository.

Independent transport activation and retention, GitHub metadata export, Render database recovery-point evidence and an isolated restore drill, uploaded-file recovery, and an owner-only Workspace health view remain follow-up work. Do not mark these verified from a Git bundle or a provider plan alone. Choose the secure backup destination before exporting any clinic data. Node/runtime or package upgrades must use a dedicated branch and the applicable exact-head tests before release.

The owner selected a private Google Drive destination on 1 October 2026: [Shiloh System Backups](https://drive.google.com/drive/folders/1xP2cvE3sgR7I1PBT0hrAnGFG3WbcVLWh). Code snapshots and their checksum manifests may be copied there through the connected Drive tool and verified by download/restore. This selection does not configure recurring GitHub-to-Drive credentials or authorize public sharing; scheduled independent backup status remains unconfigured until the dedicated transport credentials below are configured and its copies are read back. Clinic-data exports require separate encrypted export and restore evidence. Both production-only and all-package npm audits are reported, so development-tool vulnerabilities remain visible.

### Recurring independent code backups

The same maintenance workflow now runs daily at **09:17 SAST** and supports **Run workflow**. After creating its GitHub checkpoint, `npm run system:backup:code` copies the current source bundle into the existing owner-selected private Drive folder. It checks owner-only access, streams a resumable upload, reads back file size/name/parent/access, downloads the actual Drive copy, compares SHA-256, restores all included refs into an isolated bare repository, runs strict fsck and confirms the source commit. It then saves and reads back a dated restore receipt beside the bundle. Only this completed chain produces `download-restore-verified`. Its local receipt is consumed by the maintenance report only for the current commit, with all proof fields and a timestamp no older than 36 hours. A saved receipt is tooling evidence from that run, not a fresh independent Drive inspection by the report.

**Activation prerequisite:** configure dedicated GitHub Actions secrets `SHILOH_BACKUP_GOOGLE_CLIENT_ID`, `SHILOH_BACKUP_GOOGLE_CLIENT_SECRET` and `SHILOH_BACKUP_GOOGLE_REFRESH_TOKEN`. Authorize the backup OAuth application for offline Drive access to the existing folder; prefer `drive.file` with an explicit folder grant through Google's file picker. A token for Calendar, a Google API key or a connector session is not a backup credential. Do not reuse Calendar credentials, put credentials in chat, store them in the repository, or send them to pull-request code. Verify folder access with this application before relying on the schedule. Partial credentials or transfer/restore failures fail the workflow; no credentials produces an explicit **unconfigured** report, even if other checks pass. A green overall workflow with this status does not prove an independent backup. Run the workflow manually after configuring secrets and inspect its current receipt and Drive files before recording activation.

Every run creates new files with unique names. **No existing backup is overwritten, shared or deleted.** Drive copies are kept until a retention policy is deliberately selected; monitor storage growth. GitHub artifacts remain limited to 30 days. A failed upload/restore or receipt step can leave an unverified Drive file; retain it as unverified evidence and investigate rather than assuming success or automatically deleting it. Network/API calls and Git recovery commands are bounded; large archives exceeding those limits fail visibly. The job prints sanitized status, never access/refresh tokens, provider response bodies or signed upload URLs.

**Scope:** fetched Git history and refs only. GitHub settings/issues, LFS object content, the database, original uploaded documents, application encryption keys and other runtime secrets are excluded. No application start, migration, package upgrade, clinic-data export or message send is added. Local filesystem inventory on current main finds in-memory document/CSV uploads; retained extracted knowledge text and encrypted clinical submissions are database data. This does not establish original-document retention or prove database recovery. Consultation records additionally require secure custody of `CONSULTATION_FORM_DATA_KEY`; restoring SQL without that key does not prove their readability. Never place that key in a plain code bundle or receipt.

**Database recovery gate (3 October 2026):** Render inventory identifies paid PostgreSQL 18 `shiloh-memory`. The connected read-only SQL probe failed with external TLS/network restrictions. Do not broaden the production allowlist for a hosted connector. Before a clinic-data export, establish a secure execution path inside Render, confirm recovery points/retention in the provider, use a compatible PostgreSQL client and installed extensions, encrypt the archive before transferring it, preserve required application decryption keys separately, and restore into a separate isolated database. Confirm schema/data and clinical decryption without exposing records in logs. Production must never be a restore target. Database recovery remains unverified until that evidence exists; the Workspace health page and broader controlled update rollout follow this gate.

Clean Change: reuse the existing maintenance workflow, source checkpoint verifier, report schema and owner-selected folder. The only permanent addition is a bounded code-copy command and focused failure/real Git restore tests. GitHub artifacts intentionally coexist as short-lived checkpoints; private Drive is the independent recovery destination. No second clinic datastore, scheduler, operator UI or business authority is created. No existing runtime code is retired by this unit.

### Existing explicit commands

List commands with:

```bash
npm run maintenance -- help
```

Read-only examples:

```bash
npm run maintenance -- chenique-diagnostic
npm run maintenance -- p2-staff-smoke
npm run maintenance -- google-calendar-reconcile-dry-run
npm run maintenance -- goldie-future-import-dry-run
```

Mutating commands require an explicit acknowledgement:

```bash
npm run maintenance -- google-calendar-reconcile-commit --confirm
npm run maintenance -- goldie-future-import-commit --confirm
npm run maintenance -- catalogue-polish --confirm
```

The legacy `startup-test-command` is also treated as a write because it records a run in the database. Its WhatsApp reply is **suppressed by default**. Sending its test reply requires both acknowledgements:

```bash
npm run maintenance -- startup-test-command --confirm --allow-whatsapp
```

Do not use `--allow-whatsapp` during routine verification. Never run a write command merely to test that it works. Prefer a read-only/dry-run command and inspect the result first. Do not use genuine appointments for destructive testing and do not send unnecessary WhatsApp messages to real clients.

## Assistant-operated named maintenance framework

The repository contains an inert contract framework for the separately ratified assistant PostgreSQL maintenance architecture. It is not a production executor.

Current framework files:

- `src/maintenance/operationFramework.js` — validates immutable named-operation contracts.
- `config/maintenance-operation-manifest.js` — versioned registry surface. The live manifest is intentionally empty until a separately reviewed operation is added.
- `tests/maintenance-operation-framework.test.js` — deterministic fail-closed contract tests.

The framework enforces the design boundary for future exact operations:

- operation IDs are named and versioned;
- classification is explicit (`read` or `write`);
- exact Git commit and Control authorization reference are part of the operation contract;
- arbitrary SQL, raw command, shell, secret and connection-string fields are rejected;
- exact confirmation tokens are bound to operation ID/version;
- write contracts require lock, timeout, precondition, expected-state, precommit and independent read-only postcommit verification declarations;
- write contracts require a replay-prevention interface;
- structured result keys that imply identity, credentials or raw payloads are rejected;
- unknown operation names fail closed.

The repository framework deliberately does **not** implement a production replay ledger, database role, credential, network path, job executor, HTTP route, shell, One-Off Job trigger or direct database connection. Those remain separately gated.

A merge/deploy containing this framework must not execute a maintenance operation. Normal `npm start` remains independent from the maintenance-operation registry. CI runs the focused framework tests before the full non-mutating regression suite.

A future live operation must not become executable merely because its definition exists in Git. It still requires the first-party bounded execution capability and a separate exact Control authorization, including review of its commit, immutable operation contract, expected effects, failure/rollback behavior and verification plan.

## Pre-write checklist

Before any mutating maintenance command:

1. Record the current GitHub commit and current live Render deploy ID.
2. Confirm the command's intended scope and environment values.
3. Run the corresponding dry-run/read-only check when one exists.
4. Confirm database backup/PITR availability in Render for database-changing work; if no suitable recovery point is available, do not proceed with a risky bulk mutation.
5. For Calendar work, identify exact affected calendar/event scope and avoid bulk destructive changes to genuine appointments.
6. For Goldie work, retain the source export/checksum outside Git and confirm no client messaging path is invoked.

For any future assistant-operated named maintenance write, also require the separately ratified operation contract: exact authorization, exact commit/checksum, live same-transaction fail-closed preconditions, expected-state assertions, all-or-nothing transactionality, replay protection, sanitized evidence and independent read-only post-state verification.

## Application rollback

If a code deploy regresses production but no maintenance write has been executed:

1. Revert the offending GitHub commit (preferred) or restore the last known-good tree on `main`.
2. Let Render auto-deploy the rollback commit.
3. Verify CI, Render `live`, `/health` 200 and startup logs.
4. Confirm no one-time maintenance command ran during the deploy.

A code rollback does **not** undo database or Calendar mutations already committed by an explicit maintenance command.

## Data/Calendar rollback

For a database-changing maintenance command, use the recorded pre-write recovery point plus the command's audit/output to determine the narrowest safe recovery. Do not blindly restore the whole production database if a scoped corrective transaction is safer.

For Google Calendar, prefer an idempotent/tightly scoped corrective reconciliation. Never delete or recreate genuine appointments simply to prove a rollback path.

If a command partially fails, preserve logs/output, stop further writes, verify CRM and Calendar state read-only, then choose the smallest corrective action. Do not rerun a mutating command repeatedly unless its idempotency and current state are understood.

## Goldie cutover protection

Goldie remains connected until the documented exit gate is fully cleared: fresh final export, future-booking delta comparison, delta import/reconciliation, zero unresolved future bookings, and final CRM/Calendar verification. Maintenance cleanup does not alter that gate.

## Safety invariants

- No impersonating Marietjie or Abigail.
- No unnecessary messages to real clients.
- No destructive testing against genuine CRM/Calendar appointments.
- Write maintenance commands require `--confirm`.
- WhatsApp-capable maintenance commands suppress messaging unless `--allow-whatsapp` is explicitly supplied.
- Assistant-operated named maintenance remains non-executable until separately authorized and supported by a bounded first-party execution mechanism.
- Prefer dry-run/read-only verification first.
- Do not disconnect Goldie until the exit gate is fully verified.

## Independent database backup — synthetic first draft, 7 October 2026

Owner approved automatic copies outside Render and the existing private **Shiloh System Backups** destination, including encrypted client/consultation records. This draft is **disabled**, accepts only explicitly named local synthetic PostgreSQL 18 fixtures, and has no live executor or schedule. It does not establish production protection. The approved My Drive owner identity is **shilohmtc@gmail.com**; the approved folder ID remains `1xP2cvE3sgR7I1PBT0hrAnGFG3WbcVLWh`. Parent read-only inspection found owner-only access/unshared folder and eight unshared files; quota/headroom was unavailable. Recheck access and headroom before activation and access during every transfer. Implementation/release/owner acceptance evidence remains on #611 and #879.

`npm run system:backup:database` reports disabled without opening a database or reading credentials. The inert library `scripts/independent-database-backup.js` binds source database/role/server address/port/version to an exported repeatable-read PostgreSQL snapshot. Compatible `pg_dump` 18 creates a custom archive with that snapshot, streaming directly into installed GnuPG authenticated OpenPGP AES-256/OCB encryption (`--force-aead --aead-algo OCB`). Only ciphertext reaches the prepared Drive adapter. GnuPG must support this AEAD format; unsupported tools fail, with no weaker fallback. Production should hold only the approved public recipient key, with its full fingerprint independently verified. The existing clinical key is a separate requirement and must never be replaced or bundled with an archive.

An exclusive per-source lock rejects simultaneous/stale interrupted runs; commands/database/network operations have timeouts and cancellation. Lock removal after a hard interruption requires a human to verify no process is active. Every upload creates a new unique immutable name; no update/overwrite/delete is implemented. The adapter reuses the code backup's owner-only access, endpoint allowlist and streaming SHA-256 safeguards, then authenticates the OAuth principal with Drive `about.user` and matches its email/permission ID to the folder/object owner and owner permission. A single arbitrary owner is insufficient. It rejects a wrong account/owner/permission ID, missing identity, service-account ownership, credential redirects/shared folders and verifies actual downloaded ciphertext digest and size, then rechecks folder/object access. Partial uploads may remain as **unverified** objects; there is no automatic cleanup/deletion. Failure or interruption yields no success receipt. Commands suppress subprocess/provider output, secrets and data; the eventual operator should emit only fixed sanitized failure stages, never raw error objects.

A `ciphertext-readback-verified` receipt records snapshot/verification timestamps, source/run ID, verified owner identity, PostgreSQL/archive/encryption format, ciphertext digest/bytes and object name/ID. It explicitly sets database recovery **false**. No private key, clinical key, connection string or plaintext belongs in a receipt. `scripts/database-backup-evidence.js` accepts only an exact allowlisted synthetic schema authenticated with **standard Ed25519** against an independently pinned public `KeyObject`, plus expected source/run/owner/folder and snapshot freshness. A valid signature with unknown fields, stale/future timestamps, different source/run/owner or recovery claims is rejected. A key supplied by the receipt itself is never trusted. Fixture keys are generated in memory solely for tests; no persistent signing credential or production trust is configured.

**Production report trust boundary is deliberately unavailable:** `system:check` does not read any database receipt file, whether unsigned, forged, allegedly signed or previously left in its output directory. It reports disabled / authenticated evidence provider unconfigured. The future production receiver must authenticate evidence through a reviewed independent channel and pinned trust configuration, validate the exact schema and expected job identity, and generate the sanitized report inside that trust boundary. Do not ingest raw worker/Drive files, trust a signature key carried inside an envelope, or infer success from a worker exit status. Choosing the production authentication authority/key custodian/receiver is a remaining owner/security review decision; the fixture Ed25519 test is **not** that decision or a deployed signing service. No production private signing key is provisioned or supplied to a GitHub runner or backup job by this draft; synthetic tests alone create ephemeral in-memory signing keys.

**Artifact boundary:** the maintenance workflow now uploads explicit report outputs, the code snapshot manifest and Git bundle filename pattern only, rather than the entire output directory. Raw `independent-database-backup.json`, any envelope/input, database archives/ciphertext/plaintext, private or clinical keys, logs and fixture directories are excluded. Raw/untrusted evidence must stay in a private quarantine outside **all** published artifact paths; it is not read by this draft. Only authenticated allowlisted aggregate metadata produced by the future trusted receiver may enter a report. The database path remains absent from the 09:17 SAST maintenance job. No production SQL runs on GitHub runners and no Render external database allowlist is widened.

### Synthetic recovery proof

Run `npm run system:backup:database:proof` with PostgreSQL 18 binaries on PATH (or `SHILOH_SYNTHETIC_PG_BIN` set to their directory) and installed GnuPG with AEAD support. The proof creates a fresh temporary local-only cluster, synthetic databases, ephemeral recovery/clinical keys and a mock private Drive. It exports/encrypts/uploads/readbacks/decrypts and restores into a distinct empty fixture database, checking schema, sequence progression, constraints, migration inventory and existing clinical decryption authority. It starts only PostgreSQL/GnuPG, never Shiloh or its schedulers/messages/payments. Restore targets outside the local synthetic namespace, the source itself and populated databases are refused. Integrity authentication must finish successfully before `pg_restore` begins. Archives are trusted SQL input: production recovery requires an approved archive and an isolated environment without app credentials/network integrations. Fixture success does not prove all production extensions, roles, migrations or clinical readability.

Wrong/missing keys, corrupt/truncated ciphertext, malformed authenticated archives, partial transfers, wrong owner/account/permission identity, shared destinations, upload redirects, source mismatch, timeouts, cancellation and held locks fail closed. Tests keep only aggregate output; temporary archives/keys/databases are removed after the proof. No persistent credentials are generated. The proof additionally authenticates its in-memory receipt with ephemeral Ed25519 fixture keys; it emits only aggregate results and does not publish the envelope.

### Proposed activation plan — separate approval required

1. Review/merge this inert foundation only after exact-head checks; this does **not** establish production readiness. The proposed second phase is a dedicated Render cron in the existing **Oregon** workspace, subject to owner cost/provisioning approval. Approve a secure Render **internal-network** executor with PostgreSQL 18/GnuPG/required extensions and bounded scratch/storage space. The first draft's synthetic source gate deliberately cannot be configured into production; a separately reviewed source-bound live executor is required.
2. Verify approved Drive folder identity/access and quota/headroom; measure encrypted size/duration, expected monthly storage growth and costs. Propose **daily** initially and **30 daily copies** retention. No schedule, paid resource, spending or retention deletion is enabled here. Any deletion policy requires separate approval and verified recoverability first.
3. Set up a dedicated least-privilege Drive offline credential via a secure human provider handoff (use owner OAuth `drive.file` with explicit selection/grant of this existing My Drive folder; plain service-account ownership is unsuitable). Never reuse Calendar credentials, put credentials in chat/Git, expose them to PRs or use the connector session as a runtime credential. Configure only through the approved secret manager after permission. Keep backup private recovery key outside production; preserve separate secure custody of `CONSULTATION_FORM_DATA_KEY`. Do not generate or configure persistent keys from this draft.
4. Approve one encrypted live export/transfer on the internal network, actual encrypted readback, and a separate isolated restore drill. Confirm full production schema/sequences/constraints/migration checksums/extensions and aggregate clinical decryption. Ensure the recovery environment has no app startup, schedules, messages, payment credentials or production routes. Record ciphertext verification separately from successful recovery and human acceptance.
5. Agree failure and missing-run notifications and responsible human response; the main owner chat is a proposed destination, not an activated channel; then approve and configure the one daily execution path. Monitor snapshot freshness and space. Recheck permissions on every run and periodically repeat recovery drills. Do not claim protection is active until live transfer/readback and isolated recovery have been verified.

Not safely tested here: production internal connectivity/roles/extensions and full schema, genuine clinical decryption key custody/readability, real OAuth permissions/redirect behavior, real Drive upload/readback/quota/cost, production-size timeouts/headroom, interrupted host recovery, recurring execution and failure notification delivery. These remain activation gates, not claims from synthetic proof.

### Second phase: disabled production wrapper design (not an activation-ready executor)

`database-backup-wrapper-contract.js` is an inert contract and a **fixture-only** OAuth adapter: it requires injected requests and exact synthetic credential markers, has no default network client/env loader, and refuses real-looking grants. No production database wrapper, OAuth grant, platform resource or schedule is implemented. The contracts are tested using fixed synthetic response/disk/inventory/clock values; they do not establish real provider behavior or disk headroom.

- **OAuth/identity:** propose a dedicated owner offline `drive.file` grant with secure human provider handoff and explicit folder selection. Cache short-lived access tokens in memory, refresh at least 30 seconds before expiry, allow one forced refresh for an expired token, and revalidate authenticated owner identity. Revoked/invalid grants, redirects, unexpectedly broad scopes or refresh-token rotation fail closed for human reauthorization; never print provider bodies/tokens. No connector or Calendar token reuse. Google documents [offline refresh](https://developers.google.com/identity/protocols/oauth2/web-server#offline) and [authenticated Drive user inspection](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get); this draft makes no live request with a grant.
- **Bounded retry/backoff:** proposed maximum three attempts, 1/3-second backoff, `Retry-After` capped at five seconds, 30-second request limits and a 120-second transport budget. Retry only 429/500/502/503/504 responses on safe stages (refresh, owner/metadata reads, readback and known-session status); never blindly retry archive export or upload-create. Unauthorized/forbidden/malformed/redirect responses stop immediately. Generic network errors are not retried in the fixture adapter because they can represent a rejected redirect. Larger production budgets/jitter and idempotent-session network recovery need measurement/review. [Drive error guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors) informs the policy; no retry loop is wired into a live job.
- **Duplicates/orphans:** generate one run ID before export; keep one immutable snapshot/name/digest throughout retries. A future wrapper must retain a known resumable session/object identity securely outside artifacts, query that exact session after an ambiguous response, and revalidate any candidate's owner/parent/name/run/digest by actual readback. Zero objects after an ambiguous outcome is not permission to blindly create again; one candidate is unverified until readback; multiple candidates block for human reconciliation. Interrupted runs and partial objects remain unverified. No overwrite/delete is enabled. Drive [pre-generated file IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds) may support a create-once design, but ID reservation/replay semantics are not implemented or claimed here.
- **Timeout/scratch/locking:** the fixture contract checks safe integer budgets covering two ciphertext copies plus a nonzero reserve. The live wrapper must check actual free bytes/inodes, enforce a measured ciphertext ceiling while writing, monitor storage during export, budget network/readback time, and fail before exhaustion. Restore scratch additionally needs authenticated plaintext/custom-archive and restored database/WAL space, measured separately. Source/role/version/host and approved recipient fingerprint must be pinned by independently reviewed runtime configuration. The current file lock is **host-local**; cross-host cron overlap/restart exclusion and stale-lock recovery need a reviewed singleton/advisory-lock design. A bounded same-source snapshot transaction and transport-wide cancellation must survive retries without recreating or misdating a snapshot.
- **Failure/missing-run evidence:** emit only fixed stages (`authorization`, `destination`, `scratch`, `export`, `encryption`, `upload`, `readback`, `receipt`, `timeout`, `interrupted`) and safe run/source/timestamps. Export/ciphertext verification, authenticated receipt acceptance, isolated restore and owner acceptance remain separate statuses. An independent observer must detect absent/late jobs using expected run/deadline and last authenticated **snapshot** timestamp, so a runner that never starts cannot silently pass. Old, forged, mismatched or missing receipts mean unknown/missing/unverified, never success. The main owner chat proposal requires approval of the receiver, timing, delivery capability and credentials; no notification is sent by these contracts. Authenticating failure events is part of the same unconfigured receiver boundary.

Owner/reviewer decisions still needed: approve executor/region/cost and measured limits; choose authentication authority, public-key pin/custodian and secure evidence handoff; authorize dedicated offline owner OAuth and its folder grant; approve cross-host exclusion, first live export/restore, notification destination/escalation and later retention. Do not claim the first draft can be enabled simply by setting an environment flag. It requires a separately reviewed and tested second-phase implementation.

### Restoration authority and extension prerequisites

This single-database logical export does not capture cluster roles/users, role memberships/passwords, tablespace definitions or provider configuration. The restore path deliberately uses `--no-owner --no-acl`; restoring table definitions/data does not recreate production ownership/grants, default privileges or least-privilege app/maintenance roles. Before an isolated drill, inventory and approve a separate **sanitized role/grant/extension manifest** (metadata only, no role password hashes, application secrets or cluster-wide real-data export). Create approved non-login ownership roles and an isolated restore role, recreate necessary memberships/grants/default privileges deliberately, and verify sequence/schema/function privileges after restore. Never start the app to infer that privileges are correct.

Inventory extension names/versions and install compatible PostgreSQL 18 binaries/control files, dependencies/shared libraries and any required preload settings in the isolated environment first. Identify extensions requiring elevated privileges; approve an isolated operator step rather than giving the application or backup exporter broad privileges. Confirm collations/locale, encodings, types, functions, trigger/constraint behavior and tablespace mappings are supported. The synthetic proof covers its own public schema and role only, with no production extension/role/grant proof; no claim that production can restore unchanged.

Keep the archive **private recovery key outside production/export/CI** and the existing `CONSULTATION_FORM_DATA_KEY` under separate approved custody. The exporter receives only the pinned public archive recipient key; the GitHub runner receives no archive private key, clinical key or production OAuth/database credential. Approved isolated human recovery receives the archive private key securely to authenticate/decrypt, and separately the existing clinical key to prove readable clinical records. Never replace either authority or bundle either key with archives, role manifests, receipts or report artifacts. Production remains forbidden as a restore target and app/schedulers/messages/payments stay absent from the recovery environment.
