# Workspace payment review and retention assessment

Scope: source inspection only; no live records, migrations or analytics changes. Speed trial #1546 is independent and must not merge.

## Payment indicators

Canonical `bookingPayments.getSummary` enforces current payment VIEW and appointment scope in a repeatable-read READ ONLY transaction. Its position includes recorded payments/refunds, prior payments/transfers, applied rewards, welcome vouchers, treatment credit and gift-voucher allocations. Unused wallet/voucher balances must never count as payment. Shared accounts represent the whole booking, not one participant's debt. Price changes can require review; unavailable/restricted information cannot be described as paid or unpaid.

Directory currently selects last attended date and next scheduled date, not appointment/account IDs or a complete client financial position. Its last visit includes completed/no_charge records. Loading only that visit would miss older debts and must not become a client-level outstanding flag. Payment lookup is distinct from client lookup authority. Tenant client access must not gain payment access.

Future deposit review has a separate existing read-only authority, `workspaceDepositAttention`, using canonical requirements/settlement and group scope. `bookingDepositPolicy.getPosition` calls syncState and is unsuitable for a Directory read-only feature. Do not reuse the ordinary payment page getter: it can ensure a deposit requirement. Safe Directory implementation needs an explicitly bounded, scoped read projection identifying relevant accounts and distinguishing future required deposits, completed-visit balances, review/unavailable states, shared bookings and applied noncash settlement. This remains outstanding; no guessed indicator is implemented in this increment.

## Attendance-based retention feasibility

The live Reports new/returning query uses legacy client_id and any non-cancelled appointment, rather than completed attendance. Directory history instead uses crm_v2_client_id with client_id NULL. These are different identity universes; neither names nor notes can bridge them safely. Migrations 084/085 explicitly preserve legacy appointments on legacy client_id and introduce CRM V2 without copying or relinking legacy history. Therefore a combined historical cohort cannot assume continuity across that cutover.

A prospective calculation is structurally possible for a verified stable canonical client ID with completed visits and trustworthy timestamps. Before implementation, aggregate-only data quality evidence must establish: historical coverage/start date, missing/dual IDs, authoritative legacy-to-CRM links, status completeness and retrospective completion reliability, cancelled/no-show exclusion, group participant linkage, duplicated/imported visits, and timestamps including timezone. `no_charge` alone must not be assumed to establish attendance without checking its authority.

Define each cohort by first verified attended visit. Count a subsequent attended visit within 30/60/90 days; include only cohorts old enough for the full window at the as-of date. Specify calendar-day boundaries in Africa/Johannesburg, same-day repeat handling and whether the desired measure is return within the window or a return during a later interval. Do not treat immature cohorts as non-returners. Left-censored imported history can falsely identify an existing client as new. Without coverage and stable-linkage evidence, figures must remain unavailable or explicitly limited to a qualified cohort.

No retention analytics are implemented. Feasibility is conditional; source structure does not prove actual historical completeness. No names/notes or client data were sent to any AI service.

Further authority inspection: adminAppointmentFinalization explicitly describes no_charge as attended with zero charge/earnings. Qualified no-charge outcomes can count as attendance when their canonical finalization provenance is established; zero-price bookings alone cannot. Historical source completeness still needs aggregate validation.

An aggregate-only validation attempt against the configured environment database used an explicit READ ONLY transaction, a short statement timeout and no identifying columns. The connection was refused (ECONNREFUSED) before any rows were returned. Database provenance and actual historical coverage therefore remain unverified; no alternate endpoint or credentials were attempted. This is a blocker to data-backed retention conclusions, not evidence that attendance records are absent.
