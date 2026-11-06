# Dashboard behaviour: agreed first step

The scoped change keeps deposit results on screen during background reads, excludes
No-show outcomes from the active day presentation, moves Unfinished visits into the
main column, and refreshes visit sections after a confirmed outcome without reloading
the document. Needs attention and its in-progress request inputs are preserved.

The canonical model and financial writes are unchanged. Completion still requires
the existing financial choice. Deposit review routes, permissions, account grouping,
credits, vouchers, booking revisions and outcome authority remain unchanged.

## Failure handling and state

- Deposit reads retain disclosure state, count and visible data while pending. Changed
  content waits until keyboard focus leaves it; identical content is not replaced.
  Failed reads label the previous information as stale and keep the refresh control.
- Failed outcome saves leave the visit and error visible. A confirmed save followed by
  a failed Dashboard read disables repeat outcome buttons, retains Open / manage, and
  offers a read-only refresh retry. Uncertain completion responses direct staff to
  review the booking without claiming a receipt or completion.
- Successful reads replace only Today, Unfinished visits and Recent activity from the
  authenticated canonical Dashboard. The review-link count updates with Today. Request
  drafts and the deposit panel are outside the replacement boundary.
- No-show outcomes remain in the existing Recent activity projection. This change does
  not enlarge its existing six-item/day window or infer historical attendance.

## Verification

Synthetic Playwright cases exercise desktop/phone focus, delayed deposit reads,
failed deposit reads, no-show and completed outcomes, failed writes, explicit payment
outstanding, saved-write/failed-read recovery, no document reload, canonical counts,
no-show visibility and Storybook accessibility. Existing layout assertions are updated
for the accepted section placement; action, accessibility and viewport checks remain.

Initial phone review found the review link increased the top bar height; it now lives
beside Open calendar inside Today. Storybook screenshots at 390px and 1440px were
reviewed. The broader Dashboard run passed 40 browser scenarios; the final focused
run passed 11 scenarios, including the additional exceptional-attention/draft case.
The focused unit run passed 42 tests and lint passed. Repository-wide tests, exact-head
GitHub release checks and live verification must pass before release.

No real appointment, payment or client record was changed during testing. Later
booking, group-phone, combined payment review, waiver return, vouchers and rewards are
outside this implementation. The normal one-worker release workflow remains intact.
