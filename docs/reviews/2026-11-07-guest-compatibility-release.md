# Guest compatibility and migration — decision pending

This is a draft release proposal. **Do not merge, deploy, apply migration 201 or enable guests yet.** Production inventory and an actual fresh recovery point have not been obtained. The accepted separate-profile/organiser-contact and per-guest first-visit pricing work remains staged separately; this first release only prepares existing readers/workers and the schema. It introduces no guest-creation controls or organiser sending route.

## Exact proposed scope

`201_group_guest_booking_contacts.sql`, SHA-256 `289addeccae97938d150355af3355674ffd93f30de0feaa23305f4686f287637`, is byte-identical to the reviewed SQL fixture. It adds constrained direct/organiser contact roles, permits NULL mobiles only for explicit minimal unverified guest profiles, creates one booking-specific organiser contact per group, and adds constrained lifecycle recipient roles/organiser-group linkage with NULL phone only for explicit modern organiser delivery. Existing rows get direct/client defaults; numbers, IDs, existing reminder evidence, prices, receipts and balances remain unchanged. Existing phone format/uniqueness constraints remain.

The code preserves scoped profile edits/reactivation and later assignment of a genuine own mobile with the same ID/history. Ordinary reminder/follow-up workers skip NULL-phone rows without marking them delivered. Unsupported guest notices stay hidden while the ordinary history cursor still advances. No private forms, clinical follow-up, payment or sign-in messages are forwarded to an organiser. Date projections use the canonical YYYY-MM-DD contract for both repository values and Workspace revisions.

`SHILOH_CONTROLLED_RELEASE_MIGRATION=201_group_guest_booking_contacts.sql` is the proposed release marker only. Its presence in a draft PR is not approval or a live configuration change. No runtime flag, credentials, access setting or production data has been changed.

## Fresh evidence and blockers

At 07:09 UTC on 7 November 2026, the Render API identifies `shiloh-memory` (`dpg-d9quldht0dsc738p7m4g-a`) in My Workspace as available, PostgreSQL major 18, basic_256mb, 1 GB disk and HA disabled. This configuration response does not expose recovery timestamps, export availability, actual relation sizes or migration rows.

The newly authorized read-only connector probe returned no rows: FATAL SSL/TLS required, SQLSTATE 28000 / unexpected EOF. Its schema has no TLS option. The generic allowlist advice does not establish an allowlist problem. No unchanged retry, TLS relaxation, IP change or credential change was attempted.

The managed desktop is enabled but no desktop JavaScript/browser-control tool is exposed. Render CLI/config, configured API token, SSH agent and default SSH keys are absent. The earlier in-Render inventory verification was a guarded startup during deployment, not an available read-only Shell API. Do not trigger a deployment or change environment variables merely to obtain inventory. The previous environment-variable connector call triggered a deployment despite the underlying API documentation, so setting the migration flag must be treated as a release action.

The 6 November recovery screenshot is historical evidence only. Current Render documentation says paid databases have PITR, the available window depends on the workspace plan (Hobby three days, Pro or higher seven), and the latest restorable time is at least ten minutes behind current time. This establishes product policy, not this database's actual available timestamp or a tested restore. No fresh recovery point or current export was observed, and no export, restore, new instance or plan upgrade was initiated. [Render recovery documentation](https://render.com/docs/postgresql-backups).

The fixed [read-only inventory check](../../scripts/guest-release-read-only-inventory.js) is prepared for an existing authorized Render Shell. It can be copied as a temporary script and run from the current deployed app directory before this candidate is deployed; it does not need a startup/deploy step. It uses the app's existing pool/TLS configuration, a repeatable-read READ ONLY transaction, 10-second statement and 2-second lock limits, and always rolls back. It emits only release/schema metadata and aggregate invariants: migration file/ledger digests and discrepancies, actual server version, target relation sizes, NULL-contact counts, column/constraint/index definitions and aggregate lock occupancy. It never invokes startup, the executor, a schema helper or provider send. This task cannot execute that check through its currently exposed tools.

## Matching-major synthetic evidence

A disposable PostgreSQL 18.6 server exercised the unchanged canonical migration executor and proposed file. Real lock contention failed with 55P03 after the executor's 15-second lock limit, leaving schema and ledger unchanged. An injected ledger-write failure rolled DDL back atomically. Normal controlled execution applied only 201, reconciled the simulated 201-file ledger, preserved existing phone/default role evidence and retained a new synthetic NULL-mobile guest.

This uses a representative affected-table baseline and simulated historical ledger. It is not live inventory. A separate attempt to replay the entire historical chain from an empty database stopped after 001 with 42P01: user_profiles is missing. Migration 001 explicitly leaves the pre-versioned runtime baseline in place. No historical SQL was rewritten or production ledger repaired to hide that limitation. Complete historical replay is therefore not claimed; an approved retained baseline would be needed for that separate proof.

## Rollback artifact requirement

A pre-201 application cannot start after the migration: the startup inventory guard correctly refuses the unknown ledger file. The native test verified that retaining the identical 201 file makes startup authority reconcile while guest data remains intact. **Do not select the earlier compatibility commit 1cfa46ab or old main as a post-migration rollback by itself.** The reviewed compatibility release must include the exact 201 file/checksum and pass every exact-head check; pin its successful deployed commit before releasing the later guest feature. Pausing guest delivery is explicit, never marked sent/read.

No code-only rollback may delete the migration file or ledger record. Leave additive schema in place. Once guest rows exist, restoring NOT NULL or dropping contact storage is unsafe; the native test verifies that NOT NULL restoration refuses such data. Do not invent numbers, merge profiles, erase history or drop constraints to force a downgrade. If the initial migration deployment fails after commit and before a healthy compatibility release exists, stop for incident review/forward correction; do not blindly deploy an older artifact. A schema reversal needs a separately reviewed, approved plan.

PITR creates another database and later cutover can exclude legitimate activity after the chosen timestamp, including payments. It is an incident decision with validation/reconciliation and possible additional resource cost, not an automatic undo. The original database must not be deleted or reconfigured by this preparation. Logical exports, if separately authorized, are retained by Render for seven days; none was created here.

## Required release decision and sequence

1. Finish all required exact-head CI, Storybook, desktop/phone, accessibility and screenshot review for this compatibility draft. The later guest implementation is not substituted for this artifact's checks.
2. Obtain fresh current inventory through an existing authorized route. Compare all original file/ledger digests against the current deployed/main source, confirm no drift/unknown/pending file, inspect actual required columns/constraints/indexes, NULL invariants, sizes and active locks. Recheck that 201 is the only proposed addition. Stop on discrepancies; do not repair the ledger or run unrelated migrations.
3. Inspect the database Recovery page and record an actual recent available timestamp, database identity and time of observation immediately before execution. Review the recovery procedure and data-loss/cost limitations. Any export, recovery instance, access or credential action needs its own specific authorization.
4. Present this exact SQL/checksum, metadata evidence, baseline-test limitations, locking impact and recovery/rollback plan to JP for specific guest-migration approval. Pricing acceptance and the earlier targets migration approval do not authorize this migration.
5. Only after approval and all gates pass, coordinate the canonical single-file controlled executor with the exact tested release. It uses transaction/advisory locking, lock_timeout=15s and statement_timeout=120s; the statement limit is not a guaranteed whole-deployment duration. ACCESS EXCLUSIVE locks on CRM/lifecycle and FK locks can queue reads/writes; actual impact is unknown until fresh sizes/locks are available. Use a suitable quiet window, and do not weaken timeouts or retry indefinitely.
6. Keep creation unavailable, verify the exact applied checksum/ledger/catalog, unchanged invariants and new-instance health, then pin the healthy compatibility artifact. Only then rebase/check the separate guest feature against it. Feature activation is a later controlled release, with no live-data test writes or test client messages.


## Local preparation results

29 focused compatibility, private-document, attendance and migration-plan tests passed, followed by the inventory collector test. The collector emits no recorded mobile value, uses bounded session-local settings and rolls back both success and failure. Its separate PostgreSQL 18.6 proof also verifies that the server rejects an injected write with SQLSTATE 25006. A native date-contract proof checks that the default pg DATE parser returns a Date object, while the compatibility repository returns canonical ISO text even with a non-default DateStyle. The same projection is used for Workspace revisions.

Three guest/ordinary profile browser scenarios passed at phone/desktop sizes, including full accessibility checks and no overflow; Storybook build and lint passed. The initial browser attempt had no server listening at the default local port; after supplying the built catalogue server, all assertions passed unchanged. Remote exact-head checks and screenshot review are recorded in the draft PR, not substituted by these local results.

Main and the live Render deployment remain `fe1ca92b9cf2414f58bad42490a5d6707c3733ed`. Production PR previews are off and auto-deploy targets main, so a draft PR can run existing synthetic checks without a production deployment. No branch will be merged, no migration flag set and no schema/customer write made by this preparation.
