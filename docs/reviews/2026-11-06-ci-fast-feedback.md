# UX CI fast feedback and exact duplicate removal

Accepted scope: surface booking-layout/changed-screen failures before the long
UX suite and remove only exact repeated scenarios. One worker, all assertions,
reviewed baselines, retries, accessibility checks, source binding, required
workflow names and release/production verification remain unchanged.

## Implementation

The unchanged source-bound Rebook capture now runs immediately after Storybook
starts, before any UX suite. Its synchronous booking-markup guard formerly failed
in job 127890065903 about 41m35s after the job began, after 771 scenarios had
passed in 36.1 minutes. The guard failed in about 0.78 seconds. Its full before/
after screenshots and original upload are retained, not replaced by a weaker
smoke check. Source: https://github.com/shilohmtc/Shiloh/actions/runs/42217201488/job/127890065903

`scripts/ux-ci-phases.js plan` collects the actual Playwright inventory. Seven
named early phases include booking layouts and the existing focused screen
checks. The later pass selects the exact complement using Playwright test lists.
The planner rejects omissions, overlaps, unexpected identities and empty focused
selections. Every phase checks its selected identities against the plan. The
remainder requires successful receipts bound to that exact clean source plan.
A failing early phase stops the job before the long pass.

Each phase retains separate HTML results, screenshots, traces, inventory and
elapsed time in `artifacts/ux-ci-phases`. Focused screenshots are also restored to
the existing results directory after the remainder so existing evidence packagers
and upload globs retain their inputs. CRM packaging reads its explicit early
output. Named evidence artifacts and retention periods are unchanged.

The normal `npm run test:ux` still runs the entire unpartitioned catalogue. No
scenario, assertion or evidence capture is deleted. Other workflows, authenticated
proofs, final-source evidence and live acceptance requirements are unchanged.

## Inventory and measurement

At base `3b11f6425da629c2a09192fad1dadb69b5f73f78`, collection proves:

- 771 distinct scenarios, all retained.
- Early phases: booking 4, holiday 13, attended 2, directory 9, couples 12,
  CRM 6, notifications 24: 70 total.
- Remainder: 701, with zero overlap and complete union.
- Previously 67 focused scenarios ran again in the full catalogue: 838 scenario
  executions become 771, a 67-execution (8.0%) reduction in these Playwright steps.
- Three existing layout scenarios move earlier in addition to the original 67.
- Collection and provenance verification add some overhead. Scenario count is
  not a measured wall-time speedup; record exact-head CI timing before claiming
  a runtime improvement. Historical guard time is not a full capture duration.

Validation and exact-head release evidence remain pending until recorded below.

Local validation before publication: repository lint and 10 focused/foundation
unit tests passed; independent review confirmed the actual 70/701 inventory
partition and evidence paths. Artifact restoration has a collision regression
and keeps each phase's `.last-run.json` separately. Full repository regression
execution is ongoing. Local Storybook could not enumerate network interfaces
(`uv_interface_addresses`, sandbox error); the supported headless Chromium
installer returned invalid archives. Browser results must come from the exact-head
GitHub run; no local browser pass or screenshot review is claimed.
