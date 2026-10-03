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
