# Workspace integration review — 6 November 2026

## Confirmed defects corrected

- Appointment status headline used the active-staff scheduling timeline, while its categories used the period's appointment records. Historical appointments without active staff assignments and range-boundary differences can make those populations differ. The headline now sums the same non-cancelled status counts as its breakdown, preserving staff permission filters. Synthetic reproduction: 48 completed + 3 no-show + 12 scheduled = 63, plus 18 cancelled = 81. Capacity still uses calendar working time. No particular live record was identified or changed.
- Upcoming deposit View booking omitted the date and opened the current calendar period. It now uses the selected member's verified appointment date in Africa/Johannesburg through the existing appointment-detail link helper, both initially and after refresh. It never borrows another group member's date. If matching context is unavailable, Review payment remains available without a misleading calendar link.
- Live Directory search replaced links after the initial navigation script ran, losing search context. Server-rendered result links now preserve query, status and page offset. Client tabs carry that same allowlisted return context, and Back to Clients restores it. Arbitrary destinations are rejected; no client data is stored in browser storage.
- Directory payment indicators now have a separate accessible link to that client's Appointments tab. The profile remains independently accessible. The indicator may represent several visits or a shared booking, so it does not guess which financial account to open or label shared balances as individual debt. Existing payment read permissions remain unchanged.

## Review scope and remaining gaps

Code review confirmed separate received-money and treatment-value calculations, unset targets, contextual booking-to-client tools and preserved group-payment wording. Scheduled/unfinished visits are not confirmed attendance; the current recorded-completion explanation already excludes them and warns that historical completeness is unverified. The separate aggregate diagnostic must establish coverage before retention percentages.

Payment pages currently show selected client/treatment context but omit date/time and practitioner. Adding verified context and a date-aware default return from that page is a useful separate follow-up; it is not included in these corrections. A report-to-unfinished-visits shortcut is another possible follow-up, subject to existing Dashboard access. Neither suggestion changes recorded outcomes or ledger definitions.

## Validation

Focused unit tests cover reconciliation, retained staff scope, clinic-time deposit dates, unmatched member handling and safe list returns. Browser regressions cover phone/desktop live search, return across tabs, separate payment links, stale payment responses and deposit refresh. Storybook uses the production report and Directory renderers with synthetic data. Existing one-worker checks and release gates remain unchanged; release evidence is recorded on the canonical roadmap after all checks and deployment verification.
