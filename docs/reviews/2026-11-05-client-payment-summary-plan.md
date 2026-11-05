# Client payment summary and business insight boundaries

## Accepted scope and current release increment

The owner requested trustworthy financial review on Directory cards, recorded attendance trends, 30/60/90-day return analysis where supported, and a transparent business overview with configurable targets. Existing access, financial authorities, and one-worker release gates remain mandatory. No live record testing, messages, migrations, new providers, costs or access changes are authorized by this increment.

The recorded-visit comparison reuses the report's existing authorized current/previous period status aggregates. It counts completed and no_charge appointment records, not bookings, unique people or money received. A group contributes only its individually completed records. The appointment date determines the period; later outcome corrections can change a historic count. A zero previous period has no percentage change. Missing or invalid counts are unavailable. It makes no claim that historic coverage is complete and does not calculate retention.

## Read-only payment assessment

- Directory's listClients selects canonical modern CRM relationships and last/next appointments. It does not enumerate all financial subjects. Detail history is paginated. Neither is a complete balance source.
- bookingPayments.getSummary uses a repeatable-read READ ONLY transaction and current payment:view/Calendar authority. Its canonical accountFor/position logic includes receipts, refunds, prior payments and transfers, applied rewards, welcome vouchers, treatment credit and gift-voucher allocations. Unused balances are not settlement. Price changes after settlement become review states.
- That summary returns appointment or whole-booking balance; it does not return a client-wide total or a stable subject identity for aggregation. Group scope must check every member before exposing a shared financial amount, not only the selected appointment.
- workspaceDepositAttention is a separate read-only projection, one row per canonical account. It checks all members before scope and uses deposit policy/settlement rules. Ordinary deposit getPosition and payment get may write; they must not be used by Directory reads.
- Legacy client_id and modern crm_v2_client_id are separate identities. No names, phone numbers or clinical notes may be used to infer linkage. Dual/ambiguous linkage must be reviewed, not silently dropped from a supposedly complete total.

## Safe implementation sequence for Directory

1. Add a read-only, bounded batch projection alongside canonical booking payment authority, rather than copying ledger arithmetic into presentation or issuing unbounded requests per card. Recheck current client lookup, clinic relationship and payment VIEW authority in the same snapshot. Tenant/private data remains restricted.
2. Enumerate all directly linked modern CRM financial subjects for the requested page, without limiting to the newest visit or selected reporting month. Detect ambiguous linkage. Deduplicate accounts/groups before computation; missing account is still a canonical priced subject, not a paid visit.
3. Reuse canonical account/position functions inside the same snapshot. Require all group members to be authorized. Keep shared booking amounts separate from individual debt, especially mixed-status and multi-client groups. Do not allocate shared debt across clients without an existing allocation authority.
4. Return explicit coverage and review states. If a query times out, an account is unresolved, access changes or a safe workload limit is reached, suppress a complete balance claim. Do not replace missing values with zero. Label any restricted scope accurately.
5. Add future deposit review independently through the existing read-only deposit authority, mapping explicit modern IDs only. Future deposits must never be described as overdue treatment balances. A negative/credit position is not new cash and must not cancel another debt without recorded allocation.
6. Integrate card presentation only after service-level synthetic proofs cover completeness and mixed histories. Bound page workload and evaluate query plans with synthetic populated data. Fail closed rather than degrade search responsiveness or financial accuracy.
7. Prove old unpaid visits, partial receipts, refunds, transfers, rewards, vouchers, credit applications/undo, no-charge, missing price/account, mixed group statuses, duplicate group membership, private members, permission revocation, ambiguous/legacy IDs, limits and outages. Verify zero writes and zero notifications; then Storybook, phone/desktop, accessibility and all normal release workflows.

This projection is still implementation work, not an access denial or a completed feature. The existing history view remains the available canonical payment review.

## Retention and targets

An earlier aggregate-only READ ONLY database connection returned ECONNREFUSED before rows. Endpoint provenance and actual historical coverage remain unverified. Do not retry through alternate credentials/endpoints or bypass that refusal. Source and synthetic tests remain authorized. A future retention calculation needs stable identity, observation-start coverage, completed/no-charge outcome provenance, and mature cohorts; immature 30/60/90-day windows must be excluded with denominators shown. First observed visit is not necessarily first-ever visit. No live retention rates can be claimed from current evidence.

Existing owner-controlled financial reports already separate immutable-ledger receipts, refunds, treatment value, shared balances, applied noncash credit and recorded expenses. Absence of expenses does not prove zero operating cost or profit. Source inspection found no general clinic-target persistence/management authority; existing settings are specifically for rewards/vouchers. Do not repurpose those tables or store clinic-wide targets silently on one browser. Decision required for persistent configurable targets: approve a separately reviewed storage/authority design and migration, or explicitly choose a clearly labelled unsaved planning calculator. Neither decision has been assumed. Unknown target and cost inputs remain unset.
