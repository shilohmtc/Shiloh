# Monthly business targets — controlled release

Status: implemented for synthetic review; production execution is blocked until actual backup/PITR evidence is recorded. No production migration, target save, client write or payment write has been performed by this work.

## Accepted behavior

Monthly, whole-clinic targets for net recorded receipts and recorded completed visits use the existing financial-report access authority. No new permissions or grants. Targets start unset; zero is distinct from unset. Save and Clear append revisions and an audit event in one transaction. Actor identity comes from the staff session. CSRF/origin controls, current authorization, expected revisions and idempotent operation IDs protect changes. Clearing preserves history.

Actual receipts reuse the canonical financial report ledger query and calculations: receipt-date payments minus refunds, including actual voucher-sale receipts without counting voucher/credit applications as new money. Completed visits count completed/no-charge appointment records by appointment start date, including individual participants. They are not unique clients, retention, booked visits, treatment value or profit. Unknown historical completeness is disclosed. Monthly targets are independent of the report's team/date filters. No costs or targets are invented.

## Migration and compatibility

One new file: `200_workspace_monthly_targets.sql`. It creates an initially empty `workspace_business_target_revisions` table, its sequence and constraint indexes, plus a foreign key to the existing staff account key. It does not backfill, update clients/payments, change existing tables, grant access or call external services. A foreign key requires a bounded lock on its referenced table; execute only through the canonical controlled migration executor with its lock/statement timeouts.

The app requires the table. Do not merge while the deployment prerequisites are unresolved. The PR marker is `SHILOH_CONTROLLED_RELEASE_MIGRATION=200_workspace_monthly_targets.sql`; it declares the reviewed release plan and does not itself apply SQL.

Before execution: confirm the current main/deploy SHA, exact file checksum and migration inventory; verify this is the sole pending migration with no ledger drift; record actual database backup/PITR availability, recovery window and restore procedure. A paid database plan is not proof that recovery is available. Render's connected database details currently do not supply this evidence for `shiloh-memory` (`dpg-d9quldht0dsc738p7m4g-a`) in My Workspace. The service is `srv-d9qbfmk9v7es73emgam0`; the inspected base release is `7d8d4c0c3633486941098479c9955def44d29d59`. Recheck the release at execution time. No supported authenticated browser or installed Render CLI was available in this task. Do not bypass the separately refused retention access.

Use the existing canonical `npm run db:migrate` / controlled-release migration authority. Coordinate the existing single-filename gate with deployment so a release cannot start against a missing table. Do not change credentials, permissions, paid services, or other environment configuration. Inspect postconditions and startup authority evidence: exact file/checksum, no pending/unknown migrations, physical constraints and initially empty target table. Confirm exact deployed SHA and service health; authenticated live behavior requires existing authorized browser access.

## Recovery

If application or ledger recording fails before commit, the executor rolls back the migration and ledger atomically. Keep the previously healthy release serving while investigating. If committed, retain the migration file, ledger entry and table/revisions. Prefer a forward correction or a code-only rollback retaining the migration in the release inventory. Reverting to a pre-migration source tree alone fails the startup unknown-migration safeguard. Do not drop the table, edit historical checksums, erase audits, or restore the production database automatically. A database restore affects other activity and requires a separate incident decision with a verified recovery point.

## Evidence

Synthetic PostgreSQL/PGlite tests cover additive schema constraints, empty defaults, audit rollback, revoked access, stale revisions, replay and preserved appointments. HTTP tests cover session, origin, CSRF, body bounds, server-owned actor and denied reads/writes. Browser tests cover Save, Clear, Cancel, stale response, mobile/desktop accessibility and populated/unset Storybook states. Exact results and release links are recorded in the PR after execution; no green local test substitutes for required exact-head CI or production backup evidence.
