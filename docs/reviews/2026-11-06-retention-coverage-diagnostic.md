# Temporary retention coverage diagnostic

This fixed, aggregate-only diagnostic assesses observed appointment history before any retention calculation. It does not establish a complete attendance history or join legacy and modern identities.

## Execution and authority

Runs after the HTTP server begins listening, only on the existing Shiloh Render service, main branch, non-preview deployment with a valid source SHA, from 6 November 2026 06:00 UTC until 7 November 2026 06:00 UTC. Attempts once per process, including on restarts within that window. No timer, public endpoint, arbitrary query executor, environment-variable change or migration is introduced. Outside that window it is inert.

A separate one-connection pool inherits the existing application's connection and TLS configuration unchanged. The fixed read-only repeatable-read transaction requires exactly one active owner and the existing whole-clinic financial report authority. Missing, revoked, scoped or ambiguous authority stops the diagnostic before appointment reads. This is a system diagnostic under the approved operational scope, not a staff sign-in or an access grant.

Connection limit: five seconds. Each statement: five seconds, lock wait: one second, client query: 6.5 seconds, idle transaction: eight seconds. The appointment population is bounded at 50,000. Aggregate output is capped at 1,200 month/linkage/status rows. There is no retry. The transaction rolls back and its connection closes on success or failure.

## Privacy and interpretation

Only allowlisted numeric totals, date ranges and fixed status/linkage/source categories leave the database. No names, contact details, client identifiers, raw source strings, notes or treatment information are returned or logged. Source values outside the known buckets become `other`. Errors use fixed codes, without exception text or SQL. Internal identifiers are used only for aggregate reference checks and distinct counts within separate namespaces.

A summary and numbered monthly chunks share source SHA, run ID and a SHA-256 digest. Analysis must confirm all chunks, their row totals and digest before accepting the result. Partial output is not evidence of complete coverage.

Completed/no-charge status counts describe recorded outcomes. They do not certify attendance provenance. Observed earliest dates do not prove history was complete from those dates. Modern-only and legacy-only profile counts remain separate; dual links, missing references and multiple group memberships are reported as limitations. No 30/60/90-day rate or first-ever-visit claim is produced.

## Validation and rollback

Synthetic PostgreSQL-compatible fixtures exercise real aggregate SQL, canonical financial permission checks, read-only transaction settings, time/record/output bounds, malformed aggregates, service/branch/window guards, cleanup and sanitized errors. Normal repository and one-worker release checks remain required. No interface is changed, so there is no new UI screenshot to approve.

Rollback is removal of the startup invocation and diagnostic files in a normal reviewed release; no database rollback or record repair is needed. The fixed expiration independently disables further runs. Live findings and provenance limitations belong on the existing roadmap after verified deployment and complete log collection.

## Reset provenance follow-up

PR #586 retired the reset hook after the authorised 30 August reset; its parent source records the original status in appointment_status_history before setting all non-cancelled appointments to Cancelled. This was an occupancy reset, not proof of genuine cancellations or attendance. The removed reset module is never restored, imported or executed by this diagnostic.

Version 2 adds fixed aggregate reset provenance within the same bounded read-only transaction and unchanged expiry. History is capped at 50,000 rows before the aggregate query. Only current legacy-only appointments are counted. Matching requires exact changed_by, reason, to_status, a unique audit event with action control.calendar_occupancy_reset and runId calendar-reset-2026-08-30-v1, and equal transaction timestamps (history.changed_at and audit.created_at both used NOW()). Counts distinguish exact matches, unmatched markers and ambiguous duplicate history; grouped output contains only allowlisted prior/current statuses and counts. Multiple or absent audit events produce no certified matches. No audit metadata, IDs, reason text or identifying information is emitted. The integrity digest includes this additional object; collectors must reconstruct version 2 accordingly.

## Practical October review

Reception or another authorised staff member can open Dashboard → Unfinished visits, where unresolved past visits are grouped by date and sorted oldest first, and use Open / manage to inspect the booking. The list respects current active-practitioner and service permissions; absence from it does not prove an outcome. For any October record not shown there, use Calendar for its October date or Client → Appointments to open the original visit.

Check the actual outcome with the responsible staff member and existing records. Record Completed only when attendance is confirmed, and explicitly choose Paid with amount/method or Payment outstanding through the existing financial flow. Recorded deposits, partial receipts, vouchers and credits remain accounted for; completion alone is not payment. Use No-show only when verified; a genuine cancellation belongs in the existing Manage booking flow. If the outcome remains unknown, leave it unresolved for review rather than forcing a status to improve reports. Review each participant separately in shared bookings. This diagnostic never changes any of the 12 October Scheduled records.
