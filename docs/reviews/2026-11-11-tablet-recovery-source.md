# Migration 202 recovery source preparation

Status: local preparation only. Not published, release-tested in GitHub, built by Render, retained as a live artifact, deployed or authorised for production execution. PR #1582 is unchanged. No code sends, production reads or writes are part of this preparation.

## Exact scope

Base: stable live source `8426754838da7f61e0527dd3ed94f4859786425b`.

- Include the exact `202_clinic_tablet_booked_grants.sql` from PR #1582, SHA-256 `40c37de7579056fcf88352419af18f87d33b8d2ad1500d341abc9d954d12d56d`.
- Add only two predicates in the ordinary client OTP store: queued claims and ready-record revocation exclude `tablet_forms`.
- Keep the migration authority, authentication, identity, provider, shared counter namespaces, allowance, expiry cleanup and all other runtime code unchanged from stable source.
- No tablet routes, composition, access grants or lifecycle workers exist in this source. An inherited tablet-enabled flag cannot activate missing code. An eventual recovery deployment must nevertheless explicitly use the reviewed false flag.

This recognises a correctly checksummed 202 ledger and continues to refuse pending, mismatched and unknown migration history. It does not apply migration 202 on import or startup verification, ignore ledger discrepancies, reset quotas or rewrite records to make a recovery succeed. Normal clinic operations still have their existing authorised effects; no application deployment is a read-only database session.

## Dry-run deployment-recovery runbook

These are future operator decisions/checks, not executed deployment commands. Production execution requires specific migration/authentication/access approval, completed preflights and the parent's release coordination.

1. Record the final recovery commit/tree and compare the entire diff with the stable base. Verify the preceding 201 migration files and migration authority are byte-identical. Verify migration 202 matches the feature release. Run focused synthetic migration, ordinary-client, purpose-exclusion and quota-preservation checks; then complete required exact-head remote release checks before treating the candidate as deployable. Local tests alone are insufficient.
2. Through existing authorised, nonmutating Render views, verify the exact My Workspace/service/database, linked repository, existing build/start commands, same-service exact-commit deployment capability, health path, effective environment and any retained artifacts. Do not create a new service, preview, job or database, upload credentials, install tools, modify build/settings or spend money. If exact-commit source deployment cannot be verified, stop. It has not been established by this local preparation.
3. Confirm a quiet clinic window, fresh recovery-point availability, bounded ledger/checksum/catalog/role/lock/health preflight and no competing deployment. Confirm current ledger state before selecting a source. If migration 202 rolled back atomically and the ledger is still 201, today's stable source remains compatible. This recovery candidate deliberately refuses pending 202; do not run the migration merely to boot a fallback. If migration state is uncertain or drifted, stop and establish it read-only.
4. If 202 committed and the first feature-off deployment failed, today's old binary is incompatible. A future specifically authorised recovery would select the fully tested recovery commit on the same service, with tablet flag explicitly false and no new migration requested, and monitor the exact build/deployment. Confirm whether the controlled marker remains staged; the unchanged canonical gate must reconcile the already-applied exact checksum, never apply unrelated pending files. Any environment change or deployment is separately coordinated, not performed by this runbook.
5. After an authorised recovery, verify exact source identity, ledger 202/checksum, health/database, normal sign-in readiness and existing staff handover without real message/client mutations. Tablet entry must remain unavailable, and the ordinary sender must skip tablet-purpose queued records. Clear any one-shot marker only through separately verified Save-only coordination. Do not reset counters, drop the table or modify the ledger. Retain the healthy exact artifact and effective off configuration, verifying its availability before calling it a rollback checkpoint.
6. Later activation rollback is different: while the feature is healthy, quiesce new tablet use, finish/cancel access while cleanup remains available, drain in-flight work, and verify final grant deletion and matching tablet-token invalidation before disabling or moving to this source, which has no grant-cleanup worker. Preserve canonical submissions and newer staff handovers. An already-started provider send cannot be recalled. If cleanup cannot run because the application failed, do not improvise production deletion or claim this candidate performs cleanup; a specifically reviewed recovery/cleanup decision remains necessary.

## Limits

This candidate supplies rebuildable compatible source, not an already healthy retained Render artifact. Rebuilding can fail or take time. It cannot promise availability through the first post-migration boot, undo signed forms, recall messages or restore a database. No fresh backup restore was tested. If the gate requires a pre-existing healthy compatible retained artifact before migration, that operational requirement remains unresolved; do not bypass migration checks to manufacture one.

No new provider, costs, credentials, permissions, access settings or schema beyond the already proposed migration 202 is introduced. Publishing and deploying this candidate are not authorised by preparation alone.
