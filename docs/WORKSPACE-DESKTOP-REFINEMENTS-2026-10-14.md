# Workspace desktop refinements — synthetic pre-merge investigation

The owner requested restoration of desktop Gift vouchers and Rewards sidebar
icons and less wasted Dashboard space. Preserve the released browser-review
fixes, colours, brand assets, counts, controls, permissions and business rules.

The existing mask icons were already present; only their desktop hiding rule
was removed. Accessible text labels remain. The Dashboard uses independent
Today/Recent activity and Needs attention/Unfinished visits columns. At 1180px,
balanced lanes allow full-width team rows and readable status/action placement.
At wider desktop widths the existing wider Today lane and multiple team groups
remain. Phone panel order and pixels stay unchanged. Controls retain the shared
44px target and existing type sizes. No appointment, payment, count, report,
client, permission, migration, configuration or financial-history authority
changes. Existing request/consent/passkey features are outside this work.

Synthetic sparse and busy models at 1180, 1440, 390 and 500 browser pixels
include existing icon hydration identically before and after. Production hosts
are excluded by the enforced HTTP policy; these are fabricated browser proofs,
not authenticated live UI, installed apps or physical devices.

The initial full repository run stopped at 2940 passes and three failures.
Attention and carry-over test extractors required Recent activity after their
panels, which the independent columns changed. The user explicitly authorised
repairing extraction and rerunning gates. A shared test-only extractor balances
the target section and nested sections, ignores script/style markup strings and
rejects missing, duplicate and unclosed targets. Every original visit identity,
time, outcome-control and unauthorised absence assertion remains. The repaired
focused files pass nine tests, including the added extractor proof.

The first capture-only baseline diagnostic used incorrect Calendar story IDs.
Its authorised repair uses the exact IDs/viewports from the existing visual
test catalogue. Original decoded PNGs were then regenerated from committed
parts after missing-file setup was identified. An old occupied diagnostic port
was excluded from control evidence. A fresh detached release-base checkout was
rebuilt and served independently on an unused local port with the same locked
browser, existing DejaVu/Liberation per-test font profile and original logo.

That clean base passes all twelve references at the original 0.001 threshold.
Existing tolerated Dashboard appointment-label and client history-button deltas
are distinguished from this patch. Nine candidate references match exactly.
Only Dashboard desktop, client-history desktop and Messages desktop require
reviewed baseline updates. Expected, clean-base, candidate and difference
images were inspected: the latter two surfaces change only sidebar icon/label
placement; Dashboard changes the intended layout and retains visit/status/action
contents. No phone, Calendar or appointment-editor reference is updated, and no
threshold/accessibility assertion is loosened.

Final source-bound evidence and actual full local/connected CI gate status belong
in `artifacts/workspace-desktop-layout/review-packet.json` and the existing
release ledger/roadmap. This document remains historical pre-merge evidence;
it does not claim completion, merge or production deployment.
