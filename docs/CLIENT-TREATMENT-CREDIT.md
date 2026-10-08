# Client treatment credit — implementation and release boundary

Requested 8 October 2026. Governing roadmap #879 and resume ledger #611 remain the release/status authorities.

Treatment credit is a separate immutable noncash ledger over canonical CRM V2 clients, appointments and booking payment accounts. It does not reuse Rewards unlock/earning rules or gift-voucher semantics. Goodwill requires an amount and reason; service exchange additionally requires a supplier invoice/reference. The reference records evidence of the exchange, not invoice settlement, a paid expense or a tax treatment. No messages are sent.

The smallest safe first version applies credit after completion, only to the same client's treatment balance. Linked accounts require all members completed for that same client; mixed-client or unfinished groups require review. Awaiting deposits, active payment links, unknown/changed prices and other currencies fail closed. Canonical cash receipts/refunds and existing Rewards/welcome credits determine the remaining balance. Treatment value stays unchanged; noncash history appears separately in Reports/CSV and never enters receipt totals, paid expenses or cash-up. Credits have no earning/unlock threshold.

Wallet and payment-account locks prevent concurrent overspending. Operation UUIDs are locked globally and fingerprint the full request including actor and target; exact retries replay, conflicting retries fail. Every committed issuance/use has one immutable entry and atomic CRM audit. FIFO source allocations preserve goodwill/exchange provenance and invoice references. Deferred database constraints reject negative wallets, cross-wallet allocations, overspent sources or incomplete debits.

## Separate approval required before release

Prepared migration: `migrations/188_client_treatment_credit.sql`. It adds three empty tables, indexes and immutable/position-check functions/triggers. It contains no client/account updates, backfill, grants or scheduled job. Synthetic tests execute it only in disposable fixture databases; the saved development baseline and production migration ledger are unchanged. Do not execute it against either without separate approval.

Prepared authority: explicit `treatment_credit:view`, `treatment_credit:issue`, `treatment_credit:apply`, plus existing `client:lookup`, `all_business` Calendar and `all_services` scope. No grants are embedded in code/migration, and no existing Rewards/payment permission becomes credit issuance authority. Proposed enablement is only Christel's and Reception's existing canonical active accounts, resolved/revalidated at the separately approved grant step. Other principals remain denied. No account credentials, authentication mechanisms or branch protection change.

Before merge/deploy, separately approve the reviewed migration and exact intended permission enablement. Use the established controlled single-file migration release process after current recovery evidence; clear its execution setting afterward. Adding a migration to main before authority is approved would cause startup verification to fail closed, so keep the draft unmerged until the release prerequisites are authorized. After migration, preserve its immutable file/inventory in any forward fix; do not roll back to a release missing the receipt. No new infrastructure or paid dependency is proposed.

## Unresolved policy

There is no accepted expiry or reversal policy in the inspected authoritative material. This implementation has no expiry column/job and no remove/void/refund/reversal endpoint. It never silently expires credit or returns it after cancellation/refund. A later change to a completed appointment leaves its recorded use intact for review; cash refunds remain capped by actual net cash received. Incorrect issuance or use requires an owner-approved correction policy before correction controls can be built. No production credit should be issued merely to test this feature.

## Clean Change

Reuse: canonical client, staff capability/scope, appointment/payment account, browser session/origin/CSRF, CRM audit, Workspace palette/confirmation, Reports and CSV authorities. Three small permanent ledger tables are necessary because cash, Rewards and gifts have different semantics. COEXISTS FOR A REASON: treatment credit records noncash goodwill/exchanges while existing ledgers retain their authorities. No temporary provisioning/startup scaffolding, duplicate receipt ledger, dependency, policy scheduler or backfill. Tests, Storybook states and synthetic browser/PostgreSQL proofs are permanent maintenance evidence. Generated screenshots/logs remain uncommitted artifacts.
