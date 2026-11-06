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
The focused unit run passed 42 tests and lint passed. The full local suite passed
3,463 tests, with zero failures and one existing skip. Exact-head GitHub release
checks and live verification must pass before release.

The first CI visual run stopped on the two old Dashboard references (desktop layout
and phone height), with 13 other workflows passing. Only those two reference images
were regenerated and reviewed. A process-local font configuration reproduces the
runner-style fonts without changing application CSS or machine font configuration.
Unchanged client-history references and the unchanged desktop messages reference
passed as controls; the existing phone messages label differed by 402 pixels locally
and was not updated (it passed CI). The unchanged Dashboard heading matched exactly;
the unchanged desktop sidebar differed by only 19 pixels at the existing comparison
threshold. Both new Dashboard references passed normal comparison after encoding
and decoding. No comparison threshold, assertion or release gate was changed.

No real appointment, payment or client record was changed during testing. Later
booking, group-phone, combined payment review, waiver return, vouchers and rewards are
outside this implementation. The normal one-worker release workflow remains intact.

Additional keyboard review found native disabling of Refresh deposits blurred focus
to BODY during and after a request. The button now uses aria-disabled while the
existing running guard prevents duplicate requests, so focus stays on the button.
Desktop/phone tests require focus both during the read and after failure, together
with disabled/enabled accessibility states. This final focus correction is covered
by focused checks and the new exact-head full CI run; the earlier full local suite
preceded this correction.
